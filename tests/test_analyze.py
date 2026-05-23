"""
pytest test suite for the /analyze endpoint.

Usage:
  1. Start the server:  cd backend && uvicorn main:app --port 8000
  2. Run tests:         pytest tests/test_analyze.py -v

Requires httpx (already in requirements.txt).
"""

import pytest
import httpx

BASE_URL = "http://localhost:8000"

SAMPLE_JD = """
Software Engineer II - Backend Systems
TechCorp Inc. | San Francisco, CA (Hybrid)

About Us:
TechCorp is a fast-paced, high-energy startup disrupting the fintech space.
We're looking for rockstar engineers who can hit the ground running and thrive
in our dynamic, always-on culture. We work hard and play hard!

Responsibilities:
- Design, develop, and maintain scalable backend services using Python, Go, or Java
- Collaborate with cross-functional teams to define and ship new features
- Write clean, well-tested, production-ready code with comprehensive documentation
- Participate in code reviews, architecture discussions, and on-call rotations
- Debug and resolve production issues under pressure with tight deadlines
- Must be able to work in our San Francisco office at least 3 days per week during
  normal business hours (9am-6pm)
- Occasional travel required to client sites (up to 20%)

Requirements:
- BS/MS in Computer Science or equivalent experience
- 3-5 years of professional software engineering experience
- Strong proficiency in Python, SQL, and RESTful API design
- Experience with cloud platforms (AWS, GCP, or Azure)
- Familiarity with containerization (Docker, Kubernetes)
- Experience with CI/CD pipelines and DevOps practices
- Strong communication skills — must be articulate and outgoing
- Ability to multitask and context-switch rapidly between projects
- Must be comfortable presenting to large groups of stakeholders regularly

Nice to Have:
- Experience with machine learning frameworks (TensorFlow, PyTorch)
- Knowledge of financial systems and regulatory compliance
- Open source contributions
- Experience wearing many hats in a startup environment

Benefits:
- Competitive salary ($140K-$180K)
- Equity package
- Health, dental, vision insurance
- Unlimited PTO (we trust our people!)
- Team bonding events: hiking, sports leagues, escape rooms
- Standing desks and open floor plan office

We're an equal opportunity employer. We celebrate diversity and are committed
to creating an inclusive environment for all employees. Culture fit is important
to us — we want people who share our passion and energy!
"""


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """Shared httpx client for the test module."""
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        yield c


@pytest.fixture(scope="module")
def analysis(client):
    """Run the /analyze endpoint once and share the result across tests."""
    resp = client.post("/analyze", json={"job_description": SAMPLE_JD})
    assert resp.status_code == 200, f"Unexpected status {resp.status_code}: {resp.text}"
    return resp.json()


# ── Health check ──────────────────────────────────────────────────────────────

def test_health(client):
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("status") == "ok"


# ── Input validation ──────────────────────────────────────────────────────────

def test_empty_job_description_returns_422(client):
    resp = client.post("/analyze", json={"job_description": "   "})
    assert resp.status_code == 422


def test_missing_field_returns_422(client):
    resp = client.post("/analyze", json={})
    assert resp.status_code == 422


def test_oversized_job_description_returns_422(client):
    huge = "x" * 21_000
    resp = client.post("/analyze", json={"job_description": huge})
    assert resp.status_code == 422


# ── Response shape ────────────────────────────────────────────────────────────

def test_response_has_required_top_level_keys(analysis):
    required = {
        "title", "company", "sensory_load_score", "sensory_load_explanation",
        "bias_flags", "simplified_summary", "key_highlights",
        "key_skills", "experience_level", "match_tips",
    }
    assert required.issubset(analysis.keys())


def test_title_and_company_are_strings(analysis):
    assert isinstance(analysis["title"], str) and analysis["title"]
    assert isinstance(analysis["company"], str) and analysis["company"]


def test_sensory_load_score_in_range(analysis):
    score = analysis["sensory_load_score"]
    assert isinstance(score, int), "sensory_load_score must be an integer"
    assert 1 <= score <= 10, f"sensory_load_score {score} out of range 1-10"


def test_sensory_load_explanation_is_non_empty_string(analysis):
    assert isinstance(analysis["sensory_load_explanation"], str)
    assert len(analysis["sensory_load_explanation"]) > 0


def test_bias_flags_is_list(analysis):
    assert isinstance(analysis["bias_flags"], list)


def test_bias_flag_items_have_required_keys(analysis):
    for flag in analysis["bias_flags"]:
        assert "phrase" in flag, "bias flag missing 'phrase'"
        assert "issue" in flag, "bias flag missing 'issue'"
        assert "suggestion" in flag, "bias flag missing 'suggestion'"


def test_simplified_summary_is_non_empty(analysis):
    assert isinstance(analysis["simplified_summary"], str)
    assert len(analysis["simplified_summary"]) > 0


def test_key_highlights_is_non_empty_list(analysis):
    assert isinstance(analysis["key_highlights"], list)
    assert len(analysis["key_highlights"]) > 0


def test_key_skills_is_non_empty_list(analysis):
    assert isinstance(analysis["key_skills"], list)
    assert len(analysis["key_skills"]) > 0


def test_experience_level_is_valid(analysis):
    assert analysis["experience_level"] in ("entry", "mid", "senior"), \
        f"Unexpected experience_level: {analysis['experience_level']}"


def test_match_tips_is_non_empty_list(analysis):
    assert isinstance(analysis["match_tips"], list)
    assert len(analysis["match_tips"]) > 0


# ── Bias detection sanity check ───────────────────────────────────────────────

def test_bias_flags_detected_for_known_problematic_jd(analysis):
    """The sample JD contains several known bias phrases — at least one should be flagged."""
    assert len(analysis["bias_flags"]) > 0, \
        "Expected at least one bias flag for a JD with 'fast-paced', 'culture fit', etc."
