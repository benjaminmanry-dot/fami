from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public" / "assets" / "motion-spike" / "approved-source"
WEB_DIR = ROOT / "public" / "assets" / "motion-spike" / "web"
MANIFEST_PATH = ROOT / "docs" / "motion-spike-asset-manifest-2026-07-11.json"

ASSETS = {
    "A0": "Full Map, Dormant",
    "A1": "Full Map, Route Awakened",
    "B0": "Destination Close-Up, Dormant",
    "B1": "Destination Close-Up, Route Lit",
    "B2": "Destination Awakening, Midpoint",
    "C1": "Destination Fully Awakened",
}

WIDTHS = (1672, 960)
WEBP_QUALITY = 86
AVIF_QUALITY = 67
AVIF_SPEED = 4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def asset_record(path: Path, width: int, height: int, image_format: str) -> dict[str, object]:
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "format": image_format,
        "width": width,
        "height": height,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def main() -> None:
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "generated": "2026-07-11",
        "settings": {
            "resampling": "Pillow LANCZOS",
            "webp": {"quality": WEBP_QUALITY, "method": 6, "chroma": "encoder default"},
            "avif": {"quality": AVIF_QUALITY, "speed": AVIF_SPEED, "subsampling": "4:4:4"},
            "widths": list(WIDTHS),
        },
        "assets": {},
    }

    for key, title in ASSETS.items():
        source_path = SOURCE_DIR / f"{key}.png"
        if not source_path.is_file():
            raise FileNotFoundError(f"Missing approved source: {source_path}")

        with Image.open(source_path) as opened:
            opened.load()
            original = opened.convert("RGB")
            source_width, source_height = original.size
            source_entry = asset_record(source_path, source_width, source_height, "PNG")
            derivatives: list[dict[str, object]] = []

            for width in WIDTHS:
                height = round(source_height * width / source_width)
                resized = original if width == source_width else original.resize((width, height), Image.Resampling.LANCZOS)
                stem = f"{key.lower()}-{width}x{height}"

                webp_path = WEB_DIR / f"{stem}.webp"
                resized.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=6, exact=True)
                derivatives.append(asset_record(webp_path, width, height, "WebP"))

                avif_path = WEB_DIR / f"{stem}.avif"
                resized.save(
                    avif_path,
                    "AVIF",
                    quality=AVIF_QUALITY,
                    speed=AVIF_SPEED,
                    subsampling="4:4:4",
                )
                derivatives.append(asset_record(avif_path, width, height, "AVIF"))

        manifest["assets"][key] = {
            "title": title,
            "source": source_entry,
            "derivatives": derivatives,
        }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
