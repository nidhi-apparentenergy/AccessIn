"""
POST /describe — AI image description for blind / low-vision users.

Accepts a base64-encoded image (fetched by the browser extension,
so LinkedIn auth cookies are preserved) and uses Gemini Vision to
return a plain-English description optimised for screen readers.
"""

import base64
import json
import os
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google import genai
from google.genai import types

router = APIRouter()

# ── Models ────────────────────────────────────────────────────────────────────

class DescribeRequest(BaseModel):
    image_b64: str          # base64-encoded image bytes (no data URI prefix)
    mime_type: str = "image/jpeg"
    context: str = ""       # optional surrounding text (alt, aria-label, caption)


class DescribeResponse(BaseModel):
    description: str        # plain-English description for screen readers
    short_alt: str          # concise alt text (≤ 125 chars)


# ── Prompt ────────────────────────────────────────────────────────────────────

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


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/describe", response_model=DescribeResponse)
async def describe_image(req: DescribeRequest):
    """Accept a base64 image and return an AI-generated accessibility description."""

    if not req.image_b64.strip():
        raise HTTPException(status_code=400, detail="image_b64 cannot be empty")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        image_bytes = base64.standard_b64decode(req.image_b64)
    except Exception:
        raise HTTPException(status_code=422, detail="image_b64 is not valid base64")

    # Try gemini-2.5-flash first (supports vision), fall back if unavailable.
    MODELS_TO_TRY = [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
    ]

    try:
        client = genai.Client(api_key=api_key)

        parts = [
            types.Part.from_bytes(data=image_bytes, mime_type=req.mime_type),
        ]
        if req.context:
            parts.append(types.Part.from_text(text=f"Surrounding context: {req.context}"))

        response = None
        last_error = None
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=types.Content(role="user", parts=parts),
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.2,
                        max_output_tokens=512,
                    ),
                )
                break  # success — stop trying
            except Exception as model_err:
                last_error = model_err
                err_str = str(model_err).lower()
                if "503" in err_str or "unavailable" in err_str or "overloaded" in err_str or "quota" in err_str:
                    time.sleep(1)
                    continue  # try next model
                raise  # other errors re-raised immediately

        if response is None:
            raise last_error

        raw = response.text.strip()

        # Strip markdown fences if Gemini wraps the JSON
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            raw = raw.rsplit("```", 1)[0].strip()

        result = json.loads(raw)
        return DescribeResponse(**result)

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Gemini returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Description failed: {e}")
