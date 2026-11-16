"""Build full-map context images for the Nano Banana campus pass.

  data/ai/layout.png  massing render (true footprints/heights/roofs/trees, blank walls) over a softened ground
  data/ai/aerial.png  2024 NAIP aerial photo warped onto the map's ground plane with the map camera
  data/ai/mask.png    where the map is (ground diamond, its soil edge and anything standing on it)
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from stanford_pixxel.build_scene import Grid  # noqa: E402
from stanford_pixxel.geo import Camera  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
OUT = ROOT / "data" / "ai"


def vips(*a):
    subprocess.run(["vips", *map(str, a)], check=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    scene = json.loads((ROOT / "data" / "build" / "scene.json").read_text())
    c = scene["camera"]
    cam = Camera()
    cam.ox, cam.oy, cam.width, cam.height = c["ox"], c["oy"], c["width"], c["height"]
    W, H = cam.width, cam.height

    # Massing layout.
    m = json.loads((ROOT / "render" / "out" / "massing" / "manifest.json").read_text())
    tiles = ROOT / "render" / "out" / "massing"
    names = []
    for ty in range(m["rows"]):
        for tx in range(m["cols"]):
            w = min(m["tile"], m["width"] - tx * m["tile"])
            h = min(m["tile"], m["height"] - ty * m["tile"])
            o = tiles / f"c_{tx}_{ty}.v"
            vips("crop", tiles / f"{tx}_{ty}.png", o, m["margin"], m["margin"], w, h)
            names.append(str(o))
    vips("arrayjoin", " ".join(names), OUT / "massing.v", "--across", m["cols"])
    ground = Image.open(ROOT / "data" / "build" / "ground.png").convert("RGB")
    ground = ImageEnhance.Color(ground).enhance(0.55)
    ground = ImageEnhance.Brightness(ground).enhance(1.06).filter(ImageFilter.GaussianBlur(0.6))
    ground.save(OUT / "ground_soft.png", compress_level=1)
    vips("composite2", OUT / "ground_soft.png", OUT / "massing.v", OUT / "layout.png", "over")

    # Aerial photo on the ground plane (same affine the ground painter uses).
    grid = Grid()
    a, b, cc, d, tx, ty = cam.affine_ground()
    Mi = np.linalg.inv(np.array([[a, b], [cc, d]]))
    A = np.array([[1 / grid.res, 0], [0, -1 / grid.res]]) @ Mi
    off = np.array([-grid.x0 / grid.res, grid.y1 / grid.res]) - A @ np.array([tx, ty])
    photo = Image.fromarray(np.moveaxis(grid.naip[:3], 0, -1))
    aerial = photo.transform((W, H), Image.AFFINE, (A[0, 0], A[0, 1], off[0], A[1, 0], A[1, 1], off[1]), resample=Image.BILINEAR)
    region = [cam.screen(x, y) for x, y in scene["region"]]
    mask_ground = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask_ground).polygon(region, fill=255)
    bg = Image.new("RGB", (W, H), (239, 231, 214))
    bg.paste(aerial, (0, 0), mask_ground)
    bg.save(OUT / "aerial.png", compress_level=1)

    # Map mask: anything that differs from the flat background colour.
    final = np.asarray(Image.open(ROOT / "data" / "build" / "final.png").convert("RGB")).astype(np.int16)
    diff = np.abs(final - np.array([239, 231, 214])).sum(-1) > 12
    Image.fromarray((diff * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).save(OUT / "mask.png")
    print("prepared", W, H)


if __name__ == "__main__":
    main()
