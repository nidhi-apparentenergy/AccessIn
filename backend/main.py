# main.py
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import analyze, simplify, describe

# Load .env from the same directory as this file
load_dotenv(Path(__file__).parent / ".env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this later
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze.router)
app.include_router(simplify.router)
app.include_router(describe.router)


@app.get("/")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "linkedin-access-plus"}