"""
POST /analyze — Accessibility-focused job description analysis.

Accepts a raw LinkedIn job description and uses Gemini to:
  1. Calculate a Sensory Load Score (how overwhelming the text is)
  2. Detect disability bias / exclusionary language
  3. Simplify the JD for neurodivergent readers (ADHD, dyslexia, etc.)
  4. Highlight the most important parts
  5. Extract key skills, experience level, and match tips
"""

import asyncio
import json
import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from google import genai

router = APIRouter()

MAX_JD_CHARS = 20_000  # guard against absurdly large payloads

# Request and Response Models

class AnalyzeRequest(BaseModel):
    job_description: str

    @field_validator("job_description")
    @classmethod
    def not_empty_and_not_too_long(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("job_description cannot be empty")
        if len(v) > MAX_JD_CHARS:
            raise ValueError(f"job_description exceeds {MAX_JD_CHARS} character limit")
        return v


class BiasFlag(BaseModel):
    phrase: str
    issue: str
    suggestion: str


class AnalyzeResponse(BaseModel):
    title: str
    company: str

    sensory_load_score: int          # 1-10 scale (10 = most overwhelming)
    sensory_load_explanation: str    # explanation of the score
    bias_flags: list[BiasFlag]      # list of exclusionary language found

    simplified_summary: str          # plain language summary
    key_highlights: list[str]        # bullet points

    key_skills: list[str]
    experience_level: str            # entry, mid, or senior
    match_tips: list[str]            # actionable tips for candidate


# Gemini Prompt

SYSTEM_PROMPT = """\
You are an accessibility expert who helps neurodivergent job seekers \
(ADHD, autism, dyslexia, anxiety, etc.) understand job descriptions.

Given a raw LinkedIn job description, return a JSON object with EXACTLY \
these fields (no markdown, no code fences, just raw JSON):

{
  "title": "<extracted job title>",
  "company": "<extracted company name or 'Unknown'>",
  "sensory_load_score": <integer 1-10>,
  "sensory_load_explanation": "<1-2 sentences explaining the score>",
  "bias_flags": [
    {
      "phrase": "<exact problematic phrase from the JD>",
      "issue": "<why this is exclusionary or biased>",
      "suggestion": "<more inclusive alternative>"
    }
  ],
  "simplified_summary": "<3-5 sentence plain-language summary of the role>",
  "key_highlights": ["<must-know point 1>", "<must-know point 2>", ...],
  "key_skills": ["<skill 1>", "<skill 2>", ...],
  "experience_level": "<entry | mid | senior>",
  "match_tips": ["<actionable tip 1>", "<actionable tip 2>", ...]
}

Sensory Load Score criteria:
  1-3: Short, clear, well-structured. Easy to read.
  4-6: Moderate length, some jargon, manageable.
  7-10: Wall of text, heavy jargon, vague requirements, overwhelming.

Bias detection — look for:
  - "Must be able to stand/lift/travel" (when not essential to the role)
  - "Fast-paced environment" / "high-energy" (can exclude people with anxiety/chronic illness)
  - "Culture fit" (vague, can mask bias)
  - "Normal working hours" / "traditional office" (excludes people who need accommodations)
  - Gendered language, ableist idioms ("hit the ground running", "wear many hats")

Simplified summary rules:
  - Use short sentences (max 15 words each)
  - No jargon — explain technical terms in parentheses if needed
  - Use bullet points for requirements
  - Be encouraging, not intimidating

IMPORTANT: Return ONLY valid JSON. No markdown. No explanation outside the JSON.
"""


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if present in Gemini output."""
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


# API Endpoint

# Try gemini-2.5-flash first for best quality, fall back to other models if needed.
MODELS_TO_TRY = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
]


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_job_description(req: AnalyzeRequest):
    """Analyze a LinkedIn job description for accessibility."""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    raw_text: str | None = None

    try:
        client = genai.Client(api_key=api_key)

        response = None
        last_error: Exception | None = None
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=f"Analyze this job description:\n\n{req.job_description}",
                    config=genai.types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.3,
                        max_output_tokens=8192,
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

        raw_text = _strip_code_fences(response.text)
        result = json.loads(raw_text)
        return AnalyzeResponse(**result)

    except json.JSONDecodeError as e:
        preview = (raw_text or "")[:500]
        raise HTTPException(
            status_code=502,
            detail=f"Gemini returned invalid JSON: {e}. Raw: {preview}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")
