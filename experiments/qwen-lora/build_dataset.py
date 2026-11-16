"""Cut Nano Banana / plain-render pairs for a Qwen-Image-Edit-2511 style LoRA.

Control  = data/build/final.png  (the code-drawn map we will feed at inference)
Target   = data/ai/ai_final.png  (Nano Banana illustration of the same crop)

Also writes the exact 1024 tiles Nano Banana generated, which are the cleanest pairs.

Run:  pipeline/.venv/bin/python experiments/qwen-lora/build_dataset.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[2]
AI = ROOT / "data" / "ai"
OUT = AI / "lora_pairs"
T = 1024
STEP = 512
CAPTION = (
    "Redraw this isometric Stanford campus render as SimCity 2000 pixel art. "
    "Keep the camera, every building footprint, road, path, lawn and tree exactly in place. "
    "Buff sandstone or cream stucco, red clay tile roofs, crisp pixel outlines, empty campus. "
    "No people, no cars, no signs, no lettering."
)


def save_pair(control: Image.Image, target: Image.Image, stem: str) -> None:
    control.save(OUT / "control" / f"{stem}.jpg", quality=92)
    target.save(OUT / "target" / f"{stem}.jpg", quality=92)
    (OUT / "target" / f"{stem}.txt").write_text(CAPTION)


def main() -> None:
    for sub in ("control", "target"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    control_src = Image.open(ROOT / "data" / "build" / "final.png").convert("RGB")
    target_src = Image.open(AI / "ai_final.png").convert("RGB")
    mask = np.asarray(Image.open(AI / "mask.png").convert("L"))
    W, H = control_src.size
    seen: set[tuple[int, int]] = set()
    n = 0

    def add(x: int, y: int) -> None:
        nonlocal n
        if (x, y) in seen:
            return
        if x < 0 or y < 0 or x + T > W or y + T > H:
            return
        cover = mask[y : y + T, x : x + T].mean() / 255.0
        if cover < 0.28:
            return
        seen.add((x, y))
        box = (x, y, x + T, y + T)
        save_pair(control_src.crop(box), target_src.crop(box), f"{x:05d}_{y:05d}")
        n += 1

    # Exact Nano Banana tiles first (highest-quality pairs).
    state = json.loads((AI / "state.json").read_text()) if (AI / "state.json").exists() else {"done": []}
    for rec in state.get("done", []):
        add(int(rec["x"]), int(rec["y"]))

    xs = sorted(set(list(range(0, W - T, STEP)) + [W - T]))
    ys = sorted(set(list(range(0, H - T, STEP)) + [H - T]))
    for y in ys:
        for x in xs:
            add(x, y)

    meta = {
        "caption": CAPTION,
        "size": T,
        "pairs": n,
        "control": "data/build/final.png",
        "target": "data/ai/ai_final.png",
        "stems": [f"{x:05d}_{y:05d}" for x, y in sorted(seen)],
    }
    (OUT / "metadata.json").write_text(json.dumps(meta, indent=2))
    (OUT / "dataset.toml").write_text(
        f"""[general]
resolution = [1024, 1024]
caption_extension = ".txt"
batch_size = 1
enable_bucket = false
num_repeats = 4

[[datasets]]
image_directory = "{(OUT / 'target').resolve()}"
control_directory = "{(OUT / 'control').resolve()}"
cache_directory = "{(OUT / 'cache').resolve()}"
control_resolution = [1024, 1024]
"""
    )
    named = [(int(r["x"]), int(r["y"])) for r in state.get("done", []) if (int(r["x"]), int(r["y"])) in seen]
    preview(named[:4] or sorted(seen)[:4])
    print(f"wrote {n} pairs under {OUT}", flush=True)


def preview(coords: list[tuple[int, int]]) -> None:
    rows = min(4, len(coords))
    cell = 360
    gap = 8
    sheet = Image.new("RGB", (2 * cell + gap, rows * cell + 28), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 6), "control  (plain render)", fill=(200, 200, 200))
    draw.text((cell + gap + 12, 6), "target  (Nano Banana)", fill=(200, 200, 200))
    for i, (x, y) in enumerate(coords[:rows]):
        stem = f"{x:05d}_{y:05d}"
        left = Image.open(OUT / "control" / f"{stem}.jpg").resize((cell, cell), Image.BILINEAR)
        right = Image.open(OUT / "target" / f"{stem}.jpg").resize((cell, cell), Image.BILINEAR)
        oy = 28 + i * cell
        sheet.paste(left, (0, oy))
        sheet.paste(right, (cell + gap, oy))
    out = Path(__file__).resolve().parent / "pairs_preview.jpg"
    sheet.save(out, quality=86)
    print("preview", out, flush=True)


if __name__ == "__main__":
    main()
