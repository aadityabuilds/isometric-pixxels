"""Download USGS 3DEP lidar (CA_SantaClaraCounty_2020) for the campus bbox and rasterise it.

The survey is published as an Entwine Point Tile (EPT) octree on the public
usgs-lidar-public bucket. We walk the octree down to MAX_DEPTH for nodes that
intersect the bbox, decode each LAZ node, and accumulate surface rasters on a
regular UTM grid:

  dsm  - highest non-noise return (roofs, canopy)
  dtm  - ground surface (class 2), gap-filled under buildings
  veg  - highest vegetation return (classes 3-5)
  bld  - count of building returns (class 6)
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import laspy
import numpy as np
import requests
from pyproj import Transformer
from scipy import ndimage

from .config import LIDAR_RES, LOCAL_CRS, RAW, bbox_tuple

EPT = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SantaClaraCounty_2020"
MAX_DEPTH = 11
NOISE = {7, 18}

session = requests.Session()


def get_json(url: str):
    r = session.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


def node_bounds(root, key):
    d, x, y, z = map(int, key.split("-"))
    size = (root[3] - root[0]) / (2**d)
    sz = (root[5] - root[2]) / (2**d)
    x0 = root[0] + x * size
    y0 = root[1] + y * size
    z0 = root[2] + z * sz
    return x0, y0, z0, x0 + size, y0 + size, z0 + sz


def intersects(b, q):
    return not (b[3] < q[0] or b[0] > q[2] or b[4] < q[1] or b[1] > q[3])


def collect_nodes(root, query, max_depth):
    nodes = []
    pending = ["0-0-0-0"]
    while pending:
        hkey = pending.pop()
        hier = get_json(f"{EPT}/ept-hierarchy/{hkey}.json")
        for key, count in hier.items():
            d = int(key.split("-")[0])
            if d > max_depth or not intersects(node_bounds(root, key), query):
                continue
            if count == -1:
                pending.append(key)
            elif count > 0:
                nodes.append((key, count))
    return nodes


def fetch_node(key):
    for attempt in range(4):
        try:
            r = session.get(f"{EPT}/ept-data/{key}.laz", timeout=120)
            r.raise_for_status()
            las = laspy.read(io.BytesIO(r.content))
            return (
                np.asarray(las.x),
                np.asarray(las.y),
                np.asarray(las.z, dtype=np.float32),
                np.asarray(las.classification, dtype=np.uint8),
            )
        except Exception:
            if attempt == 3:
                raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-depth", type=int, default=MAX_DEPTH)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    meta = get_json(f"{EPT}/ept.json")
    root = meta["bounds"]
    w, s, e, n = bbox_tuple()

    to_web = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    qx, qy = to_web.transform([w, e, w, e], [s, s, n, n])
    query = (min(qx), min(qy), max(qx), max(qy))

    nodes = collect_nodes(root, query, args.max_depth)
    total = sum(c for _, c in nodes)
    print(f"{len(nodes)} nodes, {total:,} points up to depth {args.max_depth}", flush=True)
    if args.dry_run:
        return

    to_local = Transformer.from_crs("EPSG:3857", LOCAL_CRS, always_xy=True)
    to_local_ll = Transformer.from_crs("EPSG:4326", LOCAL_CRS, always_xy=True)
    ux, uy = to_local_ll.transform([w, e, w, e], [s, s, n, n])
    x0, y1 = min(ux), max(uy)
    res = LIDAR_RES
    W = int(np.ceil((max(ux) - x0) / res))
    H = int(np.ceil((y1 - min(uy)) / res))
    print(f"grid {W}x{H} at {res} m", flush=True)

    dsm = np.full(H * W, -np.inf, np.float32)
    veg = np.full(H * W, -np.inf, np.float32)
    gsum = np.zeros(H * W, np.float64)
    gcnt = np.zeros(H * W, np.uint32)
    bld = np.zeros(H * W, np.uint32)

    def accumulate(pts):
        px, py, pz, cls = pts
        lx, ly = to_local.transform(px, py)
        col = ((np.asarray(lx) - x0) / res).astype(np.int64)
        row = ((y1 - np.asarray(ly)) / res).astype(np.int64)
        ok = (col >= 0) & (col < W) & (row >= 0) & (row < H) & ~np.isin(cls, list(NOISE))
        idx = row[ok] * W + col[ok]
        z = pz[ok]
        c = cls[ok]
        np.maximum.at(dsm, idx, z)
        g = c == 2
        np.add.at(gsum, idx[g], z[g])
        np.add.at(gcnt, idx[g], 1)
        v = (c >= 3) & (c <= 5)
        np.maximum.at(veg, idx[v], z[v])
        b = c == 6
        np.add.at(bld, idx[b], 1)

    done = 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(fetch_node, k): k for k, _ in nodes}
        for f in as_completed(futures):
            accumulate(f.result())
            done += 1
            if done % 50 == 0 or done == len(nodes):
                print(f"  {done}/{len(nodes)} nodes", flush=True)

    dsm = dsm.reshape(H, W)
    veg = veg.reshape(H, W)
    gcnt = gcnt.reshape(H, W)
    ground = np.where(gcnt > 0, gsum.reshape(H, W) / np.maximum(gcnt, 1), np.nan).astype(np.float32)

    # Fill ground under buildings and canopy from the nearest observed ground, then smooth.
    missing = np.isnan(ground)
    _, (ri, ci) = ndimage.distance_transform_edt(missing, return_indices=True)
    dtm = ground[ri, ci]
    dtm = ndimage.uniform_filter(dtm, size=9).astype(np.float32)

    dsm[~np.isfinite(dsm)] = np.nan
    veg[~np.isfinite(veg)] = np.nan

    out = RAW / "lidar.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out,
        dsm=dsm,
        dtm=dtm,
        veg=veg,
        bld=bld.reshape(H, W).astype(np.uint16),
        origin=np.array([x0, y1]),
        res=np.array(res),
    )
    print(f"wrote {out}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
