"""
POST /profile-score — Accessibility score for a LinkedIn profile.

Scores are calculated DETERMINISTICALLY in Python using real text metrics.
Gemini is only used to generate the qualitative feedback text (tips, summary).
Same profile → same score every time.

Scoring breakdown (each 0–10, weighted equally → overall 0–100):
  1. Plain Language      — Flesch-Kincaid reading ease proxy (avg syllables/word)
  2. Sentence Length     — % of sentences ≤ 20 words
  3. Jargon & Buzzwords  — density of known corporate buzzwords
  4. Clarity & Structure — presence of headline, about section, reasonable length
  5. Inclusive Language  — absence of known ableist / exclusionary phrases
"""

import asyncio
import json
import math
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
    category: str
    score: int       # 0–10, calculated deterministically
    feedback: str    # AI-generated, describes what was found
    tip: str         # AI-generated, one actionable improvement


class ProfileScoreResponse(BaseModel):
    overall_score: int              # 0–100, deterministic
    grade: str                      # A / B / C / D / F
    summary: str                    # AI-generated
    breakdown: list[ScoreBreakdown]
    top_wins: list[str]             # AI-generated
    top_fixes: list[str]            # AI-generated


# ══════════════════════════════════════════════════════════════════════════════
# DETERMINISTIC SCORING ENGINE
# ══════════════════════════════════════════════════════════════════════════════

# Corporate buzzwords that hurt readability for neurodivergent users
JARGON_WORDS: set[str] = {
    "synergy", "synergize", "leverage", "leveraging", "leveraged",
    "rockstar", "ninja", "wizard", "guru", "evangelist", "champion",
    "disruptive", "disrupting", "disruption", "innovative", "innovation",
    "thought leader", "thought leadership", "visionary",
    "passionate", "passionate about", "driven", "self-driven",
    "go-getter", "go getter", "hustler", "hustle",
    "hit the ground running", "wear many hats", "wearing many hats",
    "move the needle", "move the dial", "boil the ocean",
    "circle back", "deep dive", "bandwidth", "bandwidth for",
    "low-hanging fruit", "low hanging fruit", "paradigm shift",
    "value-add", "value add", "value proposition",
    "ecosystem", "holistic", "robust", "scalable", "cutting-edge",
    "best-in-class", "world-class", "best in class",
    "dynamic", "results-driven", "results driven",
    "proactive", "strategic thinker", "outside the box",
    "game changer", "game-changer", "next level",
}

# Ableist / exclusionary phrases
ABLEIST_PHRASES: list[str] = [
    "fast-paced", "fast paced", "high-energy", "high energy",
    "always on", "always-on", "24/7", "24x7",
    "hit the ground running", "wear many hats",
    "normal working hours", "traditional office",
    "culture fit", "culture-fit",
    "stand up", "stand-up meeting",
    "walk through", "walk-through",
    "blind spot", "blind spots",
    "tone deaf", "tone-deaf",
    "crazy", "insane", "nuts", "psycho",
    "lame", "dumb", "stupid",
    "crippled", "crippling",
    "sanity check", "sanity-check",
]


def _sentences(text: str) -> list[str]:
    """Split text into sentences."""
    raw = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s.strip() for s in raw if len(s.strip()) > 3]


def _words(text: str) -> list[str]:
    return re.findall(r'\b[a-zA-Z]+\b', text.lower())


def _syllable_count(word: str) -> int:
    """Rough syllable count — counts vowel groups."""
    word = word.lower().rstrip('e')
    count = len(re.findall(r'[aeiou]+', word))
    return max(1, count)


def _avg_syllables_per_word(words: list[str]) -> float:
    if not words:
        return 1.0
    return sum(_syllable_count(w) for w in words) / len(words)


# ── Category scorers (each returns int 0–10) ─────────────────────────────────

def score_plain_language(text: str) -> tuple[int, dict]:
    """Score based on average syllables per word (reading ease proxy)."""
    words = _words(text)
    if not words:
        return 5, {"avg_syllables": 0, "word_count": 0}

    avg_syl = _avg_syllables_per_word(words)
    word_count = len(words)

    # avg syllables: ≤1.3 → easy, 1.3–1.6 → medium, >1.6 → hard
    if avg_syl <= 1.25:
        raw = 10
    elif avg_syl <= 1.35:
        raw = 9
    elif avg_syl <= 1.45:
        raw = 7
    elif avg_syl <= 1.55:
        raw = 5
    elif avg_syl <= 1.65:
        raw = 3
    else:
        raw = 1

    return raw, {"avg_syllables": round(avg_syl, 2), "word_count": word_count}


def score_sentence_length(text: str) -> tuple[int, dict]:
    """Score based on % of sentences ≤ 20 words."""
    sentences = _sentences(text)
    if not sentences:
        return 5, {"total_sentences": 0, "short_pct": 0}

    short = sum(1 for s in sentences if len(_words(s)) <= 20)
    pct = short / len(sentences)

    if pct >= 0.90:
        raw = 10
    elif pct >= 0.75:
        raw = 8
    elif pct >= 0.60:
        raw = 6
    elif pct >= 0.45:
        raw = 4
    elif pct >= 0.30:
        raw = 2
    else:
        raw = 1

    avg_len = sum(len(_words(s)) for s in sentences) / len(sentences)
    return raw, {
        "total_sentences": len(sentences),
        "short_pct": round(pct * 100, 1),
        "avg_words_per_sentence": round(avg_len, 1),
    }


def score_jargon(text: str) -> tuple[int, dict]:
    """Score based on jargon density (jargon hits per 100 words)."""
    text_lower = text.lower()
    words = _words(text)
    if not words:
        return 8, {"hits": 0, "density": 0}

    hits = []
    for phrase in JARGON_WORDS:
        if phrase in text_lower:
            hits.append(phrase)

    density = len(hits) / max(len(words), 1) * 100  # per 100 words

    if density == 0:
        raw = 10
    elif density < 0.5:
        raw = 9
    elif density < 1.0:
        raw = 7
    elif density < 2.0:
        raw = 5
    elif density < 3.5:
        raw = 3
    else:
        raw = 1

    return raw, {"hits": hits[:5], "density": round(density, 2)}


def score_structure(headline: str, about: str, experience: str) -> tuple[int, dict]:
    """Score based on presence and quality of profile sections."""
    points = 0
    details = {}

    # Has a headline
    has_headline = len(headline.strip()) > 10
    details["has_headline"] = has_headline
    if has_headline:
        points += 2

    # Headline is not too long (≤ 15 words is ideal)
    headline_words = len(_words(headline))
    details["headline_words"] = headline_words
    if has_headline and headline_words <= 15:
        points += 1

    # Has an about section
    has_about = len(about.strip()) > 50
    details["has_about"] = has_about
    if has_about:
        points += 2

    # About is a reasonable length (50–500 words — not too short, not a wall)
    about_words = len(_words(about))
    details["about_words"] = about_words
    if 50 <= about_words <= 500:
        points += 2
    elif about_words > 0:
        points += 1

    # Has experience section
    has_exp = len(experience.strip()) > 30
    details["has_experience"] = has_exp
    if has_exp:
        points += 2

    # Cap at 10
    raw = min(10, points)
    return raw, details


def score_inclusive_language(text: str) -> tuple[int, dict]:
    """Score based on absence of ableist / exclusionary phrases."""
    text_lower = text.lower()
    found = [p for p in ABLEIST_PHRASES if p in text_lower]

    if len(found) == 0:
        raw = 10
    elif len(found) == 1:
        raw = 7
    elif len(found) == 2:
        raw = 5
    elif len(found) == 3:
        raw = 3
    else:
        raw = 1

    return raw, {"found": found[:5]}


def calculate_scores(req: ProfileScoreRequest) -> dict[str, tuple[int, dict]]:
    """Run all 5 deterministic scorers. Returns {category: (score, details)}."""
    full_text = " ".join(filter(None, [req.headline, req.about, req.experience]))

    return {
        "Plain Language":      score_plain_language(full_text),
        "Sentence Length":     score_sentence_length(full_text),
        "Jargon & Buzzwords":  score_jargon(full_text),
        "Clarity & Structure": score_structure(req.headline, req.about, req.experience),
        "Inclusive Language":  score_inclusive_language(full_text),
    }


def overall_score_and_grade(scores: dict[str, tuple[int, dict]]) -> tuple[int, str]:
    """Weighted average → 0–100 score and letter grade."""
    # Equal weight for all 5 categories
    avg = sum(s for s, _ in scores.values()) / len(scores)
    total = round(avg * 10)  # 0–10 avg → 0–100

    if total >= 85:
        grade = "A"
    elif total >= 70:
        grade = "B"
    elif total >= 55:
        grade = "C"
    elif total >= 40:
        grade = "D"
    else:
        grade = "F"

    return total, grade


# ══════════════════════════════════════════════════════════════════════════════
# GEMINI — FEEDBACK TEXT ONLY (not scores)
# ══════════════════════════════════════════════════════════════════════════════

def _build_feedback_prompt(req: ProfileScoreRequest, scores: dict) -> str:
    lines = []
    for cat, (score, details) in scores.items():
        lines.append(f"- {cat}: {score}/10 | details: {details}")

    return f"""LinkedIn profile to evaluate:
Name: {req.name or 'Unknown'}
Headline: {req.headline or '(none)'}
About: {(req.about or '(none)')[:800]}
Experience: {(req.experience or '(none)')[:600]}

Pre-calculated scores (DO NOT change these numbers):
{chr(10).join(lines)}

Return a JSON object with EXACTLY these fields:
{{
  "summary": "<2 short plain-English sentences about overall accessibility, max 30 words>",
  "breakdown_feedback": {{
    "Plain Language":      {{"feedback": "<max 10 words>", "tip": "<max 10 words>"}},
    "Sentence Length":     {{"feedback": "<max 10 words>", "tip": "<max 10 words>"}},
    "Jargon & Buzzwords":  {{"feedback": "<max 10 words>", "tip": "<max 10 words>"}},
    "Clarity & Structure": {{"feedback": "<max 10 words>", "tip": "<max 10 words>"}},
    "Inclusive Language":  {{"feedback": "<max 10 words>", "tip": "<max 10 words>"}}
  }},
  "top_wins": ["<max 8 words>", "<max 8 words>"],
  "top_fixes": ["<max 8 words>", "<max 8 words>", "<max 8 words>"]
}}

Rules:
- Keep all text SHORT (max words as specified).
- top_wins = what the profile does well for accessibility.
- top_fixes = most impactful improvements for neurodivergent readers.
- Return ONLY valid JSON. No markdown.
"""


FEEDBACK_SYSTEM = (
    "You write short, plain-English accessibility feedback for LinkedIn profiles. "
    "Be direct and specific. Never use jargon. Max 10 words per feedback/tip field."
)

MODELS_TO_TRY = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
]


def _strip_code_fences(text: str) -> str:
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/profile-score", response_model=ProfileScoreResponse)
async def score_profile(req: ProfileScoreRequest):
    """Score a LinkedIn profile for accessibility (deterministic scores + AI feedback)."""

    if not any([req.headline.strip(), req.about.strip(), req.experience.strip()]):
        raise HTTPException(
            status_code=400,
            detail="At least one of headline, about, or experience must be provided",
        )

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    # ── Step 1: Calculate scores deterministically ────────────────────────────
    scores = calculate_scores(req)
    total, grade = overall_score_and_grade(scores)

    # ── Step 2: Ask Gemini only for feedback text ─────────────────────────────
    raw_text: str | None = None
    try:
        client = genai.Client(api_key=api_key)
        prompt = _build_feedback_prompt(req, scores)

        response = None
        last_error: Exception | None = None
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=genai.types.GenerateContentConfig(
                        system_instruction=FEEDBACK_SYSTEM,
                        temperature=0.3,
                        max_output_tokens=1024,
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
        feedback = json.loads(raw_text)

    except (json.JSONDecodeError, Exception):
        # If Gemini fails, fall back to generic feedback — scores still show
        feedback = {
            "summary": "Profile scored. See breakdown for details.",
            "breakdown_feedback": {
                cat: {"feedback": "See score above.", "tip": "Review this category."}
                for cat in scores
            },
            "top_wins": ["Profile has content to evaluate."],
            "top_fixes": ["Review low-scoring categories above."],
        }

    # ── Step 3: Assemble final response ──────────────────────────────────────
    bf = feedback.get("breakdown_feedback", {})
    breakdown = [
        ScoreBreakdown(
            category=cat,
            score=score,
            feedback=bf.get(cat, {}).get("feedback", ""),
            tip=bf.get(cat, {}).get("tip", ""),
        )
        for cat, (score, _) in scores.items()
    ]

    return ProfileScoreResponse(
        overall_score=total,
        grade=grade,
        summary=feedback.get("summary", ""),
        breakdown=breakdown,
        top_wins=feedback.get("top_wins", []),
        top_fixes=feedback.get("top_fixes", []),
    )
