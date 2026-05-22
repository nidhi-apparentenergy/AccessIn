"""
POST /describe — Placeholder route (to be implemented).
"""

from fastapi import APIRouter

router = APIRouter()


@router.post("/describe")
async def describe_element():
    return {"status": "not_implemented", "message": "Describe endpoint coming soon"}
