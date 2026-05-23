"""
POST /simplify - AI post simplifier for neurodivergent LinkedIn users.

Accepts a long LinkedIn post or message and returns a shorter, clearer version
with key points separated out for easier scanning.
"""

import json
import os

from fastapi import APIRouter, HTTPException
from google import genai
from pydantic import BaseModel

router = APIRouter()


class SimplifyRequest(BaseModel):
    text: str
    context: str = ""


class SimplifyResponse(BaseModel):
    simplified_text: str
    key_points: list[str]
    action_needed: str


SYSTEM_PROMPT = """\
You are an accessibility assistant helping ADHD, autistic, dyslexic, and
cognitively overloaded LinkedIn users understand long posts.

Return a JSON object with EXACTLY these fields:

{
  "simplified_text": "<3-5 short sentences in plain English>",
  "key_points": ["<important point 1>", "<important point 2>", "<important point 3>"],
  "action_needed": "<what the reader should do next, or 'No action needed'>"
}

Rules:
- Use short sentences.
- Keep the meaning accurate.
- Remove hype, filler, and repeated phrases.
- Do not change names, dates, job titles, salaries, links, or deadlines.
- If the post asks the reader to do something, make that action very clear.
- Return ONLY valid JSON. No markdown. No code fences.
"""


@router.post("/simplify", response_model=SimplifyResponse)
async def simplify_text(req: SimplifyRequest):
    """Simplify a LinkedIn post or message for easier reading."""

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        client = genai.Client(api_key=api_key)

        prompt = f"Simplify this LinkedIn text:\n\n{req.text}"
        if req.context.strip():
            prompt += f"\n\nContext: {req.context}"

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.2,
                max_output_tokens=700,
            ),
        )

        raw_text = response.text.strip()
        if raw_text.startswith("```"):
            raw_text = raw_text.split("\n", 1)[1]
            raw_text = raw_text.rsplit("```", 1)[0].strip()

        result = json.loads(raw_text)
        return SimplifyResponse(**result)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini returned invalid JSON: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simplify failed: {e}")
