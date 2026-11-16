"""Redraw the campus tile by tile with Nano Banana 2.1, most important tiles first, within a hard budget.

Per tile the model gets:
  1. the massing layout (true geometry, blank walls), with finished art from neighbouring tiles already pasted
     into the overlap so it continues seamlessly;
  2. the 2024 aerial photo warped onto the same ground plane (real roofs, courtyards, landscaping);
  3. our approved Nano Banana Pro tile of the Main Quad as the style anchor, plus one Pixel Chennai crop;
  4. up to three freely licensed Wikimedia Commons photos taken near the tile;
  5. the named buildings in the tile and where they sit.

Run:  GEMINI_API_KEY=... python experiments/nanobanana/campus.py [--budget 4.0] [--compose-only]
       python experiments/nanobanana/campus.py --redo 4480,896 --redo 4480,0 --redo 5376,896 --redo 5376,0
"""

import argparse
import io
import json
import math
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(HERE))
from stanford_pixxel.geo import Camera, element_polygon, load_osm, local_to_lonlat, polygons_of  # noqa: E402
import nb  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
AI = ROOT / "data" / "ai"
TILE_DIR = AI / "tiles"
STATE = AI / "state.json"
T = 1024
STEP = 896
OVER = T - STEP
MODEL = "gemini-nano-banana-2.1"
EST_COST = 0.07
UA = {"User-Agent": "stanford-pixxel/0.1 (isometric campus map; research)"}
SKIP_WORDS = ("map", "plan", "logo", "seal", "diploma", "interior", "portrait", "drawing", "document", "page", "svg",
              "letter", "poster", "coat of arms", "panoramio (", "aerial view of the stanford")

PROMPT = """You are drawing one finished tile of "Pixel Stanford", a giant isometric pixel-art map of Stanford University's campus.

IMAGE ROLES
- Image 1 is the LAYOUT: a plain 3D block render of the real campus from the map's fixed camera (orthographic, 30 degrees above the ground, 45 degrees to the street grid, 2:1 isometric). It shows the true footprint, height, roof shape and position of every building, the roads, paths, lawns and every tree, with blank placeholder walls. {edge_note}
- Image 2 is the real aerial photograph of exactly this area, warped onto the ground plane of Image 1: use it for the true colours of roofs, roof equipment, courtyards, paving, sports fields, parking and planting. Because roofs in the photo lie at ground level, they appear shifted relative to Image 1: always follow Image 1 for positions and heights.
- Image 3 is the STYLE ANCHOR, a finished tile of this same map (the Main Quad). Match its look exactly: the same crisp pixel-art finish, outlines, palette, lighting from the upper left, tree style, ground textures and level of detail, so this tile sits seamlessly next to it.
- Image 4 is a secondary style reference from another pixel map; use it only for drawing technique.
{photo_roles}
THIS TILE CONTAINS
{buildings}
{feature_note}
STEPS
1. Keep the camera, framing and every building, road, path, lawn, open meadow and tree exactly where Image 1 has them, with the same outline, height and roof shape, so the drawing lines up with Image 1 when laid over it. Do not invent buildings, fences, paddocks or sheds on open ground.
2. Give each building its real architecture, using the photos and the aerial colours. Stanford's historic buildings are buff sandstone or cream stucco with red clay tile roofs, round arches and arcades; modern buildings follow their photos, and flat roofs keep the equipment and colours seen in the aerial photo.
3. Paint the ground cleanly in the style of Image 3: flat asphalt roads with crisp kerbs, pale paving, flat green lawns, sports fields with their markings, parking lots with painted stalls and no cars. Large open ovals in Image 1 stay open ovals.
4. Finish as true pixel art: every edge on a hard pixel grid, clean flat colour areas, crisp outlines, no blur or painterly smudges.
5. Where Image 1 shows little detail, keep the drawing just as plain. The campus is quiet and empty: no people, no vehicles, no signs and no lettering anywhere. Areas of flat beige background outside the map stay flat beige.
"""

LAKE_NOTE = """
LAKE LAGUNITA
This tile covers part of Lake Lagunita, the large seasonal lake on the west side of campus. It is dry most of the year: ONE continuous oval of grass and pale sand. A single dirt trail rings the outside of the oval, then a ring of trees. The interior is empty meadow — no running track, no figure-8, no inner ovals, no golf course, no path across the lakebed, no buildings, fences, paddocks, sheds, parking lots or sports fields. Do not cut the oval at a tile edge; the meadow continues smoothly into neighbouring tiles. Roble Hall, Lagunita Court, Florence Moore Hall and Governor's Corner sit outside the trail, never on the lake.
"""


def load_places():
    return json.loads((ROOT / "public" / "data" / "places.json").read_text())


def attach_area_outlines(places, cam):
    """Give named parks/lakes/fields a screen-space outline from OSM so tiles that only clip them still know they are there."""
    by_name = {}
    for el in load_osm():
        name = el.get("tags", {}).get("name")
        if not name:
            continue
        g = element_polygon(el)
        if g is None or g.area < 4000:
            continue
        ring = max(polygons_of(g), key=lambda p: p.area, default=None)
        if ring is None:
            continue
        pts = [[round(x, 1), round(y, 1)] for x, y in (cam.screen(px, py) for px, py in ring.exterior.coords)]
        if name not in by_name or len(pts) > len(by_name[name]):
            by_name[name] = pts
    for p in places:
        if not p.get("outline") and p["name"] in by_name:
            p["outline"] = by_name[p["name"]]
    return places


def tile_grid(W, H, mask):
    xs = list(range(0, W - T, STEP)) + [W - T]
    ys = list(range(0, H - T, STEP)) + [H - T]
    xs = sorted(set(xs))
    ys = sorted(set(ys))
    out = []
    for y in ys:
        for x in xs:
            cover = mask[y : y + T, x : x + T].mean() / 255
            if cover > 0.12:
                out.append((x, y, float(cover)))
    return out


def priority(tile, places):
    x, y, cover = tile
    score = 0.0
    for p in places:
        if p["kind"] in ("street",):
            continue
        if x + OVER / 2 <= p["x"] < x + T - OVER / 2 and y + OVER / 2 <= p["y"] < y + T - OVER / 2:
            r = p["rank"]
            score += (r * r) * (3 if p["category"] == "landmark" else 1)
    return score + cover * 5


def where(px, py):
    h = "left" if px < T / 3 else "right" if px > 2 * T / 3 else "centre"
    v = "top" if py < T / 3 else "bottom" if py > 2 * T / 3 else "middle"
    return "centre" if (h, v) == ("centre", "middle") else f"{v} {h}".replace("middle ", "")


def _outline_hits(p, x, y):
    outline = p.get("outline") or []
    if not outline:
        return False
    xs = [pt[0] for pt in outline]
    ys = [pt[1] for pt in outline]
    return not (max(xs) < x or min(xs) >= x + T or max(ys) < y or min(ys) >= y + T)


def place_spot(p, x, y):
    """Where in this tile to mention a place: its label if it sits inside, else the nearest point on the tile."""
    if x <= p["x"] < x + T and y <= p["y"] < y + T:
        return where(p["x"] - x, p["y"] - y)
    if _outline_hits(p, x, y):
        cx = min(max(p["x"], x + 1), x + T - 1)
        cy = min(max(p["y"], y + 1), y + T - 1)
        return where(cx - x, cy - y)
    return None


def tile_buildings(tile, places):
    x, y, _ = tile
    items = []
    for p in sorted(places, key=lambda p: -p["rank"]):
        if p["kind"] not in ("building", "complex", "area") or p["rank"] < 3:
            continue
        spot = place_spot(p, x, y)
        if not spot:
            continue
        label = p["name"] + (f" ({p['group']})" if p.get("group") and p["group"] != p["name"] else "")
        items.append((label, spot, p))
        if len(items) >= 14:
            break
    return items


def feature_note_for(items):
    names = " ".join(n.lower() for n, _, _ in items)
    if "lake lagunita" in names:
        return LAKE_NOTE
    return ""


def ground_lonlat(cam, sx, sy):
    a, b, c, d, tx, ty = cam.affine_ground()
    e, n = np.linalg.inv(np.array([[a, b], [c, d]])) @ np.array([sx - tx, sy - ty])
    return local_to_lonlat(float(e), float(n))


def commons_photos(lon, lat, names, limit=3, radius=220):
    try:
        r = requests.get("https://commons.wikimedia.org/w/api.php", headers=UA, timeout=30, params={
            "action": "query", "generator": "geosearch", "ggscoord": f"{lat}|{lon}", "ggsradius": radius,
            "ggslimit": 40, "ggsnamespace": 6, "prop": "imageinfo", "iiprop": "url|extmetadata|size",
            "iiurlwidth": 768, "format": "json"})
        pages = list(r.json().get("query", {}).get("pages", {}).values())
    except Exception:  # noqa: BLE001
        return []
    keys = [w.lower() for n in names for w in re.findall(r"[A-Za-z]{4,}", n) if w.lower() not in ("hall", "house", "building", "center", "stanford", "court")]
    cands = []
    for p in pages:
        t = p["title"].lower()
        if not t.endswith((".jpg", ".jpeg")) or any(w in t for w in SKIP_WORDS):
            continue
        ii = p.get("imageinfo", [{}])[0]
        if ii.get("width", 0) < 600:
            continue
        lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "")
        score = sum(2 for k in keys if k in t) + (1 if "stanford" in t else 0)
        cands.append((score, p.get("index", 99), p["title"], ii.get("thumburl"), lic))
    cands.sort(key=lambda c: (-c[0], c[1]))
    out = []
    for score, _, title, url, lic in cands[:limit]:
        try:
            img = Image.open(io.BytesIO(requests.get(url, headers=UA, timeout=30).content)).convert("RGB")
            out.append((title[5:], lic, img))
        except Exception:  # noqa: BLE001
            continue
    return out


SEAM = 4  # only a few pixels of blend at a tile front; wide ramps stack two drawings of the same building


def compose_voronoi(loaded, W, H, fallback):
    """Place tiles north-to-south, west-to-east. The first tile that covers a pixel owns it.

    Overlapping Nano Banana tiles each redraw the shared 128 px strip, so a linear fade
    through that strip looks like two translucent buildings. Later tiles only fill holes.
    """
    from scipy.ndimage import distance_transform_edt

    canvas = fallback.astype(np.float32)
    done = np.zeros((H, W), np.uint8)
    for x, y, img in sorted(loaded, key=lambda t: (t[1], t[0])):
        h, w = img.shape[:2]
        sl = (slice(y, y + h), slice(x, x + w))
        empty = done[sl] == 0
        if not empty.any():
            continue
        if done[sl].any() and SEAM > 0:
            dist_into_done = distance_transform_edt(done[sl] > 0)
            wgt = np.where(empty, 1.0, np.clip(1.0 - dist_into_done / SEAM, 0, 1)).astype(np.float32)
        else:
            wgt = empty.astype(np.float32)
        canvas[sl] = wgt[..., None] * img.astype(np.float32) + (1.0 - wgt[..., None]) * canvas[sl]
        done[sl] = 1
    return np.clip(canvas, 0, 255).astype(np.uint8), done


def load_done_images(records):
    out = []
    for rec in records:
        img = np.asarray(Image.open(TILE_DIR / rec["file"]).convert("RGB"))
        out.append((rec["x"], rec["y"], img))
    return out


def parse_xy(s):
    a, b = s.split(",")
    return int(a), int(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=4.0)
    ap.add_argument("--compose-only", action="store_true")
    ap.add_argument("--redo", action="append", default=[], help="tile x,y to drop and regenerate, in this order")
    args = ap.parse_args()
    TILE_DIR.mkdir(parents=True, exist_ok=True)

    meta = load_places()
    c = meta["camera"]
    cam = Camera()
    cam.ox, cam.oy, cam.width, cam.height = c["ox"], c["oy"], c["width"], c["height"]
    W, H = cam.width, cam.height
    places = attach_area_outlines(meta["places"], cam)

    mask = np.asarray(Image.open(AI / "mask.png").convert("L"))
    layout = np.asarray(Image.open(AI / "layout.png").convert("RGB"))
    aerial = Image.open(AI / "aerial.png").convert("RGB")
    style = Image.open(HERE / "style_anchor.jpg").convert("RGB")
    style2 = Image.open(HERE / "style_pixel_chennai.png").convert("RGB")

    tiles = tile_grid(W, H, mask)
    tiles.sort(key=lambda t: -priority(t, places))
    state = json.loads(STATE.read_text()) if STATE.exists() else {"done": []}
    redo = [parse_xy(s) for s in args.redo]
    if redo:
        backup = AI / "tiles_backup"
        backup.mkdir(exist_ok=True)
        keep = []
        for rec in state["done"]:
            if (rec["x"], rec["y"]) in redo:
                src = TILE_DIR / rec["file"]
                if src.exists():
                    shutil.copy2(src, backup / rec["file"])
            else:
                keep.append(rec)
        state["done"] = keep
        print(f"redoing {len(redo)} tiles; {len(state['done'])} kept; spent ${nb.spent():.2f}", flush=True)
    else:
        print(f"{len(tiles)} tiles to cover the map; {len(state['done'])} already done; spent ${nb.spent():.2f}", flush=True)

    fallback = np.asarray(Image.open(ROOT / "data" / "build" / "final.png").convert("RGB"))
    loaded = load_done_images(state["done"])
    canvas, done = compose_voronoi(loaded, W, H, fallback)

    if not args.compose_only:
        finished = {(r["x"], r["y"]) for r in state["done"]}
        queue = []
        if redo:
            by = {(t[0], t[1]): t for t in tiles}
            for xy in redo:
                queue.append(by.get(xy, (xy[0], xy[1], 1.0)))
        else:
            queue = [t for t in tiles if (t[0], t[1]) not in finished]
        for i, tile in enumerate(queue):
            x, y, _ = tile
            if (x, y) in finished:
                continue
            if nb.spent() + EST_COST > args.budget:
                print(f"budget reached: spent ${nb.spent():.2f}", flush=True)
                break
            lay = layout[y : y + T, x : x + T].copy()
            d = done[y : y + T, x : x + T].astype(bool)
            has_edges = d.any()
            lay[d] = canvas[y : y + T, x : x + T][d]
            items = tile_buildings(tile, places)
            lon, lat = ground_lonlat(cam, x + T / 2, y + T / 2 + 60)
            photos = commons_photos(lon, lat, [n for n, _, _ in items])
            files = [AI / "in_layout.png", AI / "in_aerial.jpg", AI / "in_style.jpg", AI / "in_style2.png"]
            Image.fromarray(lay).save(files[0])
            aerial.crop((x, y, x + T, y + T)).save(files[1], quality=88)
            style.save(files[2], quality=88)
            style2.save(files[3])
            roles = []
            for k, (title, lic, img) in enumerate(photos):
                f = AI / f"in_photo{k}.jpg"
                img.save(f, quality=86)
                files.append(f)
                roles.append(f"- Image {5 + k} is a ground-level photograph taken near this tile ({title}); use it for the real materials, colours and details of the buildings it shows, never for camera angle or layout.")
            buildings = "\n".join(f"- {n}, {w}" for n, w, _ in items) or "- Ordinary campus buildings, houses, roads and trees."
            edge_note = ("Some areas near its edges are already finished pixel art from neighbouring tiles: continue them seamlessly and keep them unchanged."
                         if has_edges else "")
            prompt = PROMPT.format(edge_note=edge_note, photo_roles="\n".join(roles), buildings=buildings, feature_note=feature_note_for(items))
            out = AI / "raw" / f"{x}_{y}.jpg"
            out.parent.mkdir(exist_ok=True)
            print(f"[{i + 1}/{len(queue)}] tile {x},{y}: {', '.join(n for n, _, _ in items[:6]) or 'no named buildings'}; {len(photos)} photos", flush=True)
            res = None
            for attempt in range(2):
                try:
                    res = nb.generate(MODEL, prompt, [str(f) for f in files], str(out), size="2K", budget=args.budget - EST_COST)
                    break
                except requests.RequestException as e:
                    print("request failed:", e, flush=True)
                    time.sleep(5)
            if not res or not out.exists():
                print("no image for this tile; skipping", flush=True)
                continue
            img = Image.open(out).convert("RGB").resize((T, T), Image.LANCZOS)
            fname = f"{x}_{y}.png"
            img.save(TILE_DIR / fname)
            loaded.append((x, y, np.asarray(img)))
            canvas, done = compose_voronoi(loaded, W, H, fallback)
            state["done"].append({"x": x, "y": y, "file": fname, "photos": [t for t, _, _ in photos], "buildings": [n for n, _, _ in items]})
            STATE.write_text(json.dumps(state, indent=1))
            (HERE / "campus_state.json").write_text(json.dumps(state, indent=1))
            print(f"   spent so far ${nb.spent():.2f}", flush=True)

    # Outside the map, keep the plain background.
    bg = np.asarray(Image.open(ROOT / "data" / "build" / "final.png").convert("RGB"))
    m = (mask > 0)[..., None]
    out = np.where(m, canvas, bg)
    Image.fromarray(out).save(AI / "ai_final.png", compress_level=1)
    STATE.write_text(json.dumps(state, indent=1))
    (HERE / "campus_state.json").write_text(json.dumps(state, indent=1))
    cov = done[mask > 0].mean()
    print(f"composed ai_final.png: {len(state['done'])} tiles, {cov * 100:.0f}% of the map redrawn, total spent ${nb.spent():.2f}", flush=True)


if __name__ == "__main__":
    main()
