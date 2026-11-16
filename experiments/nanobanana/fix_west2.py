"""Second attempt: 2.1 restyle of the geometrically-correct crop. No labels."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(HERE))
import nb  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
AI = ROOT / "data" / "ai"
SIZE = 2048
EDGE = 24
BUDGET = 4.55

PLATES = [
    {"name": "lake", "xy": (4200, 0)},
    {"name": "row", "xy": (3300, 1280)},
]

PROMPT = """Restyle Image 1 into a finished tile of the existing isometric pixel-art campus map.

IMAGE 1 is the geometrically correct render of this exact crop: same camera, same zoom, true building footprints, true roads, and the true shape of the dry lake. Keep EVERY position. Your output must overlay Image 1 — do not zoom, crop, rotate, or reframe.

IMAGE 2 is the blank-wall layout of the same crop (confirms footprints and heights).
IMAGE 3 is a finished tile of this same map (the Main Quad). Match its crisp pixel-art style, outlines, palette, lighting from the upper left, trees and ground.
IMAGE 4 is the real aerial photo warped onto this ground plane — use it for roof colours and planting, not for camera.
IMAGE 5 is a second pixel-map style reference; technique only.

HARD RULES
- No text, no labels, no names, no legend, no watermark, no UI, no compass.
- 2:1 isometric, 30° elevation, lighting from the upper left, same framing as Image 1.
- Lake Lagunita (the large oval) is dry: one continuous meadow of grass and pale sand, a single dirt trail around the shore, then a ring of trees. Empty interior. No building, fence, paddock, track, path across the bed, or sports field on the lake.
- Stanford buildings: buff sandstone or cream stucco, red clay tile roofs, arcades on the older halls. Modern buildings follow Image 4.
- Clean pixel-art ground: asphalt with kerbs, pale paving, lawns, marked fields, empty parking. No people, cars, or signs.
- Beige outside the map diamond stays flat beige.
- Do not invent buildings on open ground.
"""


def feather_paste(dst, src, x, y, edge=EDGE, protect=None):
    h, w = src.shape[:2]
    patch = src.astype(np.float32)
    wt = np.ones((h, w), np.float32)
    ramp = np.linspace(0, 1, edge, dtype=np.float32)
    wt[:, :edge] = np.minimum(wt[:, :edge], ramp[None, :])
    wt[:, -edge:] = np.minimum(wt[:, -edge:], ramp[::-1][None, :])
    wt[:edge, :] = np.minimum(wt[:edge, :], ramp[:, None])
    wt[-edge:, :] = np.minimum(wt[-edge:, :], ramp[::-1][:, None])
    if protect is not None:
        wt = np.where(protect, 0.0, wt)
    sl = dst[y : y + h, x : x + w].astype(np.float32)
    dst[y : y + h, x : x + w] = (sl * (1 - wt[..., None]) + patch * wt[..., None]).astype(np.uint8)


def lake_protect(outline, x, y):
    m = Image.new("L", (SIZE, SIZE), 0)
    if outline:
        pts = [(int(px - x), int(py - y)) for px, py in outline]
        ImageDraw.Draw(m).polygon(pts, fill=255)
        m = m.filter(ImageFilter.MaxFilter(31))
    return np.asarray(m) > 0


def main():
    import json
    sys.path.insert(0, str(ROOT / "experiments" / "nanobanana"))
    import campus as C
    from stanford_pixxel.geo import Camera

    meta = C.load_places()
    cam = Camera()
    c = meta["camera"]
    cam.ox, cam.oy, cam.width, cam.height = c["ox"], c["oy"], c["width"], c["height"]
    places = C.attach_area_outlines(meta["places"], cam)
    lake = next(p for p in places if p["name"] == "Lake Lagunita")
    outline = lake.get("outline") or []

    geo = np.asarray(Image.open(ROOT / "data" / "build" / "final.png").convert("RGB"))
    layout = np.asarray(Image.open(AI / "layout.png").convert("RGB"))
    aerial = Image.open(AI / "aerial.png").convert("RGB")
    style = Image.open(HERE / "style_anchor.jpg").convert("RGB")
    style2 = Image.open(HERE / "style_pixel_chennai.png").convert("RGB")
    canvas = np.asarray(Image.open(AI / "ai_final.png").convert("RGB")).copy()
    mask = np.asarray(Image.open(AI / "mask.png").convert("L"))

    only = sys.argv[1:]  # e.g. lake  or  lake row
    for plate in PLATES:
        if only and plate["name"] not in only:
            continue
        x, y = plate["xy"]
        box = (x, y, x + SIZE, y + SIZE)
        files = [AI / "in_geo.jpg", AI / "in_layout.png", AI / "in_style.jpg", AI / "in_aerial.jpg", AI / "in_style2.png"]
        Image.fromarray(geo[y : y + SIZE, x : x + SIZE]).save(files[0], quality=88)
        Image.fromarray(layout[y : y + SIZE, x : x + SIZE]).save(files[1])
        style.save(files[2], quality=88)
        aerial.crop(box).save(files[3], quality=86)
        style2.save(files[4])
        out = AI / "raw" / f"west_{plate['name']}_v2.jpg"
        out.parent.mkdir(exist_ok=True)
        print(f"plate {plate['name']} {box} spent=${nb.spent():.2f}", flush=True)
        res = nb.generate("gemini-nano-banana-2.1", PROMPT, [str(f) for f in files], str(out), size="2K", budget=BUDGET - 0.08)
        if not res or not out.exists():
            raise SystemExit(f"no image for {plate['name']}")
        print(f"   wrote {out} spent=${nb.spent():.2f}", flush=True)
        img = Image.open(out).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        img.save(AI / "tiles" / f"west_{plate['name']}_v2.png")
        arr = np.asarray(img)
        protect = lake_protect(outline, x, y) if plate["name"] != "lake" else None
        feather_paste(canvas, arr, x, y, protect=protect)

    bg = geo
    m = (mask > 0)[..., None]
    out_img = np.where(m, canvas, bg)
    Image.fromarray(out_img).save(AI / "ai_final.png", compress_level=1)
    t, step = 1024, 896
    H, W = out_img.shape[:2]
    xs = sorted(set(list(range(0, W - t, step)) + [W - t]))
    ys = sorted(set(list(range(0, H - t, step)) + [H - t]))
    plates = [(p["xy"][0], p["xy"][1], p["xy"][0] + SIZE, p["xy"][1] + SIZE) for p in PLATES if not only or p["name"] in only]
    n = 0
    for ty in ys:
        for tx in xs:
            if any(tx < x1 and tx + t > x0 and ty < y1 and ty + t > y0 for x0, y0, x1, y1 in plates):
                Image.fromarray(out_img[ty : ty + t, tx : tx + t]).save(AI / "tiles" / f"{tx}_{ty}.png")
                n += 1
    print(f"wrote ai_final.png and {n} tiles", flush=True)


if __name__ == "__main__":
    main()
