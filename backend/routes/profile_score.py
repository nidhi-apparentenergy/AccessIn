"""
POST /profile-score — Accessibility score for a LinkedIn profile.

Accepts extracted profile content and uses Gemini to score how accessible
the profile is for neurodivergent readers, screen reader users, and people
with cognitive disabilities.
"""

import asyncio
import json
import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from google import genai

router = APIRouter()

MAX_CONTENT_CHARS = 15_000

# ── Models ────────────────────────────────────────────────────────────────────

class ProfileScoreRequest(BaseModel):
    name: str = ""
    headline: str = ""
    about: str = ""
    experience: str = ""
    profile_url: str = ""

    @field_validator("about", "headline", "experience")
    @classmethod
    def truncate_long_fields(cls, v: str) -> str:
        return v[:MAX_CONTENT_CHARS]


class ScoreBreakdown(BaseModel):
    category: str       # e.g. "Plain Language"
    score: int          # 0-10
    feedback: str       # one sentence
    tip: str            # one actionable improvement


class ProfileScoreResponse(BaseModel):
    overall_score: int              # 0-100
    grade: str                      # A / B / C / D / F
    summary: str                    # 2-3 sentence plain-English summary
    breakdown: list[ScoreBreakdown] # per-category scores
    top_wins: list[str]             # what they're doing well (max 3)
    top_fixes: list[str]            # most impactful improvements (max 3)


# ── Prompt ────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an accessibility expert evaluating a LinkedIn profile for how easy it is
to understand for neurodivergent users (ADHD, autism, dyslexia), screen reader
users, and people with cognitive disabilities.

Given profile content, return a JSON object with EXACTLY these fields
(no markdown, no code fences, just raw JSON):

{
  "overall_score": <integer 0-100>,
  "grade": "<A | B | C | D | F>",
  "summary": "<2-3 plain-English sentences about the profile's accessibility overall>",
  "breakdown": [
    {
      "category": "Plain Language",
      "score": <0-10>,
      "feedback": "<one sentence about this category>",
      "tip": "<one actionable improvement>"
    },
    {
      "category": "Clarity & Structure",
      "score": <0-10>,
      "feedback": "<one sentence>",
      "tip": "<one actionable improvement>"
    },
    {
      "category": "Jargon & Buzzwords",
      "score": <0-10>,
      "feedback": "<one sentence>",
      "tip": "<one actionable improvement>"
    },
    {
      "category": "Sentence Length",
      "score": <0-10>,
      "feedback": "<one sentence>",
      "tip": "<one actionable improvement>"
    },
    {
      "category": "Inclusive Language",
      "score": <0-10>,
      "feedback": "<one sentence>",
      "tip": "<one actionable improvement>"
    }
  ],
  "top_wins": ["<thing they do well 1>", "<thing they do well 2>"],
  "top_fixes": ["<most impactful fix 1>", "<most impactful fix 2>", "<most impactful fix 3>"]
}

Scoring criteria:

Plain Language (0-10):
  - 8-10: Short sentences, everyday words, easy to follow
  - 4-7: Mix of simple and complex language
  - 0-3: Dense, academic, or overly formal writing

Clarity & Structure (0-10):
  - 8-10: Clear sections, bullet points, logical flow
  - 4-7: Some structure but could be clearer
  - 0-3: Wall of text, no clear sections

Jargon & Buzzwords (0-10):
  - 8-10: Minimal jargon, explains technical terms
  - 4-7: Some jargon but manageable
  - 0-3: Heavy buzzwords ("synergy", "rockstar", "ninja", "disruptive", "leverage")

Sentence Length (0-10):
  - 8-10: Most sentences under 20 words
  - 4-7: Mix of short and long sentences
  - 0-3: Many sentences over 30 words

Inclusive Language (0-10):
  - 8-10: Welcoming, no ableist or exclusionary phrases
  - 4-7: Mostly inclusive with minor issues
  - 0-3: Contains ableist idioms or exclusionary language

Grade scale:
  A = 85-100, B = 70-84, C = 55-69, D = 40-54, F = 0-39

IMPORTANT: Return ONLY valid JSON. No markdown. No explanation outside the JSON.
"""


def _strip_code_fences(text: str) -> str:
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


# ── Endpoint ──────────────────────────────────────────────────────────────────

MODELS_TO_TRY = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
]


@router.post("/profile-score", response_model=ProfileScoreResponse)
async def score_profile(req: ProfileScoreRequest):
    """Score a LinkedIn profile for accessibility."""

    if not any([req.headline.strip(), req.about.strip(), req.experience.strip()]):
        raise HTTPException(
            status_code=400,
            detail="At least one of headline, about, or experience must be provided",
        )

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    profile_text = f"""
Name: {req.name or 'Unknown'}
Headline: {req.headline or '(not provided)'}

About:
{req.about or '(not provided)'}

Experience:
{req.experience or '(not provided)'}
""".strip()

    raw_text: str | None = None

    try:
        client = genai.Client(api_key=api_key)

        response = None
        last_error: Exception | None = None
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=f"Score this LinkedIn profile for accessibility:\n\n{profile_text}",
                    config=genai.types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.2,
                        max_output_tokens=2048,
                        response_mime_type="application/json",
                    ),
                )
                break
            except Exception as model_err:
                last_error = model_err
                err_str = str(model_err).lower()
                if any(k in err_str for k in ("503", "unavailable", "overloaded", "quota")):
                    await asyncio.sleep(1)
                    continue
                raise

        if response is None:
            raise last_error  # type: ignore[misc]

        raw_text = _strip_code_fences(response.text)
        result = json.loads(raw_text)
        return ProfileScoreResponse(**result)

    except json.JSONDecodeError as e:
        preview = (raw_text or "")[:500]
        raise HTTPException(
            status_code=502,
            detail=f"Gemini returned invalid JSON: {e}. Raw: {preview}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Profile scoring failed: {e}")
