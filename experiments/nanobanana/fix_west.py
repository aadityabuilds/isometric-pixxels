"""Redraw the lake / Row / Governor's Corner as two overlapping 2K plates.

The 1024 tiles each invented a different lake and Row, so the west campus looks
like a collage. One 2K drawing of the whole lake, then one of The Row that
already sees that lake in its overlap, replaces the patchwork.

Run:  GEMINI_API_KEY=... python experiments/nanobanana/fix_west.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(HERE))
from stanford_pixxel.geo import Camera  # noqa: E402
import campus as C  # noqa: E402
import nb  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
AI = ROOT / "data" / "ai"
SIZE = 2048
EDGE = 28
BUDGET = 4.6

PLATES = [
    {
        "name": "lake",
        "xy": (4200, 0),
        "model": "gemini-3-pro-image",
        "names": [
            "Lake Lagunita",
            "Governor's Corner",
            "Lagunita Court",
            "Roble Hall",
            "Roble Field",
            "Lyman Graduate Residences",
            "Florence Moore Hall",
        ],
    },
    {
        "name": "row",
        "xy": (3300, 1280),
        "model": "gemini-nano-banana-2.1",
        "names": [
            "The Row",
            "Florence Moore Hall",
            "Lake Lagunita",
            "Munger Graduate Residences",
            "Stanford Law School",
            "Roble Hall",
            "Levin Field",
        ],
    },
]

PROMPT = """You are drawing one large finished plate of "Pixel Stanford", a giant isometric pixel-art map of Stanford University.

IMAGE ROLES
- Image 1 is the LAYOUT: a plain 3D block render of the real campus from the map's fixed camera (orthographic, 30°, 2:1 isometric). Every building, road, path, lawn, tree and the lake oval are in their true place, with blank walls. Follow this image for camera, framing, footprints, heights and roof shapes. {edge_note}
- Image 2 is the 2024 aerial photo of exactly this area, warped onto Image 1's ground plane. Use it for roof colours, courtyards, fields, parking and planting. Roofs in the photo sit at ground level and look shifted: always follow Image 1 for position.
- Image 3 is the STYLE ANCHOR (Main Quad of this same map). Match its crisp pixel-art finish, outlines, palette, lighting from the upper left, trees and ground.
- Image 4 is a secondary pixel-map style reference; use it only for drawing technique.
- Image 5 is our geometrically correct render of this same plate (true lake oval, true roads, true building footprints) in a plainer style. Copy its LAYOUT, especially the single empty lake oval, but paint in the style of Image 3, not Image 5's facades.
{photo_roles}

THIS PLATE CONTAINS
{buildings}

LAKE LAGUNITA
The large oval in this plate is Lake Lagunita, a seasonal lake that is dry: ONE continuous oval of grass and pale sand, a single dirt trail around the shore, then a ring of trees. Empty interior — no building, fence, paddock, shed, running track, figure-8, golf course, parking or path across the bed. Roble Hall, Lagunita Court, Florence Moore Hall and Governor's Corner stand OUTSIDE the trail.

STEPS
1. Keep every building, road, path, tree and the lake exactly where Image 1 / Image 5 have them.
2. Real Stanford architecture: buff sandstone or cream stucco, red clay tile roofs, arcades on the older halls; modern buildings follow the photos.
3. Clean pixel-art ground: asphalt with kerbs, pale paving, flat lawns, marked fields, empty parking stalls. No people, cars, signs or lettering.
4. Beige outside the map diamond stays flat beige.
5. Do not invent buildings on open ground.
"""


def _where(px: int, py: int) -> str:
    h = "left" if px < SIZE / 3 else "right" if px > 2 * SIZE / 3 else "centre"
    v = "top" if py < SIZE / 3 else "bottom" if py > 2 * SIZE / 3 else "middle"
    return "centre" if (h, v) == ("centre", "middle") else f"{v} {h}".replace("middle ", "")


def feather_paste(dst: np.ndarray, src: np.ndarray, x: int, y: int, edge: int = EDGE) -> None:
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


def lake_keep(places, x: int, y: int) -> np.ndarray:
    """Pixels inside Lake Lagunita (plus a trail ring) that later plates must not overwrite."""
    m = Image.new("L", (SIZE, SIZE), 0)
    lake = next((p for p in places if p["name"] == "Lake Lagunita"), None)
    outline = (lake or {}).get("outline") or []
    if outline:
        pts = [(int(px - x), int(py - y)) for px, py in outline]
        ImageDraw.Draw(m).polygon(pts, fill=255)
        m = m.filter(ImageFilter.MaxFilter(31))
    return np.asarray(m) > 0


def main() -> None:
    meta = C.load_places()
    cam = Camera()
    c = meta["camera"]
    cam.ox, cam.oy, cam.width, cam.height = c["ox"], c["oy"], c["width"], c["height"]
    places = C.attach_area_outlines(meta["places"], cam)
    layout = np.asarray(Image.open(AI / "layout.png").convert("RGB"))
    aerial = Image.open(AI / "aerial.png").convert("RGB")
    geo = np.asarray(Image.open(ROOT / "data" / "build" / "final.png").convert("RGB"))
    style = Image.open(HERE / "style_anchor.jpg").convert("RGB")
    style2 = Image.open(HERE / "style_pixel_chennai.png").convert("RGB")
    shutil.copy2(AI / "ai_final.png", AI / "ai_final.before_west.png")
    canvas = np.asarray(Image.open(AI / "ai_final.png").convert("RGB")).copy()
    mask = np.asarray(Image.open(AI / "mask.png").convert("L"))
    lake_outline = next((p for p in places if p["name"] == "Lake Lagunita"), None)
    print("lake outline pts", 0 if not lake_outline else len(lake_outline.get("outline") or []), flush=True)

    for plate in PLATES:
        x, y = plate["xy"]
        box = (x, y, x + SIZE, y + SIZE)
        lay = layout[y : y + SIZE, x : x + SIZE].copy()
        # Already-finished art in the overlap so the second plate continues the first.
        done = np.abs(canvas[y : y + SIZE, x : x + SIZE].astype(np.int16) - lay.astype(np.int16)).sum(-1) > 40
        if plate["name"] != "lake":
            lay = np.where(done[..., None], canvas[y : y + SIZE, x : x + SIZE], lay)
        files = [AI / "in_layout.png", AI / "in_aerial.jpg", AI / "in_style.jpg", AI / "in_style2.png", AI / "in_geo.jpg"]
        Image.fromarray(lay).save(files[0])
        aerial.crop(box).save(files[1], quality=88)
        style.save(files[2], quality=88)
        style2.save(files[3])
        Image.fromarray(geo[y : y + SIZE, x : x + SIZE]).save(files[4], quality=86)

        wanted = {n.lower() for n in plate["names"]}
        items = []
        seen = set()
        ranked = sorted(places, key=lambda q: (-int(q["name"].lower() in wanted or (q.get("group") or "").lower() in wanted), -q["rank"]))
        for p in ranked:
            if p["kind"] not in ("building", "complex", "area") or p["rank"] < 3:
                continue
            if not (x <= p["x"] < x + SIZE and y <= p["y"] < y + SIZE):
                outline = p.get("outline") or []
                if outline:
                    xs, ys = [pt[0] for pt in outline], [pt[1] for pt in outline]
                    if max(xs) < x or min(xs) >= x + SIZE or max(ys) < y or min(ys) >= y + SIZE:
                        continue
                else:
                    continue
            if p["name"] in seen:
                continue
            seen.add(p["name"])
            cx = min(max(p["x"], x + 1), x + SIZE - 1)
            cy = min(max(p["y"], y + 1), y + SIZE - 1)
            items.append((p["name"] + (f" ({p['group']})" if p.get("group") and p["group"] != p["name"] else ""), _where(cx - x, cy - y), p))
            if len(items) >= 16:
                break
        lon, lat = C.ground_lonlat(cam, x + SIZE / 2, y + SIZE / 2 + 80)
        photos = C.commons_photos(lon, lat, [n for n, _, _ in items], limit=3, radius=280)
        roles = []
        for k, (title, lic, img) in enumerate(photos):
            f = AI / f"in_photo{k}.jpg"
            img.save(f, quality=86)
            files.append(f)
            roles.append(
                f"- Image {6 + k} is a ground-level photo taken near this plate ({title}); use it for materials and details, never for camera or layout."
            )
        buildings = "\n".join(f"- {n}, {w}" for n, w, _ in items) or "- Campus buildings, houses, roads and trees."
        edge_note = (
            "Some areas near the edges are already finished pixel art from the neighbouring plate: continue them seamlessly and keep them unchanged."
            if plate["name"] != "lake"
            else "The top of the plate is the far corner of the map diamond; keep beige outside the diamond."
        )
        prompt = PROMPT.format(edge_note=edge_note, photo_roles="\n".join(roles), buildings=buildings)
        out = AI / "raw" / f"west_{plate['name']}.jpg"
        out.parent.mkdir(exist_ok=True)
        print(f"plate {plate['name']} {box} model={plate['model']}: {', '.join(n for n, _, _ in items[:8])}", flush=True)
        models = [plate["model"]]
        if plate["model"] != "gemini-nano-banana-2.1":
            models.append("gemini-nano-banana-2.1")
        res = None
        for model in models:
            res = nb.generate(model, prompt, [str(f) for f in files], str(out), size="2K", budget=BUDGET - 0.16)
            if res and out.exists():
                break
            print(f"   {model} failed, trying next", flush=True)
        if not res or not out.exists():
            raise SystemExit(f"no image for plate {plate['name']}")
        img = Image.open(out).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        img.save(AI / "tiles" / f"west_{plate['name']}.png")
        arr = np.asarray(img).copy()
        if plate["name"] != "lake":
            keep = lake_keep(places, x, y)
            if keep.any():
                arr[keep] = canvas[y : y + SIZE, x : x + SIZE][keep]
        feather_paste(canvas, arr, x, y)
        print(f"   spent ${nb.spent():.2f}", flush=True)

    bg = geo
    m = (mask > 0)[..., None]
    out_img = np.where(m, canvas, bg)
    Image.fromarray(out_img).save(AI / "ai_final.png", compress_level=1)

    # Keep the 1K tile cache in sync so a later compose does not restore the collage.
    t, step = 1024, 896
    H, W = out_img.shape[:2]
    xs = sorted(set(list(range(0, W - t, step)) + [W - t]))
    ys = sorted(set(list(range(0, H - t, step)) + [H - t]))
    plates = [(p["xy"][0], p["xy"][1], p["xy"][0] + SIZE, p["xy"][1] + SIZE) for p in PLATES]
    n = 0
    for ty in ys:
        for tx in xs:
            if any(tx < x1 and tx + t > x0 and ty < y1 and ty + t > y0 for x0, y0, x1, y1 in plates):
                Image.fromarray(out_img[ty : ty + t, tx : tx + t]).save(AI / "tiles" / f"{tx}_{ty}.png")
                n += 1
    print(f"wrote ai_final.png and {n} overlapping 1K tiles", flush=True)


if __name__ == "__main__":
    main()
