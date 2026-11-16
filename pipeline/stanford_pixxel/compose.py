"""Stitch rendered object tiles, composite them over the ground layer and cut a Deep Zoom pyramid.

Also writes, next to the tiles:
  public/data/occlusion.bin.gz  where buildings and trees cover the ground (half resolution, 1 bit per pixel),
                                so moving agents can hide behind them
  public/places/<id>.webp       thumbnails for the curated tour, and public/data/tour.json
"""

import gzip
import json
import shutil
import subprocess
import time

import numpy as np
from PIL import Image

from .config import BUILD, PUBLIC, ROOT
from .tour import TOUR

Image.MAX_IMAGE_PIXELS = None
TILES = ROOT / "render" / "out" / "tiles"
OCCLUSION_SCALE = 2


def vips(*args):
    subprocess.run(["vips", *map(str, args)], check=True)


def write_occlusion(objects, meta):
    alpha = BUILD / "alpha_small.png"
    vips("extract_band", objects, BUILD / "alpha.v", 3)
    vips("shrink", BUILD / "alpha.v", alpha, OCCLUSION_SCALE, OCCLUSION_SCALE)
    a = np.asarray(Image.open(alpha).convert("L")) > 100
    h, w = a.shape
    (PUBLIC / "data" / "occlusion.bin.gz").write_bytes(gzip.compress(np.packbits(a, axis=None).tobytes(), 9))
    meta["occlusion"] = {"w": w, "h": h, "scale": OCCLUSION_SCALE, "url": "/data/occlusion.bin.gz"}


def write_tour(final, meta):
    places = meta["places"]
    by_name = {}
    for p in places:
        by_name.setdefault(p["name"], p)
    out_dir = PUBLIC / "places"
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    W, H = meta["camera"]["width"], meta["camera"]["height"]
    tour = []
    for name, title, blurb in TOUR:
        p = by_name.get(name)
        if not p:
            print(f"tour: no place named {name!r}")
            continue
        cw, ch = 560, 350
        left = int(min(max(p["x"] - cw / 2, 0), W - cw))
        top = int(min(max(p["y"] + 40 - ch / 2, 0), H - ch))
        vips("crop", final, out_dir / f"{p['id']}.webp[Q=82]", left, top, cw, ch)
        tour.append({"id": p["id"], "title": title, "blurb": blurb, "image": f"/places/{p['id']}.webp"})
    (PUBLIC / "data" / "tour.json").write_text(json.dumps(tour, indent=1, ensure_ascii=False))
    print(f"tour: {len(tour)} stops")


def main():
    m = json.loads((TILES / "manifest.json").read_text())
    crop_dir = TILES / "cropped"
    crop_dir.mkdir(exist_ok=True)
    names = []
    for ty in range(m["rows"]):
        for tx in range(m["cols"]):
            w = min(m["tile"], m["width"] - tx * m["tile"])
            h = min(m["tile"], m["height"] - ty * m["tile"])
            out = crop_dir / f"{tx}_{ty}.v"
            vips("crop", TILES / f"{tx}_{ty}.png", out, m["margin"], m["margin"], w, h)
            names.append(str(out))
    objects = BUILD / "objects.v"
    vips("arrayjoin", " ".join(names), objects, "--across", m["cols"])
    final = BUILD / "final.png"
    vips("composite2", BUILD / "ground.png", objects, final, "over")

    # Each build gets its own folder so tiles can be cached forever.
    version = format(int(time.time()), "x")
    root = PUBLIC / "tiles"
    shutil.rmtree(root, ignore_errors=True)
    (root / version).mkdir(parents=True)
    vips("dzsave", final, root / version / "campus", "--suffix", ".webp[Q=86]", "--tile-size", 510, "--overlap", 1)
    vips("thumbnail", final, PUBLIC / "preview.jpg", 2400)
    vips("thumbnail", final, PUBLIC / "og.jpg", 1200)

    meta_path = PUBLIC / "data" / "places.json"
    meta = json.loads(meta_path.read_text())
    meta["tiles"] = f"/tiles/{version}/campus.dzi"
    write_occlusion(objects, meta)
    write_tour(final, meta)
    meta_path.write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {meta['tiles']}")


if __name__ == "__main__":
    main()
