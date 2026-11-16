"""Stitch rendered object tiles, composite them over the ground layer and cut a Deep Zoom pyramid."""

import json
import shutil
import subprocess

from .config import BUILD, PUBLIC, ROOT

TILES = ROOT / "render" / "out" / "tiles"


def vips(*args):
    subprocess.run(["vips", *map(str, args)], check=True)


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

    dz = PUBLIC / "tiles"
    shutil.rmtree(dz, ignore_errors=True)
    dz.mkdir(parents=True)
    vips("dzsave", final, dz / "campus", "--suffix", ".webp[Q=88]", "--tile-size", 510, "--overlap", 1)
    vips("thumbnail", final, PUBLIC / "preview.jpg", 2400)
    vips("thumbnail", final, PUBLIC / "og.jpg", 1200)
    print(f"wrote {dz / 'campus.dzi'}")


if __name__ == "__main__":
    main()
