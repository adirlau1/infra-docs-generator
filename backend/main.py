import os
import sys
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

from analyzer import analyze

app = FastAPI(title="Infra Docs Generator", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

MAX_FILE_SIZE = 150_000  # 150 KB per file
MAX_TOTAL_SIZE = 400_000  # 400 KB combined


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze_route(
    files: List[UploadFile] = File(default=[]),
    content: str = Form(None),
):
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")

    # Collect (filename, text) pairs from uploaded files
    file_sections: list[tuple[str, str]] = []
    for f in files:
        if not f.filename:
            continue
        raw = await f.read()
        if len(raw) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"{f.filename} exceeds the 150 KB per-file limit",
            )
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail=f"{f.filename} is not valid UTF-8 text",
            )
        if text.strip():
            file_sections.append((f.filename, text))

    # Add pasted content
    if content and content.strip():
        file_sections.append(("pasted-content", content.strip()))

    if not file_sections:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one file or paste content",
        )

    # Combine and check total size
    is_multi = len(file_sections) > 1
    if is_multi:
        parts = [f"--- FILE: {name} ---\n{text}" for name, text in file_sections]
        combined = "\n\n".join(parts)
    else:
        combined = file_sections[0][1]

    if len(combined.encode()) > MAX_TOTAL_SIZE:
        raise HTTPException(
            status_code=400,
            detail="Combined input exceeds the 400 KB limit — reduce the number or size of files",
        )

    hint_filename = "" if is_multi else file_sections[0][0]

    try:
        result = analyze(combined, hint_filename, is_multi=is_multi)
    except Exception as exc:
        msg = str(exc)
        if any(k in msg.lower() for k in ("api_key", "authentication", "invalid_api_key", "unauthorized")):
            raise HTTPException(status_code=500, detail="OpenAI authentication failed — check OPENAI_API_KEY")
        if "rate_limit" in msg.lower():
            raise HTTPException(status_code=429, detail="OpenAI rate limit reached — try again shortly")
        if any(k in msg.lower() for k in ("context_length", "too long", "maximum context")):
            raise HTTPException(status_code=400, detail="Input too long for model context window — reduce file size")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {msg}")

    return result


FRONTEND = Path(__file__).parent.parent / "frontend"
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
