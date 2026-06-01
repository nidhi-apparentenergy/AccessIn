"""
POST /describe — AI image description for blind / low-vision users.

Accepts a base64-encoded image (fetched by the browser extension,
so LinkedIn auth cookies are preserved) and uses Gemini Vision to
return a plain-English description optimised for screen readers.
"""

import asyncio
import base64
import json
import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from google import genai
from google.genai import types

router = APIRouter()

MAX_IMAGE_B64_CHARS = 10 * 1024 * 1024  # ~7.5 MB decoded — reasonable upper bound

# Data Models

class DescribeRequest(BaseModel):
    image_b64: str          # base64-encoded image bytes
    mime_type: str = "image/jpeg"
    context: str = ""       # optional surrounding text

    @field_validator("image_b64")
    @classmethod
    def not_empty_and_not_too_long(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("image_b64 cannot be empty")
        if len(v) > MAX_IMAGE_B64_CHARS:
            raise ValueError("image_b64 exceeds maximum allowed size")
        return v


class DescribeResponse(BaseModel):
    description: str        # description for screen readers
    short_alt: str          # concise alt text (max 125 chars)


# Gemini Vision Prompt

SYSTEM_PROMPT = """\
You are an accessibility expert writing image descriptions for blind and \
low-vision users on LinkedIn.

Given an image, return a JSON object with EXACTLY these two fields \
(no markdown, no code fences, just raw JSON):

{
  "description": "<2-4 sentence plain-English description of what is in the image, \
written as if describing it to someone who cannot see it. \
Mention people, text, logos, charts, or key visual elements. \
Be factual and neutral. Do not say 'the image shows' — just describe directly.>",
  "short_alt": "<one concise sentence, max 125 characters, suitable as an HTML alt attribute>"
}

Rules:
- Describe people by appearance and expression, not by assumed identity.
- If there is text in the image, read it out.
- If it is a chart or graph, describe the trend or key data point.
- If it is a profile photo, say so and describe the person briefly.
- If the image is decorative or blank, set both fields to empty string.
- NEVER include markdown. Return ONLY valid JSON.
"""


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences from a string."""
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


# API Endpoint

# Try gemini-2.5-flash first (supports vision), fall back if unavailable.
MODELS_TO_TRY = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
]


@router.post("/describe", response_model=DescribeResponse)
async def describe_image(req: DescribeRequest):
    """Accept a base64 image and return an AI-generated accessibility description."""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        image_bytes = base64.standard_b64decode(req.image_b64)
    except Exception:
        raise HTTPException(status_code=422, detail="image_b64 is not valid base64")

    try:
        client = genai.Client(api_key=api_key)

        parts = [
            types.Part.from_bytes(data=image_bytes, mime_type=req.mime_type),
        ]
        if req.context:
            parts.append(types.Part.from_text(text=f"Surrounding context: {req.context}"))

        response = None
        last_error: Exception | None = None
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=types.Content(role="user", parts=parts),
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.2,
                        max_output_tokens=1024,
                        response_mime_type="application/json",
                    ),
                )
                break  # success — stop trying
            except Exception as model_err:
                last_error = model_err
                err_str = str(model_err).lower()
                if any(k in err_str for k in ("503", "unavailable", "overloaded", "quota")):
                    await asyncio.sleep(1)  # non-blocking sleep
                    continue
                raise  # other errors re-raised immediately

        if response is None:
            raise last_error  # type: ignore[misc]

        raw = _strip_code_fences(response.text)
        # Collapse newlines inside JSON string values without breaking structure
        raw = ' '.join(raw.splitlines())

        # Guard: if Gemini truncated mid-response, the JSON will be incomplete.
        # Attempt to close any open string/object so json.loads has a chance.
        if not raw.rstrip().endswith('}'):
            # Find the last complete key-value pair we can safely close off.
            # Strategy: truncate to last `"` boundary and close the JSON object.
            last_quote = raw.rfind('"')
            if last_quote > 0 and raw[:last_quote].rstrip().endswith(':'):
                # Gemini cut off inside a value — close the string and object
                raw = raw[:last_quote] + '"truncated"}'
            else:
                # Cut off after a value — just close the object
                raw = raw.rstrip().rstrip(',') + '}'
            print(f"DESCRIBE: truncated response patched, parsing best-effort")

        result = json.loads(raw)

        # Ensure both required fields exist (patching may have lost one)
        if 'description' not in result:
            result['description'] = ''
        if 'short_alt' not in result:
            result['short_alt'] = ''
        return DescribeResponse(**result)

    except json.JSONDecodeError as e:
        print(f"RAW GEMINI RESPONSE: {raw}")
        raise HTTPException(status_code=502, detail=f"Gemini returned invalid JSON: {e}")
    except Exception as e:
        print(f"DESCRIBE ERROR: {e}")
        raise HTTPException(status_code=500, detail=f"Description failed: {e}")