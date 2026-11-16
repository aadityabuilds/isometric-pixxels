import math
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
BUILD = ROOT / "data" / "build"
PUBLIC = ROOT / "public"

# All local geometry lives in UTM zone 10N, metres, relative to the Main Quad.
LOCAL_CRS = "EPSG:32610"
CENTER_LATLON = (37.4275, -122.1697)

# The campus street grid (and Palm Drive) runs at this compass bearing.
GRID_BEARING = 14.4

# Map region as a rectangle in grid coordinates (metres from the Main Quad):
# g1 runs up Palm Drive toward El Camino Real, g2 runs toward Escondido Village.
REGION = {"g1": (-950.0, 1500.0), "g2": (-950.0, 1600.0)}

# The camera looks 45 degrees off the grid so streets form the classic 2:1 diamond,
# from the Palm Drive / El Camino side toward Lake Lagunita.
CAMERA_BEARING = GRID_BEARING + 180 + 45
CAMERA_ELEVATION = 30.0
PX_PER_M = 3.0

LIDAR_RES = 0.5
FETCH_MARGIN_M = 60.0

USER_AGENT = "stanford-pixxel/0.1 (isometric campus map)"

_to_local = Transformer.from_crs("EPSG:4326", LOCAL_CRS, always_xy=True)
_to_ll = Transformer.from_crs(LOCAL_CRS, "EPSG:4326", always_xy=True)
CENTER_UTM = _to_local.transform(CENTER_LATLON[1], CENTER_LATLON[0])


def grid_axes():
    t = math.radians(GRID_BEARING)
    a1 = (math.sin(t), math.cos(t))
    a2 = (math.cos(t), -math.sin(t))
    return a1, a2


def region_corners_local(margin: float = 0.0):
    """Region corners as local (east, north) metres."""
    a1, a2 = grid_axes()
    out = []
    for g1 in (REGION["g1"][0] - margin, REGION["g1"][1] + margin):
        for g2 in (REGION["g2"][0] - margin, REGION["g2"][1] + margin):
            out.append((g1 * a1[0] + g2 * a2[0], g1 * a1[1] + g2 * a2[1]))
    return out


def region_polygon_local(margin: float = 0.0):
    c = region_corners_local(margin)
    return [c[0], c[1], c[3], c[2]]


def _bbox():
    xs, ys = [], []
    for e, n in region_corners_local(FETCH_MARGIN_M):
        lon, lat = _to_ll.transform(e + CENTER_UTM[0], n + CENTER_UTM[1])
        xs.append(lon)
        ys.append(lat)
    return {"west": min(xs), "south": min(ys), "east": max(xs), "north": max(ys)}


BBOX = _bbox()


def bbox_tuple():
    return BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"]
