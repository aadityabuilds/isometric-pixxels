"""Redraw Pearce Mitchell / The Row as one 2K plate so the x=3300 seam is gone.

The previous Row plate started at x=3300 and cut through the condo cluster, so
two drawings of the same houses sit on top of each other. This plate is shifted
west so that cut is in the interior.

  python experiments/nanobanana/fix_row_seam.py generate
  python experiments/nanobanana/fix_row_seam.py paste
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(HERE))
import nb  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
AI = ROOT / "data" / "ai"
SIZE = 2048
EDGE = 20
BUDGET = 4.55
XY = (2280, 1570)
RAW = AI / "raw" / "west_row_seam.jpg"

PROMPT = """Restyle Image 1 into a finished plate of the existing isometric pixel-art campus map.

IMAGE 1 is the geometrically correct render of this exact crop: same camera, same zoom, true building footprints and roads. Keep EVERY position. Your output must overlay Image 1 — do not zoom, crop, rotate or reframe.

IMAGE 2 is the blank-wall layout of the same crop (confirms footprints and heights).
IMAGE 3 is a finished tile of this same map (the Main Quad). Match its crisp pixel-art style, outlines, palette, lighting from the upper left, trees and ground.
IMAGE 4 is the real aerial photo warped onto this ground plane — use it for roof colours and planting, not for camera.
IMAGE 5 is a second pixel-map style reference; technique only.

THIS PLATE IS ONE NEIGHBORHOOD
Pearce Mitchell Condos, The Row (Gould House, Bolivar House and the other row houses), Mayfield houses, and Munger. Draw each building exactly once, on Image 1's footprint. Do not overlay a second house, a ghost, or a second tree on the same lot.

HARD RULES
- No text, no labels, no names, no legend, no watermark, no UI.
- 2:1 isometric, 30° elevation, lighting from the upper left, same framing as Image 1.
- Stanford houses: cream or buff walls, red clay tile roofs, among tall trees. Munger is larger modern residences with red tile roofs.
- Clean pixel-art ground: asphalt with kerbs, pale paving, lawns, empty parking. No people, cars or signs.
- Do not invent buildings on open ground.
- Beige outside the map diamond stays flat beige.
"""


def feather_paste(dst, src, x, y, edge=EDGE):
    h, w = src.shape[:2]
    patch = src.astype(np.float32)
    wt = np.ones((h, w), np.float32)
    ramp = np.linspace(0, 1, edge, dtype=np.float32)
    wt[:, :edge] = np.minimum(wt[:, :edge], ramp[None, :])
    wt[:, -edge:] = np.minimum(wt[:, -edge:], ramp[::-1][None, :])
    wt[:edge, :] = np.minimum(wt[:edge, :], ramp[:, None])
    wt[-edge:, :] = np.minimum(wt[-edge:, :], ramp[::-1][:, None])
    sl = dst[y : y + h, x : x + w].astype(np.float32)
    dst[y : y + h, x : x + w] = (sl * (1 - wt[..., None]) + patch * wt[..., None]).astype(np.uint8)


def generate():
    x, y = XY
    geo = np.asarray(Image.open(ROOT / "data" / "build" / "final.png").convert("RGB"))
    layout = np.asarray(Image.open(AI / "layout.png").convert("RGB"))
    aerial = Image.open(AI / "aerial.png").convert("RGB")
    style = Image.open(HERE / "style_anchor.jpg").convert("RGB")
    style2 = Image.open(HERE / "style_pixel_chennai.png").convert("RGB")
    files = [AI / "in_geo.jpg", AI / "in_layout.png", AI / "in_style.jpg", AI / "in_aerial.jpg", AI / "in_style2.png"]
    Image.fromarray(geo[y : y + SIZE, x : x + SIZE]).save(files[0], quality=88)
    Image.fromarray(layout[y : y + SIZE, x : x + SIZE]).save(files[1])
    style.save(files[2], quality=88)
    aerial.crop((x, y, x + SIZE, y + SIZE)).save(files[3], quality=86)
    style2.save(files[4])
    RAW.parent.mkdir(exist_ok=True)
    print(f"plate row_seam {x},{y} {x+SIZE},{y+SIZE} spent=${nb.spent():.2f}", flush=True)
    res = nb.generate(
        "gemini-nano-banana-2.1",
        PROMPT,
        [str(f) for f in files],
        str(RAW),
        size="2K",
        budget=BUDGET - 0.08,
    )
    if not res or not RAW.exists():
        raise SystemExit("no image")
    img = Image.open(RAW).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    img.save(AI / "tiles" / "west_row_seam.png")
    print(f"wrote {RAW} spent=${nb.spent():.2f}", flush=True)


def paste():
    if not RAW.exists():
        raise SystemExit("run generate first")
    x, y = XY
    shutil.copy2(AI / "ai_final.png", AI / "ai_final.before_row_seam.png")
    canvas = np.asarray(Image.open(AI / "ai_final.png").convert("RGB")).copy()
    mask = np.asarray(Image.open(AI / "mask.png").convert("L"))
    geo = np.asarray(Image.open(ROOT / "data" / "build" / "final.png").convert("RGB"))
    img = Image.open(RAW).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    feather_paste(canvas, np.asarray(img), x, y)
    out = np.where((mask > 0)[..., None], canvas, geo)
    Image.fromarray(out).save(AI / "ai_final.png", compress_level=1)
    t, step = 1024, 896
    H, W = out.shape[:2]
    xs = sorted(set(list(range(0, W - t, step)) + [W - t]))
    ys = sorted(set(list(range(0, H - t, step)) + [H - t]))
    n = 0
    x1, y1 = x + SIZE, y + SIZE
    for ty in ys:
        for tx in xs:
            if tx < x1 and tx + t > x and ty < y1 and ty + t > y:
                Image.fromarray(out[ty : ty + t, tx : tx + t]).save(AI / "tiles" / f"{tx}_{ty}.png")
                n += 1
    print(f"pasted at {XY}, updated {n} 1K tiles", flush=True)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "generate"
    if cmd == "generate":
        generate()
    elif cmd == "paste":
        paste()
    else:
        raise SystemExit("generate | paste")
