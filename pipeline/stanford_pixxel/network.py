"""Export the street, bike and footpath graph, parking spots and Marguerite shuttle trips in map pixels.

These drive the live layer in the viewer (cars, bikes, students, shuttles). Everything is projected with
the same camera as the map, so agents land exactly on the painted roads.
"""

from __future__ import annotations

import csv
import io
import json
import math
from collections import defaultdict

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.prepared import prep

from .config import PUBLIC, RAW, region_polygon_local
from .geo import Camera, element_polygon, load_osm, lonlat_to_local, polygons_of

CAR = 1
BIKE = 2
WALK = 4

ROAD_CLASSES = {
    "motorway": (CAR, 24), "trunk": (CAR, 20), "primary": (CAR | BIKE, 15), "primary_link": (CAR, 11),
    "secondary": (CAR | BIKE, 13), "secondary_link": (CAR, 10), "tertiary": (CAR | BIKE, 11),
    "tertiary_link": (CAR, 9), "unclassified": (CAR | BIKE | WALK, 10), "residential": (CAR | BIKE | WALK, 9),
    "living_street": (CAR | BIKE | WALK, 5), "service": (CAR | BIKE | WALK, 6),
    "cycleway": (BIKE, 0), "footway": (WALK | BIKE, 0), "path": (WALK | BIKE, 0), "pedestrian": (WALK | BIKE, 0),
    "steps": (WALK, 0), "track": (WALK | BIKE, 0),
}
# Lane half-widths in metres, used by the viewer to offset traffic to the right-hand side.
LANE = {"motorway": 3.4, "trunk": 3.4, "primary": 3.4, "secondary": 3.0, "tertiary": 2.6}


def modes_for(tags):
    hw = tags.get("highway")
    if hw not in ROAD_CLASSES:
        return 0, 0
    modes, speed = ROAD_CLASSES[hw]
    if hw in ("footway", "path", "pedestrian") and tags.get("bicycle") in ("no", "dismount"):
        modes &= ~BIKE
    if tags.get("foot") == "no":
        modes &= ~WALK
    if tags.get("bicycle") in ("yes", "designated"):
        modes |= BIKE
    if tags.get("service") in ("parking_aisle", "drive-through"):
        speed = 4
    if tags.get("access") in ("private", "no") and modes & CAR:
        modes &= ~CAR
    if tags.get("motor_vehicle") == "no":
        modes &= ~CAR
    return modes, speed


def build_graph(elements, region, cam: Camera):
    rp = prep(region.buffer(30))
    ways = []
    use = defaultdict(int)
    for el in elements:
        if el["type"] != "way":
            continue
        t = el.get("tags", {})
        modes, speed = modes_for(t)
        if not modes or t.get("area") == "yes" or t.get("tunnel") in ("yes", "building_passage") or str(t.get("layer", "0")).startswith("-"):
            continue
        nodes = el.get("nodes") or []
        geom = el.get("geometry") or []
        if len(nodes) < 2 or len(nodes) != len(geom):
            continue
        pts = [lonlat_to_local(g["lon"], g["lat"]) for g in geom]
        if not rp.intersects(LineString(pts)):
            continue
        oneway = t.get("oneway") in ("yes", "1", "true") or t.get("junction") == "roundabout"
        ways.append((nodes, pts, modes, speed, oneway, t.get("highway")))
        for n in nodes:
            use[n] += 1

    node_index = {}
    node_xy = []

    def nid(osm_id, p):
        if osm_id not in node_index:
            node_index[osm_id] = len(node_xy)
            node_xy.append(p)
        return node_index[osm_id]

    edges = []
    for nodes, pts, modes, speed, oneway, hw in ways:
        start = 0
        for i in range(1, len(nodes)):
            if i == len(nodes) - 1 or use[nodes[i]] > 1:
                seg = pts[start : i + 1]
                if len(seg) >= 2:
                    a = nid(nodes[start], pts[start])
                    b = nid(nodes[i], pts[i])
                    length = LineString(seg).length
                    if length > 0.5:
                        scr = [cam.screen(x, y) for x, y in seg]
                        edges.append({
                            "a": a,
                            "b": b,
                            "m": modes,
                            "s": speed,
                            "o": 1 if oneway else 0,
                            "l": round(length, 1),
                            "w": LANE.get(hw.replace("_link", ""), 0),
                            "p": [round(v, 1) for xy in scr for v in xy],
                        })
                start = i
    return node_xy, edges


def parking_spots(elements, region, cam: Camera, limit=6000):
    rp = prep(region)
    spots = []
    for el in elements:
        t = el.get("tags", {})
        if t.get("amenity") != "parking" or t.get("parking") in ("underground", "multi-storey") or el["type"] == "node":
            continue
        g = element_polygon(el)
        for poly in polygons_of(g):
            if poly.area < 300 or not rp.contains(poly.representative_point()):
                continue
            mrr = poly.minimum_rotated_rectangle
            c = list(mrr.exterior.coords)
            e0 = (c[1][0] - c[0][0], c[1][1] - c[0][1])
            e1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
            long_axis = e0 if math.hypot(*e0) >= math.hypot(*e1) else e1
            ang = math.atan2(long_axis[1], long_axis[0])
            ux, uy = math.cos(ang), math.sin(ang)
            vx, vy = -uy, ux
            cx, cy = poly.centroid.x, poly.centroid.y
            inner = prep(poly.buffer(-1.5))
            R = math.hypot(*e0) + math.hypot(*e1)
            # Double rows of stalls 2.7 m wide, 5.2 m deep, with 6.5 m aisles.
            row = -R
            while row < R:
                for side in (0, 1):
                    off = row + side * 5.2
                    s = -R
                    while s < R:
                        px = cx + ux * s + vx * off
                        py = cy + uy * s + vy * off
                        if inner.contains(Point(px, py)):
                            sx, sy = cam.screen(px, py)
                            # Cars park nose-in, perpendicular to the row.
                            hx, hy = cam.screen(px + vx * (1 if side else -1), py + vy * (1 if side else -1))
                            spots.append([round(sx, 1), round(sy, 1), round(math.atan2(hy - sy, hx - sx), 2)])
                        s += 2.7
                row += 5.2 * 2 + 6.5
    rng = np.random.default_rng(3)
    if len(spots) > limit:
        idx = rng.choice(len(spots), limit, replace=False)
        spots = [spots[i] for i in sorted(idx)]
    return spots


def anchors(places, node_xy, edges, cam: Camera):
    """Nearest walkable node to every labelled building, grouped by category (spawn points for students)."""
    walk_nodes = sorted({e["a"] for e in edges if e["m"] & WALK} | {e["b"] for e in edges if e["m"] & WALK})
    if not walk_nodes:
        return {}
    pts = np.array([cam.screen(*node_xy[n]) for n in walk_nodes])
    kd = cKDTree(pts)
    out = defaultdict(list)
    for p in places:
        if p["kind"] not in ("building", "poi"):
            continue
        d, j = kd.query([p["x"], p["y"] + 25])
        if d < 120:
            out[p["category"]].append(int(walk_nodes[j]))
    return {k: sorted(set(v)) for k, v in out.items()}


def shuttles(cam: Camera, region):
    root = RAW / "gtfs"
    if not (root / "trips.txt").exists():
        return None

    def rows(name):
        return list(csv.DictReader(io.open(root / name, encoding="utf-8-sig")))

    routes = {r["route_id"]: r for r in rows("routes.txt")}
    shapes = defaultdict(list)
    for r in rows("shapes.txt"):
        shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"]), r.get("shape_dist_traveled")))
    rp = prep(region)
    shape_out = {}
    for sid, pts in shapes.items():
        pts.sort()
        local = [lonlat_to_local(lon, lat) for _, lat, lon, _ in pts]
        line = LineString(local)
        if not rp.intersects(line):
            continue
        if all(d not in (None, "") for *_, d in pts):
            cum = [float(d) for *_, d in pts]
        else:
            cum = [0.0]
            for i in range(1, len(local)):
                cum.append(cum[-1] + math.hypot(local[i][0] - local[i - 1][0], local[i][1] - local[i - 1][1]))
        scr = [cam.screen(x, y) for x, y in local]
        shape_out[sid] = {"p": [round(v, 1) for xy in scr for v in xy], "d": [round(c, 1) for c in cum]}

    stop_times = defaultdict(list)
    for r in rows("stop_times.txt"):
        h, m, s_ = map(int, r["departure_time"].split(":"))
        dist = r.get("shape_dist_traveled")
        stop_times[r["trip_id"]].append((int(r["stop_sequence"]), h * 3600 + m * 60 + s_, float(dist) if dist else None))

    trips = []
    for r in rows("trips.txt"):
        sid = r.get("shape_id")
        if sid not in shape_out or r["trip_id"] not in stop_times:
            continue
        st = sorted(stop_times[r["trip_id"]])
        if any(d is None for _, _, d in st):
            continue
        route = routes.get(r["route_id"], {})
        trips.append({
            "s": r["service_id"],
            "sh": sid,
            "r": route.get("route_short_name", ""),
            "c": "#" + (route.get("route_color") or "8C1515"),
            "t": [t for _, t, _ in st],
            "d": [round(d, 1) for _, _, d in st],
        })

    services = {}
    for r in rows("calendar.txt"):
        services[r["service_id"]] = {
            "days": [int(r[d]) for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")],
            "start": r["start_date"],
            "end": r["end_date"],
            "add": [],
            "remove": [],
        }
    if (root / "calendar_dates.txt").exists():
        for r in rows("calendar_dates.txt"):
            s = services.setdefault(r["service_id"], {"days": [0] * 7, "start": "0", "end": "99999999", "add": [], "remove": []})
            (s["add"] if r["exception_type"] == "1" else s["remove"]).append(r["date"])
    used = {t["s"] for t in trips}
    return {"shapes": shape_out, "trips": trips, "services": {k: v for k, v in services.items() if k in used}}


def main():
    meta = json.loads((PUBLIC / "data" / "places.json").read_text())
    cam = Camera()
    c = meta["camera"]
    cam.ox, cam.oy, cam.width, cam.height = c["ox"], c["oy"], c["width"], c["height"]
    region = Polygon(region_polygon_local())
    elements = load_osm()
    node_xy, edges = build_graph(elements, region, cam)
    nodes_px = [[round(v, 1) for v in cam.screen(x, y)] for x, y in node_xy]
    out = {
        "nodes": nodes_px,
        "edges": edges,
        "parking": parking_spots(elements, region, cam),
        "anchors": anchors(meta["places"], node_xy, edges, cam),
        "pxPerM": cam.k,
    }
    (PUBLIC / "data" / "network.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"network: {len(nodes_px)} nodes, {len(edges)} edges, {len(out['parking'])} parking spots")
    sh = shuttles(cam, region)
    if sh:
        (PUBLIC / "data" / "shuttles.json").write_text(json.dumps(sh, separators=(",", ":")))
        print(f"shuttles: {len(sh['trips'])} trips on {len(sh['shapes'])} shapes")


if __name__ == "__main__":
    main()
