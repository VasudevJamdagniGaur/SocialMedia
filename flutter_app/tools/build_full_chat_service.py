#!/usr/bin/env python3
"""Assemble chat_service.dart from part files."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTS = [
    ROOT / "lib" / "services" / "chat_service_parts" / "part1.dart",
    ROOT / "lib" / "services" / "chat_service_parts" / "part2.dart",
    ROOT / "lib" / "services" / "chat_service_parts" / "part3.dart",
    ROOT / "lib" / "services" / "chat_service_parts" / "part4.dart",
]
OUT = ROOT / "lib" / "services" / "chat_service.dart"

content = []
for p in PARTS:
    if not p.exists():
        raise SystemExit(f"Missing part: {p}")
    content.append(p.read_text(encoding="utf-8"))

OUT.write_text("\n".join(content), encoding="utf-8")
print(f"Wrote {OUT} ({len(content)} parts, {OUT.read_text(encoding='utf-8').count(chr(10))} lines)")
