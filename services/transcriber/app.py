"""Local OpenAI-compatible transcription service for Taysriul Qur'ani."""

from __future__ import annotations

import asyncio
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel


app = FastAPI(title="Taysriul Qur'ani Local Transcriber", version="1.2.0")
transcription_lock = asyncio.Lock()


def setting(name: str, default: str) -> str:
    return os.getenv(name, default).strip() or default


@lru_cache(maxsize=1)
def load_model() -> WhisperModel:
    return WhisperModel(
        setting("WHISPER_MODEL", "small"),
        device=setting("WHISPER_DEVICE", "cpu"),
        compute_type=setting("WHISPER_COMPUTE_TYPE", "int8"),
        download_root=setting("WHISPER_DOWNLOAD_ROOT", "/models/whisper"),
        cpu_threads=max(1, int(setting("WHISPER_CPU_THREADS", str(os.cpu_count() or 4)))),
    )


def run_transcription(file_path: str, language: str | None) -> dict:
    model = load_model()
    segments_source, info = model.transcribe(
        file_path,
        language=(language or "ar"),
        beam_size=max(1, int(setting("WHISPER_BEAM_SIZE", "5"))),
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=False,
    )
    segments = []
    text_parts = []
    for item in segments_source:
        text = item.text.strip()
        if not text:
            continue
        text_parts.append(text)
        words = [
            {"start": word.start, "end": word.end, "word": word.word, "probability": word.probability}
            for word in (item.words or [])
        ]
        segments.append({
            "id": item.id,
            "start": item.start,
            "end": item.end,
            "text": text,
            "avg_logprob": item.avg_logprob,
            "no_speech_prob": item.no_speech_prob,
            "words": words,
        })
    return {
        "task": "transcribe",
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "text": " ".join(text_parts),
        "segments": segments,
        "model": setting("WHISPER_MODEL", "small"),
    }


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "taysriul-local-transcriber",
        "model": setting("WHISPER_MODEL", "small"),
        "device": setting("WHISPER_DEVICE", "cpu"),
        "loaded": load_model.cache_info().currsize > 0,
    }


@app.get("/v1/models")
def models() -> dict:
    model = setting("WHISPER_MODEL", "small")
    return {"object": "list", "data": [{"id": model, "object": "model", "owned_by": "local"}]}


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: Annotated[UploadFile, File(description="Audio or video source")],
    model: Annotated[str | None, Form()] = None,
    language: Annotated[str | None, Form()] = "ar",
    response_format: Annotated[str | None, Form()] = "verbose_json",
) -> dict:
    del model, response_format
    maximum = int(setting("WHISPER_MAX_UPLOAD_BYTES", "536870912"))
    if file.size is not None and file.size > maximum:
        raise HTTPException(status_code=413, detail="Berkas melampaui batas unggah.")
    suffix = Path(file.filename or "audio.bin").suffix[:12]
    temporary_path = ""
    written = 0
    try:
        with tempfile.NamedTemporaryFile(prefix="tq-audio-", suffix=suffix, delete=False) as temporary:
            temporary_path = temporary.name
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > maximum:
                    raise HTTPException(status_code=413, detail="Berkas melampaui batas unggah.")
                temporary.write(chunk)
        async with transcription_lock:
            return await asyncio.to_thread(run_transcription, temporary_path, language)
    finally:
        await file.close()
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
