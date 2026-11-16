import shutil
import sys
import time
from pathlib import Path

from gradio_client import Client, handle_file

import os
STEPS = int(os.environ.get("STEPS", "12"))
SIZE = int(os.environ.get("SIZE", "768"))
OUT = Path("/tmp/gen/out")
OUT.mkdir(exist_ok=True)

STYLE = (
    "Redraw this image as classic isometric pixel art in the style of SimCity 2000 and RollerCoaster Tycoon: "
    "crisp hard-edged square pixels, a limited warm palette, clean dark one-pixel outlines on buildings, flat shading "
    "with one lit side and one shadow side, terracotta tile roofs drawn as neat pixel rows, sandstone walls with small "
    "dark windows, pixel-art trees with round dithered crowns, flat green lawns and grey roads. "
    "FIDELITY COMES FIRST: keep every building, road, path, lawn and tree in exactly the same position, shape and size, "
    "seen from the same camera. Add nothing that is not in the image and remove nothing. No text, no people, no cars."
)


def save(res, name):
    if isinstance(res, (list, tuple)):
        res = res[0]
    if isinstance(res, list):
        res = res[0]
    if isinstance(res, dict):
        res = res.get("image", res)
        res = res.get("path", res) if isinstance(res, dict) else res
    dst = OUT / name
    shutil.copy(res, dst)
    return dst


def run(model, tile, extra=None, name=None):
    src = f"/tmp/gen/in/{tile}.png"
    t0 = time.time()
    try:
        if model == "qwen2511":
            c = Client("Qwen/Qwen-Image-Edit-2511", verbose=False)
            imgs = [{"image": handle_file(src), "caption": None}]
            if extra:
                imgs.append({"image": handle_file(extra), "caption": None})
            res = c.predict(imgs, STYLE if not extra else STYLE + " Use the second image only as a reference for the real building's materials, colours, arches and windows; never copy its camera angle.",
                            0, True, 4.0, STEPS, SIZE, SIZE, False, api_name="/infer")
        elif model == "qwenfast":
            c = Client("multimodalart/Qwen-Image-Edit-Fast", verbose=False)
            res = c.predict(handle_file(src), STYLE, 0, True, 1.0, 8, False, api_name="/infer")
        elif model == "kontext":
            c = Client("black-forest-labs/FLUX.1-Kontext-Dev", verbose=False)
            res = c.predict(handle_file(src), STYLE, 0, True, 2.5, 28, api_name="/infer")
        elif model == "qwenimage":
            c = Client("Qwen/Qwen-Image", verbose=False)
            prompt = (
                "Isometric pixel art in the style of SimCity 2000 of Stanford University's Main Quad: a long rectangular "
                "quadrangle of sandstone buildings with red clay tile roofs and arcades around a palm-dotted courtyard, "
                "Memorial Church with a gabled facade at the back, Hoover Tower, a tall slim sandstone tower with a red dome, "
                "in the foreground, oak trees, lawns and paths. Crisp pixels, limited palette, no text."
            )
            res = c.predict(prompt, 0, True, "1:1", 4.0, 40, False, api_name="/infer")
        else:
            raise ValueError(model)
        dst = save(res, name or f"{model}_{tile}.png")
        print(f"OK {model} {tile} {time.time() - t0:.0f}s -> {dst}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {model} {tile} {time.time() - t0:.0f}s: {str(e)[:300]}", flush=True)


if __name__ == "__main__":
    run(*sys.argv[1:4] if len(sys.argv) > 3 else sys.argv[1:3])


def run2509(tile, extra=None, name=None, steps=20):
    from gradio_client import Client, handle_file
    t0 = time.time()
    try:
        c = Client("Qwen/Qwen-Image-Edit-2509", verbose=False)
        imgs = [{"image": handle_file(f"/tmp/gen/in/{tile}.png"), "caption": None}]
        prompt = STYLE
        if extra:
            imgs.append({"image": handle_file(extra), "caption": None})
            prompt += " Use the second image only as a reference for the real building's materials, colours, arches and windows; never copy its camera angle."
        res = c.predict(imgs, prompt, 0, True, 4.0, steps, 1024, 1024, False, api_name="/infer")
        dst = save(res, name or f"q2509_{tile}.png")
        print(f"OK q2509 {tile} {time.time() - t0:.0f}s -> {dst}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL q2509 {tile} {time.time() - t0:.0f}s: {str(e)[:300]}", flush=True)


def run_orig(tile, steps=30):
    from gradio_client import Client, handle_file
    t0 = time.time()
    try:
        c = Client("Qwen/Qwen-Image-Edit", verbose=False)
        res = c.predict(handle_file(f"/tmp/gen/in/{tile}.png"), STYLE, 0, True, 4.0, steps, False, api_name="/infer")
        dst = save(res, f"qorig_{tile}.png")
        print(f"OK qorig {tile} {time.time() - t0:.0f}s -> {dst}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL qorig {tile} {time.time() - t0:.0f}s: {str(e)[:300]}", flush=True)


def run_fast(tile, extra=None, name=None, steps=4, prompt=None):
    from gradio_client import Client, handle_file
    t0 = time.time()
    try:
        c = Client("linoyts/Qwen-Image-Edit-2511-Fast", verbose=False)
        imgs = [{"image": handle_file(tile if tile.startswith("/") else f"/tmp/gen/in/{tile}.png"), "caption": None}]
        p = prompt or STYLE
        if extra:
            imgs.append({"image": handle_file(extra), "caption": None})
            p += " Image 2 is a photo of the real building: use it only for materials, colours, arches, mosaics and windows on the matching building in image 1; keep the camera, layout and every shape of image 1."
        res = c.predict(imgs, p, 0, True, 1.0, steps, 1024, 1024, False, api_name="/infer")
        dst = save(res, name or f"fast_{Path(tile).stem}.png")
        print(f"OK fast {tile} {time.time() - t0:.0f}s -> {dst}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL fast {tile} {time.time() - t0:.0f}s: {str(e)[:300]}", flush=True)
