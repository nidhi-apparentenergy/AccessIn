"""
POST /simplify — Placeholder route (to be implemented).
"""

from fastapi import APIRouter

router = APIRouter()


@router.post("/simplify")
async def simplify_text():
    return {"status": "not_implemented", "message": "Simplify endpoint coming soon"}
