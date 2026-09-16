#!/usr/bin/env python3
"""Optional local/offline transcription helper.

This script does not call OpenAI APIs and does not require an API key. It uses
locally installed transcription libraries when available.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def write_markdown(out_path: Path, source: Path, method: str, segments: list[tuple[str, str, str]]) -> None:
    lines = [
        f"# Raw Transcript: {source.name}",
        "",
        f"- Source: `{source}`",
        f"- Transcription method: {method}",
        "- Review status: unreviewed",
        "",
        "## Transcript",
        "",
    ]
    for start, end, text in segments:
        lines.append(f"[{start} - {end}] {text}".rstrip())
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


def timestamp(seconds: float) -> str:
    seconds = max(0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def transcribe_with_faster_whisper(audio: Path, model_name: str, language: str | None) -> list[tuple[str, str, str]]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="auto", compute_type="auto")
    segments, _info = model.transcribe(str(audio), language=language, vad_filter=True)
    return [(timestamp(seg.start), timestamp(seg.end), seg.text.strip()) for seg in segments]


def transcribe_with_whisper(audio: Path, model_name: str, language: str | None) -> list[tuple[str, str, str]]:
    import whisper

    model = whisper.load_model(model_name)
    kwargs = {}
    if language:
        kwargs["language"] = language
    result = model.transcribe(str(audio), **kwargs)
    segments = result.get("segments", [])
    return [(timestamp(seg.get("start", 0)), timestamp(seg.get("end", 0)), seg.get("text", "").strip()) for seg in segments]


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe local session audio without API calls.")
    parser.add_argument("audio", help="Path to local audio/video file.")
    parser.add_argument("--out", required=True, help="Output raw_transcript.md path.")
    parser.add_argument("--model", default="small", help="Local Whisper model name, such as tiny/base/small/medium.")
    parser.add_argument("--language", default="en", help="Language code, or empty string for autodetect.")
    parser.add_argument("--engine", choices=["auto", "faster-whisper", "whisper"], default="auto")
    args = parser.parse_args()

    audio = Path(args.audio)
    out = Path(args.out)
    if not audio.exists():
        print(f"Audio file not found: {audio}", file=sys.stderr)
        return 2

    language = args.language or None
    errors: list[str] = []

    if args.engine in {"auto", "faster-whisper"}:
        try:
            segments = transcribe_with_faster_whisper(audio, args.model, language)
            write_markdown(out, audio, f"faster-whisper local model `{args.model}`", segments)
            print(out)
            return 0
        except Exception as exc:  # noqa: BLE001
            errors.append(f"faster-whisper unavailable or failed: {exc}")

    if args.engine in {"auto", "whisper"}:
        try:
            segments = transcribe_with_whisper(audio, args.model, language)
            write_markdown(out, audio, f"whisper local model `{args.model}`", segments)
            print(out)
            return 0
        except Exception as exc:  # noqa: BLE001
            errors.append(f"whisper unavailable or failed: {exc}")

    print("No supported local transcription engine succeeded.", file=sys.stderr)
    print("Install/use a local tool such as faster-whisper, whisper, or whisper.cpp, or provide an exported transcript.", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
