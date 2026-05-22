"""
Test script for the /analyze endpoint.

Usage:
  1. Start the server:  cd backend && uvicorn main:app --port 8000
  2. Run this script:   python tests/test_analyze.py

Or test manually with curl:
  curl -X POST http://localhost:8000/analyze \
    -H "Content-Type: application/json" \
    -d @tests/sample_jd.json
"""

import json
import sys
import urllib.request
import urllib.error

API_URL = "http://localhost:8000/analyze"

# ── Realistic placeholder LinkedIn job description ───────────────────────────

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


def main():
    print("=" * 60)
    print("  LinkedIn Access+ — Analyze Endpoint Test")
    print("=" * 60)

    # First, check if server is running
    try:
        health_req = urllib.request.Request("http://localhost:8000/")
        with urllib.request.urlopen(health_req, timeout=5) as resp:
            health = json.loads(resp.read())
            print(f"\n✅ Server is running: {health}")
    except Exception as e:
        print(f"\n❌ Server not reachable: {e}")
        print("   Start it with: cd backend && uvicorn main:app --port 8000")
        sys.exit(1)

    # Send analyze request
    print(f"\n📄 Sending job description ({len(SAMPLE_JD)} chars)...")
    print("-" * 60)

    payload = json.dumps({"job_description": SAMPLE_JD}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"\n❌ HTTP {e.code}: {body}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Request failed: {e}")
        sys.exit(1)

    # Pretty-print results
    print(f"\n🏢 {result.get('title', '?')} @ {result.get('company', '?')}")
    print(f"\n📊 Sensory Load Score: {result.get('sensory_load_score', '?')}/10")
    print(f"   {result.get('sensory_load_explanation', '')}")

    flags = result.get("bias_flags", [])
    print(f"\n⚠️  Bias Flags ({len(flags)} found):")
    for f in flags:
        print(f"   • \"{f['phrase']}\"")
        print(f"     Issue: {f['issue']}")
        print(f"     Better: {f['suggestion']}")

    print(f"\n📝 Simplified Summary:")
    print(f"   {result.get('simplified_summary', '?')}")

    highlights = result.get("key_highlights", [])
    print(f"\n⭐ Key Highlights:")
    for h in highlights:
        print(f"   • {h}")

    skills = result.get("key_skills", [])
    print(f"\n🛠️  Key Skills: {', '.join(skills)}")
    print(f"📈 Experience Level: {result.get('experience_level', '?')}")

    tips = result.get("match_tips", [])
    print(f"\n💡 Match Tips:")
    for t in tips:
        print(f"   • {t}")

    print("\n" + "=" * 60)
    print("  Full JSON Response:")
    print("=" * 60)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
