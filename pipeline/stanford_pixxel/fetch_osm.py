"""Download OpenStreetMap features for the campus bbox from the Overpass API."""

import json
import time

import requests

from .config import BBOX, RAW, USER_AGENT

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def query() -> str:
    b = f'{BBOX["south"]},{BBOX["west"]},{BBOX["north"]},{BBOX["east"]}'
    return f"""
[out:json][timeout:180];
(
  way["building"]({b});
  relation["building"]({b});
  way["building:part"]({b});
  relation["building:part"]({b});
  way["highway"]({b});
  way["railway"]({b});
  way["landuse"]({b});
  relation["landuse"]({b});
  way["leisure"]({b});
  relation["leisure"]({b});
  way["natural"]({b});
  relation["natural"]({b});
  node["natural"="tree"]({b});
  way["amenity"]({b});
  relation["amenity"]({b});
  way["waterway"]({b});
  way["water"]({b});
  way["man_made"]({b});
  way["barrier"="wall"]({b});
  node["name"]({b});
);
out geom qt;
"""


def main():
    q = query()
    last = None
    for attempt in range(4):
        for url in MIRRORS:
            try:
                r = requests.post(url, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=240)
                r.raise_for_status()
                data = r.json()
                out = RAW / "osm.json"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(data))
                print(f"wrote {out}: {len(data['elements'])} elements from {url}")
                return
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"{url} failed: {e}")
        time.sleep(4 * 2**attempt)
    raise SystemExit(f"Overpass failed: {last}")


if __name__ == "__main__":
    main()
