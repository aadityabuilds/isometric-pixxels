"""OpenStreetMap parsing and coordinate helpers."""

from __future__ import annotations

import json
import math

from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union

from .config import CAMERA_BEARING, CAMERA_ELEVATION, CENTER_UTM, LOCAL_CRS, PX_PER_M, RAW

_to_local = Transformer.from_crs("EPSG:4326", LOCAL_CRS, always_xy=True)


def lonlat_to_local(lon, lat):
    x, y = _to_local.transform(lon, lat)
    return x - CENTER_UTM[0], y - CENTER_UTM[1]


def load_osm():
    return json.loads((RAW / "osm.json").read_text())["elements"]


def _coords(geometry):
    return [lonlat_to_local(p["lon"], p["lat"]) for p in geometry if p]


def way_line(el) -> LineString | None:
    pts = _coords(el.get("geometry", []))
    return LineString(pts) if len(pts) >= 2 else None


def way_polygon(el) -> Polygon | None:
    pts = _coords(el.get("geometry", []))
    if len(pts) < 4 or pts[0] != pts[-1]:
        return None
    p = Polygon(pts)
    if not p.is_valid:
        p = p.buffer(0)
    return p if not p.is_empty else None


def relation_polygon(el):
    outers, inners = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or "geometry" not in m:
            continue
        line = _coords(m["geometry"])
        if len(line) < 2:
            continue
        (inners if m.get("role") == "inner" else outers).append(LineString(line))
    if not outers:
        return None
    outer = unary_union(list(polygonize(unary_union(outers))))
    if inners:
        inner = unary_union(list(polygonize(unary_union(inners))))
        outer = outer.difference(inner)
    if not outer.is_valid:
        outer = outer.buffer(0)
    return outer if not outer.is_empty else None


def element_polygon(el):
    if el["type"] == "way":
        return way_polygon(el)
    if el["type"] == "relation":
        return relation_polygon(el)
    return None


def polygons_of(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


class Camera:
    """Orthographic isometric camera shared by the ground painter, the WebGL renderer and the viewer."""

    def __init__(self):
        b = math.radians(CAMERA_BEARING)
        self.sin_b, self.cos_b = math.sin(b), math.cos(b)
        e = math.radians(CAMERA_ELEVATION)
        self.sin_e, self.cos_e = math.sin(e), math.cos(e)
        self.k = PX_PER_M
        self.ox = 0.0
        self.oy = 0.0
        self.width = 0
        self.height = 0

    def r(self, e, n):
        """Ground point to (right, depth) metres; depth grows away from the viewer."""
        return e * self.cos_b - n * self.sin_b, e * self.sin_b + n * self.cos_b

    def screen(self, e, n, h=0.0):
        r1, r2 = self.r(e, n)
        return self.k * r1 - self.ox, self.k * (-self.sin_e * r2 - self.cos_e * h) - self.oy

    def fit(self, ground_pts, top_margin_m: float, bottom_margin_px: float):
        xs, ys = [], []
        for e, n in ground_pts:
            r1, r2 = self.r(e, n)
            xs.append(self.k * r1)
            ys.append(self.k * (-self.sin_e * r2))
        self.ox = min(xs)
        self.oy = min(ys) - self.k * self.cos_e * top_margin_m
        self.width = int(math.ceil(max(xs) - self.ox))
        self.height = int(math.ceil(max(ys) - self.oy + bottom_margin_px))

    def affine_ground(self):
        """Coefficients (a, b, c, d, tx, ty) with sx = a*e + b*n + tx, sy = c*e + d*n + ty."""
        k = self.k
        return (
            k * self.cos_b,
            -k * self.sin_b,
            -k * self.sin_e * self.sin_b,
            -k * self.sin_e * self.cos_b,
            -self.ox,
            -self.oy,
        )

    def to_json(self):
        return {
            "bearing": CAMERA_BEARING,
            "elevation": CAMERA_ELEVATION,
            "pxPerM": self.k,
            "ox": self.ox,
            "oy": self.oy,
            "width": self.width,
            "height": self.height,
            "centerUtm": list(CENTER_UTM),
            "crs": LOCAL_CRS,
        }
