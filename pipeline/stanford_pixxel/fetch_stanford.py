"""Download official names from Stanford LBRE Maps & Records' public Map Maker service.

The service withholds geometry, so each feature's location comes from its extent
(returnExtentOnly). Footprints themselves come from OpenStreetMap; these extents
only attach official names and building IDs to them.
"""

import json
from concurrent.futures import ThreadPoolExecutor

import requests

from .config import RAW, USER_AGENT

SERVICE = "https://lbre-apps.stanford.edu/arcgis/rest/services/public/Map_Maker_Layers/MapServer"
LAYERS = {"buildings": 24, "libraries": 8, "eateries": 9}

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


def query(layer_id: int, **params):
    r = session.get(f"{SERVICE}/{layer_id}/query", params={"f": "json", **params}, timeout=60)
    r.raise_for_status()
    return r.json()


def attributes(layer_id: int):
    rows, offset = [], 0
    while True:
        batch = query(layer_id, where="1=1", outFields="*", returnGeometry="false",
                      resultOffset=offset, resultRecordCount=1000)["features"]
        rows.extend(f["attributes"] for f in batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


def extent(layer_id: int, oid: int):
    for attempt in range(4):
        try:
            e = query(layer_id, objectIds=oid, returnExtentOnly="true", outSR=4326).get("extent")
            if not e or e.get("xmin") is None:
                return None
            return [e["xmin"], e["ymin"], e["xmax"], e["ymax"]]
        except requests.RequestException:
            if attempt == 3:
                raise


def main():
    out_dir = RAW / "stanford"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, layer_id in LAYERS.items():
        rows = attributes(layer_id)
        with ThreadPoolExecutor(max_workers=8) as pool:
            extents = list(pool.map(lambda r: extent(layer_id, r["OBJECTID"]), rows))
        for r, e in zip(rows, extents):
            r["extent"] = e
        (out_dir / f"{name}.json").write_text(json.dumps(rows, indent=1))
        print(f"{name}: {len(rows)} rows, {sum(e is not None for e in extents)} located")


if __name__ == "__main__":
    main()
