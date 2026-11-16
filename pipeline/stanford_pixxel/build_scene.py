"""Fuse OSM, Stanford names, lidar and NAIP into a renderable isometric scene.

Outputs
  data/build/scene.json   buildings + trees in local metres, plus the camera (read by the WebGL renderer)
  data/build/ground.png   the flat ground layer already projected into isometric screen space
  public/data/places.json labels and hover outlines in final-image pixels (read by the viewer)
"""

from __future__ import annotations

import colorsys
import json
import math
import re
import zlib
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep

from . import names as N
from .config import BUILD, CENTER_UTM, PUBLIC, RAW, region_polygon_local
from .geo import Camera, element_polygon, load_osm, local_to_lonlat, lonlat_to_local, polygons_of, way_line

Image.MAX_IMAGE_PIXELS = None
rng = np.random.default_rng(7)

SUN_SCREEN = (-0.8, 0.35)  # (right, depth) direction toward the sun: light from the upper left
SUN_ELEVATION = 42.0


# --------------------------------------------------------------------------- lidar grid


class Grid:
    def __init__(self):
        d = np.load(RAW / "lidar.npz")
        self.res = float(d["res"])
        x0, y1 = d["origin"]
        self.x0 = x0 - CENTER_UTM[0]
        self.y1 = y1 - CENTER_UTM[1]
        self.dsm = d["dsm"]
        self.dtm = d["dtm"]
        self.veg = d["veg"]
        self.H, self.W = self.dsm.shape
        self.transform = from_origin(self.x0, self.y1, self.res, self.res)
        chm = self.dsm - self.dtm
        holes = ~np.isfinite(chm)
        filled = np.where(holes, -1e9, chm)
        filled = np.where(holes, ndimage.maximum_filter(filled, size=3), filled)
        filled[filled < -1e8] = 0
        self.chm = np.clip(filled, 0, 150).astype(np.float32)
        self.chm_valid = ~holes
        vh = self.veg - self.dtm
        self.vh = np.where(np.isfinite(vh), np.clip(vh, 0, 90), 0).astype(np.float32)
        self.naip = np.load(RAW / "naip.npz")["rgbn"]

    def cell_center(self, rows, cols):
        return self.x0 + (cols + 0.5) * self.res, self.y1 - (rows + 0.5) * self.res

    def rc(self, e, n):
        return int((self.y1 - n) / self.res), int((e - self.x0) / self.res)


# --------------------------------------------------------------------------- buildings


def collect_buildings(elements, region):
    pr = prep(region)
    blds, parts = [], []
    for el in elements:
        tags = el.get("tags", {})
        is_part = "building:part" in tags and tags.get("building:part") != "no"
        is_bld = "building" in tags and tags.get("building") not in ("no", "construction")
        if not (is_part or is_bld) or el["type"] == "node":
            continue
        geom = element_polygon(el)
        for p in polygons_of(geom):
            if p.area < 8 or not pr.contains(p.representative_point()):
                continue
            item = {"poly": p.simplify(0.2, preserve_topology=True), "tags": tags, "osm": f'{el["type"]}/{el["id"]}'}
            (parts if is_part and not is_bld else blds).append(item)
    if parts:
        part_tree = cKDTree([[p["poly"].centroid.x, p["poly"].centroid.y] for p in parts])
        keep = []
        for b in blds:
            c = b["poly"].centroid
            idx = part_tree.query_ball_point([c.x, c.y], r=math.sqrt(b["poly"].area) * 1.5)
            inside = [parts[i] for i in idx if b["poly"].contains(parts[i]["poly"].representative_point())]
            covered = sum(p["poly"].area for p in inside)
            if inside and covered > 0.6 * b["poly"].area:
                for p in inside:
                    p.setdefault("parent", b)
                continue
            keep.append(b)
        blds = keep + [p for p in parts if "parent" in p]
    for b in blds:
        parent = b.get("parent", b)
        b["group"] = parent["osm"]
        b["group_poly"] = parent["poly"]
        b["name_tags"] = parent["tags"]
    return blds


ROOF_SHAPES = {"pyramidal": "hipped", "hipped": "hipped", "gabled": "hipped", "half-hipped": "hipped",
               "mansard": "hipped", "gambrel": "hipped", "dome": "dome", "onion": "dome", "round": "dome",
               "flat": "flat", "skillion": "flat"}


def num(v):
    try:
        return float(re.findall(r"-?[\d.]+", str(v))[0])
    except (IndexError, ValueError):
        return None


def apply_osm_3d(b):
    """Hand-modelled OSM parts carry explicit heights and roof shapes; prefer them over lidar."""
    t = b["tags"]
    h = num(t.get("height")) if "height" in t else None
    if h is None or h <= 0:
        return
    roof_h = num(t.get("roof:height")) or 0.0
    shape = ROOF_SHAPES.get(t.get("roof:shape", ""), None)
    minh = num(t.get("min_height")) or ((num(t.get("building:min_level")) or 0) * 3.5)
    b["h"] = h
    b["parts"] = []
    if minh:
        b["minH"] = minh
    if shape in ("hipped", "dome") and roof_h > 0.3:
        from shapely.ops import polylabel
        inner = max(polylabel(b["poly"], 0.25).distance(b["poly"].exterior), 0.5)
        b["roof"] = shape
        b["eave"] = h - roof_h
        b["rise"] = roof_h
        b["pitch"] = float(np.clip(roof_h / inner, 0.2, 4.0))
    elif shape == "flat" or shape is None:
        b["roof"] = "flat" if shape == "flat" else b.get("roof", "flat")
        if b["roof"] == "hipped":
            b["eave"] = min(b.get("eave", h), h - 0.5)
            b["rise"] = h - b["eave"]


def tag_height(tags):
    try:
        if "height" in tags:
            return float(re.findall(r"[\d.]+", tags["height"])[0])
        if "building:levels" in tags:
            return float(re.findall(r"[\d.]+", tags["building:levels"])[0]) * 3.5 + 0.5
    except (IndexError, ValueError):
        pass
    return None


def roof_stats(z, d, sl):
    """Classify a roof from lidar cells (heights z, distance-to-eave d, surface slope sl)."""
    interior = d >= 1.0
    if interior.sum() < 8:
        interior = np.ones_like(d, bool)
    zi, si = z[interior], sl[interior]
    pitched_frac = ((si > 0.22) & (si < 1.1)).mean()
    flat_frac = (si < 0.12).mean()
    out = {"h": float(np.percentile(zi, 85)), "roof": "flat"}
    if pitched_frac > 0.45 and flat_frac < 0.25 and len(zi) >= 30:
        pitch = float(np.clip(np.median(si[(si > 0.22) & (si < 1.1)]), 0.32, 0.75))
        ridge = float(np.percentile(zi, 97))
        rim = (d >= 0.75) & (d <= 2.25)
        eave = float(np.median(z[rim]) - pitch * 1.5) if rim.sum() > 6 else float(np.percentile(zi, 15))
        eave = max(eave, 2.5)
        rise = float(np.clip(ridge - eave, 1.0, pitch * d.max()))
        if ridge > eave + 0.8:
            out = {"h": eave + rise, "roof": "hipped", "eave": eave, "pitch": pitch, "rise": rise}
    return out


def polygonize_mask(mask, transform, footprint, min_area):
    from rasterio.features import shapes
    from shapely.geometry import shape

    out = []
    for geom, val in shapes(mask.astype(np.uint8), mask=mask, transform=transform):
        p = shape(geom).buffer(0.6, join_style=2).buffer(-0.6, join_style=2)
        p = p.simplify(0.5, preserve_topology=True).intersection(footprint)
        for q in polygons_of(p):
            if q.area >= min_area:
                out.append(q)
    return out


def lidar_heights(blds, grid: Grid):
    shapes_ = [(b["poly"], i + 1) for i, b in enumerate(blds)]
    label = rasterize(shapes_, out_shape=(grid.H, grid.W), transform=grid.transform, fill=0, dtype="int32")
    boundary = np.zeros_like(label, bool)
    for axis in (0, 1):
        for shift in (1, -1):
            boundary |= label != np.roll(label, shift, axis=axis)
    dist = ndimage.distance_transform_edt(~boundary) * grid.res
    smooth = ndimage.gaussian_filter(grid.chm, 1.5)
    gy, gx = np.gradient(smooth, grid.res)
    slope = np.hypot(gx, gy).astype(np.float32)
    del gy, gx, smooth

    red = grid.naip[0].astype(np.float32)
    nir = grid.naip[3].astype(np.float32)
    leafy = ((nir - red) / (nir + red + 1e-3)) > 0.22

    usable = (label > 0) & grid.chm_valid
    idx = np.flatnonzero(usable)
    lab = label.ravel()[idx]
    order = np.argsort(lab, kind="stable")
    idx, lab = idx[order], lab[order]
    starts = np.searchsorted(lab, np.arange(1, len(blds) + 2))
    chm = grid.chm.ravel()
    dd = dist.ravel()
    sl = slope.ravel()
    lf = leafy.ravel()
    rgb = grid.naip[:3].reshape(3, -1)

    for i, b in enumerate(blds):
        cells = idx[starts[i] : starts[i + 1]]
        tags = b["tags"]
        fallback = tag_height(tags) or (4.5 if tags.get("building") in ("house", "detached", "garage", "shed") else 7.0)
        b["roof"] = "flat"
        b["parts"] = []
        if len(cells) > 12 and (~lf[cells]).sum() > 8:
            cells = cells[~lf[cells]]
        if len(cells) < 6:
            b["h"] = fallback
            b["roof_rgb"] = None
            continue
        z = chm[cells]
        if np.percentile(z, 85) < 1.5:
            b["h"] = fallback
            b["roof_rgb"] = np.median(rgb[:, cells], axis=1).tolist()
            continue

        # Towers and multi-storey wings: split off sections far above the main roof.
        p50, p98 = np.percentile(z, [50, 98])
        tall = np.zeros(len(cells), bool)
        if p98 - p50 > 6 and b["poly"].area > 120:
            thresh = (p50 + p98) / 2
            tall = z > thresh
            if 0.02 < tall.mean() < 0.7:
                rows, cols = np.unravel_index(cells, (grid.H, grid.W))
                r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
                win = np.zeros((r1 - r0, c1 - c0), bool)
                win[rows[tall] - r0, cols[tall] - c0] = True
                win = ndimage.binary_closing(ndimage.binary_opening(win, iterations=1), iterations=1)
                tr = from_origin(grid.x0 + c0 * grid.res, grid.y1 - r0 * grid.res, grid.res, grid.res)
                for q in polygonize_mask(win, tr, b["poly"], min_area=20):
                    qmask = rasterize([(q, 1)], out_shape=win.shape, transform=tr, fill=0, dtype="uint8").astype(bool)
                    valid = qmask & grid.chm_valid[r0:r1, c0:c1]
                    zq = grid.chm[r0:r1, c0:c1][valid]
                    if len(zq) >= 6:
                        dq = (ndimage.distance_transform_edt(qmask) * grid.res)[valid]
                        st = roof_stats(zq, dq, slope[r0:r1, c0:c1][valid])
                        st["h"] = float(np.clip(st["h"], 3, 120))
                        b["parts"].append({"poly": q, **st})
                tall = np.zeros(len(cells), bool) if not b["parts"] else tall

        base = ~tall if (~tall).sum() >= 6 else np.ones(len(cells), bool)
        st = roof_stats(z[base], dd[cells][base], sl[cells][base])
        b.update(st)
        b["h"] = float(np.clip(b["h"], 2.5, 120))
        for p in b["parts"]:
            p["minH"] = b.get("eave", b["h"])
            if p["roof"] == "hipped":
                p["eave"] = max(p["eave"], p["minH"] + 1.5)
                p["h"] = p["eave"] + p["rise"]
            if p["h"] < p["minH"] + 2:
                p["h"] = p["minH"] + 2

        inner = cells[dd[cells] >= 1.0] if (dd[cells] >= 1.0).sum() > 4 else cells
        b["roof_rgb"] = np.median(rgb[:, inner], axis=1).tolist()
    for b in blds:
        apply_osm_3d(b)
    return label


ROOF_PALETTE = {
    "terracotta": (186, 96, 62),
    "clay": (204, 128, 86),
    "slate": (112, 118, 128),
    "graphite": (84, 88, 96),
    "concrete": (178, 176, 170),
    "white": (226, 224, 216),
    "tan": (196, 178, 146),
    "green": (118, 142, 92),
    "copper": (98, 140, 126),
}

WALLS_SANDSTONE = [(222, 196, 150), (214, 186, 138), (228, 206, 166)]
WALLS_STUCCO = [(236, 222, 196), (230, 214, 186), (240, 230, 210)]
WALLS_MODERN = [(214, 210, 200), (200, 198, 192), (190, 196, 200), (222, 216, 204), (176, 182, 188)]
WALLS_HOUSE = [(238, 232, 220), (226, 222, 206), (214, 224, 222), (232, 220, 200), (210, 200, 186)]


def stylize_roof(rgb, roof_type):
    if rgb is None:
        return ROOF_PALETTE["terracotta"] if roof_type == "hipped" else ROOF_PALETTE["concrete"]
    r, g, b = [c / 255 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    best = min(ROOF_PALETTE.values(), key=lambda p: sum((p[i] - rgb[i]) ** 2 for i in range(3)))
    if roof_type == "hipped" and (h < 0.08 or h > 0.95) and s > 0.12:
        best = ROOF_PALETTE["terracotta"] if l < 0.55 else ROOF_PALETTE["clay"]
    mixed = [0.55 * best[i] + 0.45 * rgb[i] for i in range(3)]
    h, l, s = colorsys.rgb_to_hls(*[c / 255 for c in mixed])
    s = min(1, s * 1.25)
    l = min(0.9, l * 1.08 + 0.03)
    return tuple(int(round(c * 255)) for c in colorsys.hls_to_rgb(h, l, s))


def wall_color(b, roof_rgb, seed):
    hue = colorsys.rgb_to_hls(*[c / 255 for c in roof_rgb])[0]
    terracotta = b["roof"] == "hipped" and (hue < 0.09 or hue > 0.95)
    if b.get("main_quad"):
        pal = WALLS_SANDSTONE
    elif terracotta:
        pal = WALLS_STUCCO if b.get("category") == "residence" else WALLS_SANDSTONE + WALLS_STUCCO
    elif b.get("category") == "residence" and b["poly"].area < 260:
        pal = WALLS_HOUSE
    else:
        pal = WALLS_MODERN
    return pal[seed % len(pal)]


# --------------------------------------------------------------------------- names


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def attach_names(blds, stanford_rows):
    groups = {}
    for b in blds:
        groups.setdefault(b["group"], {"poly": b["group_poly"], "members": []})["members"].append(b)
    gl = list(groups.values())
    centroids = np.array([[g["poly"].centroid.x, g["poly"].centroid.y] for g in gl])
    tree = cKDTree(centroids)
    official = []
    for row in stanford_rows:
        raw = (row.get("NAME") or "").strip()
        ext = row.get("extent")
        if not ext or not raw or any(isinstance(v, str) for v in ext):
            continue
        x0, y0 = lonlat_to_local(ext[0], ext[1])
        x1, y1 = lonlat_to_local(ext[2], ext[3])
        bx = box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        if bx.area < 1:
            bx = bx.buffer(2)
        c = bx.centroid
        best, score = None, 0.0
        for i in tree.query_ball_point([c.x, c.y], r=max(60, math.sqrt(bx.area) * 2)):
            p = gl[i]["poly"]
            inter = p.intersection(bx).area
            if inter <= 0:
                continue
            s = inter / (p.area + bx.area - inter)
            if s > score:
                best, score = i, s
        official.append({"raw": raw, "id": row.get("BLDG_ID"), "box": bx, "match": best if score > 0.2 else None, "score": score})

    by_bld = defaultdict(list)
    for o in official:
        if o["match"] is not None:
            by_bld[o["match"]].append(o)
    for i, os_ in by_bld.items():
        os_.sort(key=lambda o: -o["score"])
        for b in gl[i]["members"]:
            b["official"] = os_[0]
    return official


def display_name(b):
    osm_name = b["name_tags"].get("name")
    off = b.get("official")
    if off:
        group, short = N.split_complex(off["raw"])
        full = N.pretty(off["raw"])
        if osm_name and (norm(osm_name) in norm(full) or norm(short) in norm(osm_name) or norm(full) in norm(osm_name)):
            if not group:
                short = osm_name
            elif norm(short) in norm(osm_name):
                short = osm_name.replace(" House", "") if group else osm_name
        return group, short, off["raw"]
    if osm_name:
        return None, osm_name, osm_name.upper()
    return None, None, ""


# --------------------------------------------------------------------------- trees


def detect_trees(grid: Grid, label, osm_trees, palm_lines):
    vh = ndimage.gaussian_filter(grid.vh, 1.0)
    bmask = ndimage.binary_dilation(label > 0, iterations=2)
    vh[bmask] = 0
    peaks = (vh == ndimage.maximum_filter(vh, size=7)) & (vh > 3.5)
    rows, cols = np.nonzero(peaks)
    hs = vh[rows, cols]
    order = np.argsort(-hs)
    rows, cols, hs = rows[order], cols[order], hs[order]
    xs, ys = grid.cell_center(rows, cols)

    # Suppress peaks that sit inside the crown of a taller neighbour.
    radius = np.clip(0.9 + 0.17 * hs, 1.4, 7.5)
    kd = cKDTree(np.c_[xs, ys])
    keep = np.ones(len(xs), bool)
    for i in range(len(xs)):
        if not keep[i]:
            continue
        for j in kd.query_ball_point([xs[i], ys[i]], r=radius[i] * 0.85):
            if j > i:
                keep[j] = False
    xs, ys, hs, radius, rows, cols = xs[keep], ys[keep], hs[keep], radius[keep], rows[keep], cols[keep]

    # Measure each crown: assign canopy cells to the nearest kept peak.
    canopy = vh > 2.5
    cr, cc = np.nonzero(canopy)
    cx, cy = grid.cell_center(cr, cc)
    kd = cKDTree(np.c_[xs, ys])
    dist, owner = kd.query(np.c_[cx, cy], distance_upper_bound=8.0)
    ok = np.isfinite(dist)
    area = np.bincount(owner[ok], minlength=len(xs)) * grid.res**2
    measured = np.sqrt(area / math.pi)
    radius = np.clip(0.5 * radius + 0.5 * measured, 1.2, 8.5)

    rgb = grid.naip[:3].astype(np.float32)
    nir = grid.naip[3].astype(np.float32)
    sm = [ndimage.uniform_filter(rgb[i], 3) for i in range(3)]
    smn = ndimage.uniform_filter(nir, 3)

    osm_kd = cKDTree([t[:2] for t in osm_trees]) if osm_trees else None
    palm_zone = prep(unary_union(palm_lines).buffer(9)) if palm_lines else None
    trees = []
    for x, y, h, r, rr, c in zip(xs, ys, hs, radius, rows, cols):
        col = [float(sm[i][rr, c]) for i in range(3)]
        kind = 0
        if h / max(r, 0.5) > 3.4 and sum(col) < 210:
            kind = 1
        if osm_kd is not None:
            dd, j = osm_kd.query([x, y])
            if dd < 3.5:
                k = osm_trees[j][2]
                if k is not None:
                    kind = k
        if palm_zone is not None and palm_zone.contains(Point(x, y)) and h > 7:
            kind = 2
        if kind == 2:
            r = min(r, 3.2)
        trees.append([round(float(x), 2), round(float(y), 2), round(float(h), 1), round(float(r), 1), kind, tree_color(col, float(smn[rr, c]), kind, float(h), int(rr) * 7919 + int(c))])
    return trees


def tree_color(rgb, nir, kind, h=10.0, seed=0):
    r, g, b = [max(0, min(255, v)) / 255 for v in rgb]
    _, l, _ = colorsys.rgb_to_hls(r, g, b)
    vigor = float(np.clip((nir / 255 - r) / (nir / 255 + r + 1e-3), 0, 1))
    jitter = ((seed * 2654435761) % 1000) / 1000 - 0.5
    hue = 0.25 + 0.05 * vigor + 0.035 * jitter
    light = 0.27 + 0.2 * l + 0.04 * jitter
    sat = 0.30 + 0.22 * vigor
    if kind == 1:
        hue, light, sat = hue + 0.04, light * 0.8, sat * 0.85
    elif kind == 2:
        hue, light, sat = 0.23, light * 1.05, sat * 1.1
    elif h > 24 and vigor < 0.45:
        hue, sat = 0.21, sat * 0.6
    out = colorsys.hls_to_rgb(hue % 1, float(np.clip(light, 0.18, 0.55)), float(np.clip(sat, 0.15, 0.6)))
    return "#%02x%02x%02x" % tuple(int(c * 255) for c in out)


def osm_tree_points(elements):
    out = []
    for el in elements:
        t = el.get("tags", {})
        if el["type"] == "node" and t.get("natural") == "tree":
            x, y = lonlat_to_local(el["lon"], el["lat"])
            txt = " ".join(t.get(k, "") for k in ("genus", "species", "taxon", "species:en", "name")).lower()
            kind = None
            if any(w in txt for w in ("palm", "phoenix", "washingtonia", "syagrus", "trachycarpus")):
                kind = 2
            elif t.get("leaf_type") == "needleleaved" or any(w in txt for w in ("pinus", "pine", "sequoia", "redwood", "cedrus", "cedar", "cupressus", "cypress")):
                kind = 1
            elif t.get("leaf_type") == "broadleaved":
                kind = 0
            out.append((x, y, kind))
    return out


# --------------------------------------------------------------------------- ground painting


ROAD_STYLE = {
    "motorway": (13, "#5d6066"), "trunk": (12, "#5d6066"), "primary": (12, "#62656b"),
    "secondary": (10, "#686b70"), "tertiary": (8, "#6e7075"), "unclassified": (6.5, "#73757a"),
    "residential": (6.5, "#73757a"), "service": (4.2, "#7c7e82"), "living_street": (5, "#7c7e82"),
    "busway": (6, "#6e7075"),
}
PATH_STYLE = {
    "footway": (2.4, "#e6dcc6"), "path": (2.2, "#dccfae"), "cycleway": (2.8, "#d9cdb4"),
    "pedestrian": (4.5, "#e9e0cc"), "steps": (2.4, "#d6ccb6"), "bridleway": (2.0, "#cbb98f"),
    "track": (2.6, "#c4b083"),
}


def to_screen_xy(cam: Camera, coords):
    return [cam.screen(x, y) for x, y in coords]


def draw_poly(draw, cam, poly, fill, outline=None, width=1):
    for p in polygons_of(poly):
        draw.polygon(to_screen_xy(cam, p.exterior.coords), fill=fill, outline=outline, width=width)
        for hole in p.interiors:
            draw.polygon(to_screen_xy(cam, hole.coords), fill=None)


LAND_CLASSES = ["paved", "asphalt", "lawn", "meadow", "dirt", "shrub"]
LAND_COLORS = {
    "paved": (222, 213, 194),
    "asphalt": (124, 126, 130),
    "lawn": (112, 160, 76),
    "meadow": (204, 182, 116),
    "dirt": (180, 150, 108),
    "shrub": (86, 128, 66),
}


def landcover_image(grid: Grid, label):
    s = 2  # classify on a 1 m grid
    rgbn = grid.naip[:, ::s, ::s].astype(np.float32)
    r, g, b, n = rgbn
    vh = grid.vh[::s, ::s]
    ndvi = (n - r) / (n + r + 1e-3)
    bright = (r + g + b) / 3
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / (mx + 1e-3)
    warm = (r > b * 1.12) & (g > b * 1.02)

    cls = np.zeros(r.shape, np.uint8)
    cls[(bright < 112) & (sat < 0.16)] = 1
    cls[(ndvi > 0.06) & (ndvi <= 0.22) & warm & (bright > 95)] = 3
    cls[(ndvi <= 0.08) & warm & (sat > 0.2) & (bright < 175) & (bright > 80)] = 4
    cls[ndvi > 0.22] = 2
    cls[(ndvi > 0.25) & (vh > 0.7) & (vh <= 2.5)] = 5

    occluded = ((vh > 2.5) & (ndvi > 0.12)) | ndimage.binary_dilation(label[::s, ::s] > 0, iterations=2)
    _, (ri, ci) = ndimage.distance_transform_edt(occluded, return_indices=True)
    cls = cls[ri, ci]

    # Majority filter for clean, map-like shapes.
    votes = np.stack([ndimage.uniform_filter((cls == k).astype(np.float32), size=5) for k in range(len(LAND_CLASSES))])
    cls = np.argmax(votes, axis=0).astype(np.uint8)
    del votes

    palette = np.array([LAND_COLORS[k] for k in LAND_CLASSES], np.float32)
    img = palette[cls]
    # Keep a little of the real texture (mowing stripes, dry patches) and add soft colour drift.
    lum = (r + g + b)[ri, ci] / 3
    lum = ndimage.gaussian_filter(lum, 0.7)
    detail = np.clip((lum - ndimage.uniform_filter(lum, 15)) / 255 * 0.9, -0.12, 0.12)
    drift = ndimage.gaussian_filter(rng.standard_normal(r.shape).astype(np.float32), 18) * 9
    img = img * (1 + detail[..., None]) + drift[..., None]
    img = np.clip(img, 0, 255).astype(np.uint8)
    return Image.fromarray(img).resize((grid.W, grid.H), Image.NEAREST)


def paint_ground(cam: Camera, grid: Grid, elements, region, label):
    W, H = cam.width, cam.height
    rp = prep(region)

    # 1. Base landcover classified from NAIP; canopy and footprints take the class of the nearest open ground.
    stylized = landcover_image(grid, label)

    # 2. Cast shadows from the lidar surface, on a 1 m grid.
    shadow = cast_shadows(grid, cam)
    sh = Image.fromarray((shadow * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))

    ground_src = stylized
    a, b, c, d, tx, ty = cam.affine_ground()
    # Map screen pixel -> grid pixel: invert [sx, sy] = M [e, n] + t, then e,n -> col,row.
    M = np.array([[a, b], [c, d]])
    Mi = np.linalg.inv(M)
    res = grid.res

    def inverse(src_res):
        # col = (e - x0)/res, row = (y1 - n)/res
        A = np.array([[1 / src_res, 0], [0, -1 / src_res]]) @ Mi
        off = np.array([-grid.x0 / src_res, grid.y1 / src_res]) - A @ np.array([tx, ty])
        return (A[0, 0], A[0, 1], off[0], A[1, 0], A[1, 1], off[1])

    canvas = Image.new("RGB", (W, H), (239, 231, 214))
    ground = ground_src.transform((W, H), Image.AFFINE, inverse(res), resample=Image.NEAREST)
    ground = ground.filter(ImageFilter.ModeFilter(3))
    shadow_img = sh.resize((sh.width * 2, sh.height * 2), Image.BILINEAR).transform((W, H), Image.AFFINE, inverse(res), resample=Image.BILINEAR)

    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).polygon(to_screen_xy(cam, region.exterior.coords), fill=255)
    canvas.paste(ground, (0, 0), mask)
    draw = ImageDraw.Draw(canvas)

    # 3. OSM surfaces, back to front in importance.
    areas = defaultdict(list)
    roads, paths, rails = [], [], []
    for el in elements:
        t = el.get("tags", {})
        if el["type"] == "node":
            continue
        hw = t.get("highway")
        if el["type"] == "way" and hw and t.get("area") != "yes" and "building" not in t:
            line = way_line(el)
            if line is None or not rp.intersects(line):
                continue
            if t.get("tunnel") in ("yes", "building_passage") or t.get("layer", "0").startswith("-"):
                continue
            if hw in ROAD_STYLE:
                w = ROAD_STYLE[hw][0]
                if "lanes" in t:
                    try:
                        w = max(w, float(t["lanes"]) * 3.3)
                    except ValueError:
                        pass
                roads.append((line, w, ROAD_STYLE[hw][1], hw))
            elif hw in PATH_STYLE:
                paths.append((line, *PATH_STYLE[hw]))
            continue
        if el["type"] == "way" and t.get("railway") in ("rail", "light_rail"):
            line = way_line(el)
            if line is not None and rp.intersects(line):
                rails.append(line)
            continue
        kind = surface_kind(t)
        if kind:
            g = element_polygon(el)
            if g is not None and rp.intersects(g):
                areas[kind].append((g.intersection(region), t))

    for kind in ("parking", "plaza", "sand", "pitch", "track_area", "court", "pool", "water"):
        for g, t in areas.get(kind, []):
            paint_area(draw, cam, kind, g, t)

    for line, w, col in sorted(paths, key=lambda p: p[1]):
        g = line.buffer(w / 2, cap_style=1, join_style=1).intersection(region)
        draw_poly(draw, cam, g, fill=col)

    for line, w, col, hw in sorted(roads, key=lambda r: r[1]):
        casing = line.buffer(w / 2 + 0.6, cap_style=2, join_style=2).intersection(region)
        draw_poly(draw, cam, casing, fill="#9c968a")
    for line, w, col, hw in sorted(roads, key=lambda r: r[1]):
        g = line.buffer(w / 2, cap_style=1, join_style=1).intersection(region)
        draw_poly(draw, cam, g, fill=col)
    for line, w, col, hw in roads:
        if hw in ("primary", "secondary", "tertiary", "trunk"):
            dash_line(draw, cam, line.intersection(region), "#e8d27a" if hw != "tertiary" else "#e8e4d8")

    for line in rails:
        g = line.buffer(2.2, cap_style=2).intersection(region)
        draw_poly(draw, cam, g, fill="#8f877a")
        for part in getattr(line.intersection(region), "geoms", [line.intersection(region)]):
            if part.geom_type == "LineString" and len(part.coords) > 1:
                draw.line(to_screen_xy(cam, part.coords), fill="#4a4743", width=2)

    # 4. Shadows on top of everything painted on the ground.
    arr = np.asarray(canvas).astype(np.float32)
    s = np.asarray(shadow_img).astype(np.float32)[..., None] / 255 * (np.asarray(mask)[..., None] > 0)
    tint = np.array([70, 82, 118], np.float32)
    arr = arr * (1 - 0.36 * s) + tint * 0.36 * s * 0.6
    canvas = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    paint_slab(canvas, cam, region)
    return canvas


def surface_kind(t):
    if t.get("leisure") == "swimming_pool" or t.get("sport") == "swimming":
        return "pool"
    if t.get("natural") == "water" or t.get("water") or t.get("waterway") == "riverbank":
        return "water"
    if t.get("leisure") == "track" or (t.get("leisure") == "pitch" and t.get("sport") == "running"):
        return "track_area"
    if t.get("leisure") == "pitch" and t.get("sport") in ("tennis", "basketball", "volleyball", "beachvolleyball", "pickleball"):
        return "sand" if "beach" in t.get("sport", "") else "court"
    if t.get("leisure") == "pitch":
        return "pitch"
    if t.get("amenity") in ("parking",) and t.get("parking") not in ("underground", "multi-storey"):
        return "parking"
    if t.get("highway") == "pedestrian" or t.get("area:highway") or t.get("place") == "square":
        return "plaza"
    if t.get("natural") in ("sand", "beach"):
        return "sand"
    return None


def paint_area(draw, cam, kind, g, t):
    if kind == "parking":
        draw_poly(draw, cam, g, fill="#797a7e", outline="#8e8f92")
    elif kind == "plaza":
        draw_poly(draw, cam, g, fill="#e7dcc4")
    elif kind == "sand":
        draw_poly(draw, cam, g, fill="#e4cf9c")
    elif kind == "pitch":
        surf = t.get("surface", "")
        col = "#5f9a4e" if surf not in ("dirt", "clay") else "#c49565"
        if t.get("sport") in ("baseball", "softball"):
            col = "#6aa257"
        draw_poly(draw, cam, g, fill=col, outline="#eef2e8")
    elif kind == "track_area":
        draw_poly(draw, cam, g, fill="#b45a43", outline="#f0e6dc")
    elif kind == "court":
        col = "#4f7f9a" if t.get("sport") == "tennis" else "#b77b4e"
        draw_poly(draw, cam, g, fill=col, outline="#f2f4f2")
    elif kind == "pool":
        draw_poly(draw, cam, g, fill="#5fb7d4", outline="#e8f3f6")
    elif kind == "water":
        draw_poly(draw, cam, g, fill="#6f9fbf", outline="#b6d2e0")


def dash_line(draw, cam, line, col, dash=3.0, gap=4.0):
    for part in getattr(line, "geoms", [line]):
        if part.is_empty or part.geom_type != "LineString":
            continue
        L = part.length
        s = 0.0
        while s < L:
            a = part.interpolate(s)
            b = part.interpolate(min(L, s + dash))
            draw.line([cam.screen(a.x, a.y), cam.screen(b.x, b.y)], fill=col, width=1)
            s += dash + gap


def paint_slab(canvas, cam, region):
    """Give the map edge a soil cross-section, like a floating diorama."""
    draw = ImageDraw.Draw(canvas)
    pts = list(region.exterior.coords)[:-1]
    if Polygon(pts).exterior.is_ccw is False:
        pts = pts[::-1]
    depth = 14.0
    layers = [(0.0, 0.8, "#5e8f45"), (0.8, 4.0, "#8a6a48"), (4.0, 9.0, "#76583c"), (9.0, depth, "#624832")]
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        nx, ny = b[1] - a[1], -(b[0] - a[0])
        r1, r2 = cam.r(nx, ny)
        if r2 >= 0:
            continue
        for z0, z1, col in layers:
            quad = [cam.screen(a[0], a[1], -z0), cam.screen(b[0], b[1], -z0), cam.screen(b[0], b[1], -z1), cam.screen(a[0], a[1], -z1)]
            shade = 1.0 if r1 < 0 else 0.82
            c = tuple(int(int(col[j : j + 2], 16) * shade) for j in (1, 3, 5))
            draw.polygon(quad, fill=c)


def sun_vector(cam: Camera):
    r1, r2 = SUN_SCREEN
    L = math.hypot(r1, r2)
    r1, r2 = r1 / L, r2 / L
    # invert r = (e cos b - n sin b, e sin b + n cos b)
    e = r1 * cam.cos_b + r2 * cam.sin_b
    n = -r1 * cam.sin_b + r2 * cam.cos_b
    el = math.radians(SUN_ELEVATION)
    return (e * math.cos(el), n * math.cos(el), math.sin(el))


def cast_shadows(grid: Grid, cam: Camera):
    hgt = ndimage.zoom(ndimage.maximum_filter(grid.chm, size=2), 0.5, order=1)
    res = grid.res * 2
    se, sn, sz = sun_vector(cam)
    horiz = math.hypot(se, sn)
    de, dn = se / horiz, sn / horiz
    tan = sz / horiz
    shadow = np.zeros_like(hgt)
    steps = int(90 / tan / res)
    for s in range(1, steps + 1):
        t = s * res
        dc = de * t / res
        dr = -dn * t / res
        shifted = ndimage.shift(hgt, (-dr, -dc), order=0, mode="constant", cval=0)
        shadow = np.maximum(shadow, np.clip((shifted - t * tan - hgt - 0.4) / 1.5, 0, 1))
    return shadow


# --------------------------------------------------------------------------- labels


AREA_LABEL_KEYS = {
    "leisure": {"park", "garden", "pitch", "stadium", "track", "golf_course", "sports_centre", "nature_reserve", "playground"},
    "landuse": {"grass", "recreation_ground", "meadow", "forest", "residential", "religious", "farmland", "allotments"},
    "natural": {"water", "wood", "scrub", "grassland"},
    "amenity": {"university", "hospital", "school", "parking", "kindergarten"},
    "place": {"square", "neighbourhood", "quarter"},
}


def area_labels(elements, region, cam):
    out = []
    rp = prep(region)
    for el in elements:
        t = el.get("tags", {})
        name = t.get("name")
        if not name or el["type"] == "node" or "building" in t or "highway" in t:
            continue
        cat = None
        for k, vals in AREA_LABEL_KEYS.items():
            if t.get(k) in vals:
                cat = k
                break
        if cat is None:
            continue
        g = element_polygon(el)
        if g is None or g.area < 900 or not rp.contains(g.representative_point()):
            continue
        if t.get("amenity") == "university" or name in ("Stanford University",):
            continue
        p = g.representative_point()
        sx, sy = cam.screen(p.x, p.y, 0)
        kind = "athletics" if t.get("leisure") in ("pitch", "stadium", "track", "sports_centre") else "place"
        if t.get("amenity") == "parking":
            kind = "parking"
        if t.get("amenity") == "hospital":
            kind = "medical"
        rank = 4 + min(4, int(math.log10(max(g.area, 1000)) - 2))
        if kind == "parking":
            rank = 1
        out.append({"name": name, "category": kind, "x": round(sx, 1), "y": round(sy, 1), "rank": rank, "kind": "area"})
    return out


EXTRA_PLACES = [
    ("Main Quad", 37.42746, -122.17025, "landmark", 10),
    ("The Oval", 37.42947, -122.16947, "place", 8),
    ("Palm Drive", 37.43380, -122.16760, "place", 7),
    ("Engineering Quad", 37.42820, -122.17670, "place", 7),
    ("White Plaza", 37.42440, -122.17050, "place", 6),
    ("Lake Lagunita", 37.42230, -122.17650, "place", 8),
    ("The Row", 37.42290, -122.16890, "residence", 7),
]


def street_labels(elements, region, cam):
    seen = defaultdict(list)
    for el in elements:
        t = el.get("tags", {})
        if el["type"] != "way" or t.get("highway") not in ROAD_STYLE or not t.get("name"):
            continue
        line = way_line(el)
        if line is None:
            continue
        seg = line.intersection(region)
        if seg.is_empty:
            continue
        seen[t["name"]].append(seg)
    out = []
    for name, segs in seen.items():
        longest = max((g for s in segs for g in getattr(s, "geoms", [s]) if g.geom_type == "LineString"), key=lambda g: g.length, default=None)
        if longest is None or longest.length < 120:
            continue
        mid = longest.interpolate(0.5, normalized=True)
        a = longest.interpolate(max(0, longest.length / 2 - 15))
        b = longest.interpolate(min(longest.length, longest.length / 2 + 15))
        (ax, ay), (bx, by) = cam.screen(a.x, a.y), cam.screen(b.x, b.y)
        ang = math.degrees(math.atan2(by - ay, bx - ax))
        if ang > 90:
            ang -= 180
        if ang < -90:
            ang += 180
        sx, sy = cam.screen(mid.x, mid.y)
        out.append({"name": name, "category": "street", "x": round(sx, 1), "y": round(sy, 1), "angle": round(ang, 1), "rank": 5 if sum(s.length for s in segs) > 600 else 3, "kind": "street"})
    return out


# --------------------------------------------------------------------------- main


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "data").mkdir(parents=True, exist_ok=True)
    region = Polygon(region_polygon_local())
    cam = Camera()
    cam.fit(list(region.exterior.coords), top_margin_m=110, bottom_margin_px=70)
    print(f"image {cam.width} x {cam.height} px")

    elements = load_osm()
    grid = Grid()
    print("lidar + naip loaded")

    blds = collect_buildings(elements, region)
    print(f"{len(blds)} buildings")
    label = lidar_heights(blds, grid)
    official = attach_names(blds, json.loads((RAW / "stanford" / "buildings.json").read_text()))

    buildings_out, places = [], []
    groups = defaultdict(list)
    labeled = set()
    group_top, group_base, group_area = defaultdict(float), {}, defaultdict(float)
    for b in blds:
        g = b["group"]
        group_top[g] = max(group_top[g], b["h"], *[pp["h"] for pp in b.get("parts", [])])
        if b["poly"].area > group_area[g]:
            group_area[g] = b["poly"].area
            group_base[g] = b.get("eave", b["h"]) if b["roof"] != "flat" else b["h"]
    for i, b in enumerate(blds):
        group, short, raw = display_name(b)
        b["category"] = N.categorize(raw, group, b["tags"]) if (raw or group) else (
            "residence" if b["tags"].get("building") in ("house", "detached", "residential", "apartments", "dormitory") else "other")
        off = b.get("official")
        b["main_quad"] = bool(off and "MAIN QUAD" in off["raw"])
        roof = stylize_roof(b.get("roof_rgb"), b["roof"])
        wall = wall_color(b, roof, zlib.crc32(b["osm"].encode()))
        p = b["poly"]
        if p.exterior.is_ccw is False:
            p = Polygon(p.exterior.coords[::-1], [h.coords for h in p.interiors])
        rings = [[[round(x, 2), round(y, 2)] for x, y in p.exterior.coords]]
        for hole in p.interiors:
            hc = list(hole.coords)
            if Polygon(hc).exterior.is_ccw:
                hc = hc[::-1]
            rings.append([[round(x, 2), round(y, 2)] for x, y in hc])
        rec = {
            "id": i,
            "rings": rings,
            "h": round(b["h"], 2),
            "roof": b["roof"],
            "roofColor": "#%02x%02x%02x" % roof,
            "wallColor": "#%02x%02x%02x" % wall,
            "category": b["category"],
        }
        if b.get("minH"):
            rec["minH"] = round(b["minH"], 2)
        if b["roof"] in ("hipped", "dome"):
            rec["eave"] = round(b["eave"], 2)
            rec["pitch"] = round(b["pitch"], 3)
            rec["rise"] = round(b["rise"], 2)
        if short:
            rec["name"] = short
        buildings_out.append(rec)
        for part in b.get("parts", []):
            q = part["poly"]
            if q.exterior.is_ccw is False:
                q = Polygon(q.exterior.coords[::-1])
            buildings_out.append({
                "id": len(buildings_out) + 100000,
                "rings": [[[round(x, 2), round(y, 2)] for x, y in q.exterior.coords]],
                "h": round(part["h"], 2),
                "minH": round(part["minH"], 2),
                "roof": part["roof"],
                **({"eave": round(part["eave"], 2), "pitch": round(part["pitch"], 3), "rise": round(part["rise"], 2)}
                   if part["roof"] == "hipped" else {}),
                "roofColor": rec["roofColor"],
                "wallColor": rec["wallColor"],
                "category": rec["category"],
                **({"name": short} if short else {}),
            })

        if short and not N.skip_label(raw or short.upper()) and b["group"] not in labeled:
            labeled.add(b["group"])
            gp = b["group_poly"]
            lp = gp.representative_point()
            top = group_top[b["group"]]
            sx, sy = cam.screen(lp.x, lp.y, top)
            outline = [[round(v, 1) for v in cam.screen(x, y, group_base[b["group"]])] for x, y in gp.simplify(0.8).exterior.coords]
            rank = N.LANDMARKS.get(raw, 0)
            if not rank and N.is_minor(short):
                rank = 1
            if not rank:
                rank = 3 if b["category"] in ("residence",) else 2
                if gp.area > 2500:
                    rank += 2
                elif gp.area > 900:
                    rank += 1
            places.append({
                "name": short,
                "group": group,
                "category": b["category"],
                "x": round(sx, 1),
                "y": round(sy, 1),
                "rank": rank,
                "kind": "building",
                "outline": outline,
                "official": N.pretty(raw) if raw else None,
                "bldgId": off["id"] if off else None,
                "height": round(top, 1),
                "lonlat": [round(v, 6) for v in local_to_lonlat(lp.x, lp.y)],
            })
            if group:
                groups[group].append((lp.x, lp.y, b["h"], b["category"]))

    # Official buildings that didn't match an OSM footprint still get a label at their extent.
    for o in official:
        if o["match"] is not None or N.skip_label(o["raw"]):
            continue
        c = o["box"].centroid
        if not region.contains(c):
            continue
        rr, cc = grid.rc(c.x, c.y)
        h = float(grid.chm[rr, cc]) if 0 <= rr < grid.H and 0 <= cc < grid.W else 0.0
        group, short = N.split_complex(o["raw"])
        sx, sy = cam.screen(c.x, c.y, h)
        places.append({"name": short, "group": group, "category": N.categorize(o["raw"], group, {}), "x": round(sx, 1), "y": round(sy, 1), "rank": N.LANDMARKS.get(o["raw"], 2), "kind": "building", "official": N.pretty(o["raw"]), "bldgId": o["id"]})

    for g, pts in groups.items():
        arr = np.array([(x, y, h) for x, y, h, _ in pts])
        cx, cy = arr[:, 0].mean(), arr[:, 1].mean()
        sx, sy = cam.screen(cx, cy, arr[:, 2].max() + 8)
        cat = pts[0][3] if g not in N.RESIDENCE_COMPLEXES else "residence"
        places.append({"name": g, "category": cat, "x": round(sx, 1), "y": round(sy, 1), "rank": 8 if len(pts) > 2 else 6, "kind": "complex", "count": len(pts)})

    for name, lat, lon, cat, rank in EXTRA_PLACES:
        x, y = lonlat_to_local(lon, lat)
        if region.contains(Point(x, y)):
            sx, sy = cam.screen(x, y, 0)
            places.append({"name": name, "category": cat, "x": round(sx, 1), "y": round(sy, 1), "rank": rank, "kind": "area"})

    places += area_labels(elements, region, cam)
    places += street_labels(elements, region, cam)

    for layer, cat in (("eateries", "dining"), ("libraries", "library")):
        for row in json.loads((RAW / "stanford" / f"{layer}.json").read_text()):
            ext = row.get("extent")
            if not ext or any(isinstance(v, str) for v in ext):
                continue
            x, y = lonlat_to_local((ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2)
            if not region.contains(Point(x, y)):
                continue
            rr, cc = grid.rc(x, y)
            h = float(grid.chm[rr, cc]) if 0 <= rr < grid.H and 0 <= cc < grid.W else 0.0
            sx, sy = cam.screen(x, y, h)
            places.append({"name": row["NAME"], "category": cat, "x": round(sx, 1), "y": round(sy, 1), "rank": 3 if cat == "library" else 2, "kind": "poi"})

    # Places without a footprint get coordinates by inverting the camera at ground level.
    a, b_, c_, d_, tx, ty = cam.affine_ground()
    Mi = np.linalg.inv(np.array([[a, b_], [c_, d_]]))
    for pl in places:
        if "lonlat" not in pl:
            h = pl.get("height", 0) or 0
            e, n = Mi @ np.array([pl["x"] - tx, pl["y"] - ty + cam.k * cam.cos_e * h])
            pl["lonlat"] = [round(v, 6) for v in local_to_lonlat(float(e), float(n))]

    # De-duplicate labels with the same name near each other.
    seen = {}
    deduped = []
    for pl in sorted(places, key=lambda p: -p["rank"]):
        key = norm(pl["name"])
        prev = seen.get(key)
        if prev and math.hypot(prev["x"] - pl["x"], prev["y"] - pl["y"]) < 400:
            continue
        seen[key] = pl
        deduped.append(pl)
    ids = defaultdict(int)
    for pl in deduped:
        base = re.sub(r"[^a-z0-9]+", "-", pl["name"].lower()).strip("-") or "place"
        ids[base] += 1
        pl["id"] = base if ids[base] == 1 else f"{base}-{ids[base]}"

    palm_lines = []
    for el in elements:
        if el["type"] == "way" and el.get("tags", {}).get("name") == "Palm Drive":
            ln = way_line(el)
            if ln is not None:
                palm_lines.append(ln)
    trees = detect_trees(grid, label, osm_tree_points(elements), palm_lines)
    rp = prep(region.buffer(-1.0))
    trees = [t for t in trees if rp.contains(Point(t[0], t[1]))]
    print(f"{len(trees)} trees")

    scene = {"camera": cam.to_json(), "sun": sun_vector(cam), "region": [list(p) for p in region.exterior.coords], "buildings": buildings_out, "trees": trees}
    (BUILD / "scene.json").write_text(json.dumps(scene, separators=(",", ":")))
    print(f"wrote scene.json: {len(buildings_out)} buildings")

    meta = {"camera": cam.to_json(), "places": deduped,
            "attribution": "© OpenStreetMap contributors · USGS 3DEP lidar · USDA NAIP imagery · Stanford LBRE Maps & Records"}
    (PUBLIC / "data" / "places.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"wrote places.json: {len(deduped)} labels")

    ground = paint_ground(cam, grid, elements, region, label)
    ground.save(BUILD / "ground.png", optimize=False, compress_level=1)
    print("wrote ground.png")


if __name__ == "__main__":
    main()
