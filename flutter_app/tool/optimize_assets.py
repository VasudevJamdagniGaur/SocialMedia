#!/usr/bin/env python3
"""Resize and compress Flutter bundle assets in-place."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "assets"

# Unused — safe to remove from the Flutter bundle.
UNUSED = [
    "images/hub-icon.png",
    "images/hub-logo.png",
    "images/Gemini_Generated_Image_5f1pdr5f1pdr5f1p.png",
    "images/Gemini_Generated_Image_enm22aenm22aenm2.png",
    "icons/Gemini_Generated_Image_enm22aenm22aenm2.png",
    "images/crew-icon.png",
    "icons/crew-icon.png",
    "images/icon-192.png",
    "images/icon-512.png",
    "images/ai-avatar.png",
    "images/DeteaIcon.png",
    "images/reddit-logo.png",
    "images/x-logo.png",
]

# (relative path, max edge px, output format)
OPTIMIZE = [
    ("images/reddit-logo-mono.png", 128, "WEBP"),
    ("images/apple-avatar.png", 256, "WEBP"),
    ("images/pineapple-avatar.png", 256, "WEBP"),
    ("images/carrot-avatar.png", 256, "WEBP"),
    ("images/banana-avatar.png", 256, "WEBP"),
    ("images/strawberry-avatar.png", 256, "WEBP"),
    ("images/broccoli-avatar.png", 256, "WEBP"),
    ("images/gemini-icon.png", 128, "WEBP"),
    ("images/grok-icon.png", 128, "WEBP"),
    ("images/openai-icon.png", 128, "WEBP"),
]


def resize_cover(img: Image.Image, size: int) -> Image.Image:
    w, h = img.size
    scale = size / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    if nw == nh:
        return resized
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas.paste(resized, (ox, oy), resized if resized.mode == "RGBA" else None)
    return canvas


def save_webp(path: Path, img: Image.Image, quality: int = 82) -> None:
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    img.save(path, format="WEBP", quality=quality, method=6)


def main() -> None:
    removed_kb = 0
    for rel in UNUSED:
        path = ROOT / rel
        if path.exists():
            removed_kb += path.stat().st_size // 1024
            path.unlink()
            print(f"removed {rel}")

    for rel, max_edge, fmt in OPTIMIZE:
        src = ROOT / rel
        if not src.exists():
            print(f"skip missing {rel}")
            continue
        before = src.stat().st_size
        img = Image.open(src)
        out = resize_cover(img, max_edge)
        webp_path = src.with_suffix(".webp")
        save_webp(webp_path, out)
        src.unlink()
        after = webp_path.stat().st_size
        print(f"optimized {rel} -> {webp_path.name} ({before // 1024}KB -> {after // 1024}KB)")

    total = sum(f.stat().st_size for f in ROOT.rglob("*") if f.is_file())
    print(f"removed ~{removed_kb}KB unused; assets now {total // 1024}KB")


if __name__ == "__main__":
    main()
