"""Cut the Nano Banana map (data/ai/ai_final.png) into its own Deep Zoom pyramid and register it with the viewer."""

import json
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"


def main():
    src = ROOT / "data" / "ai" / "ai_final.png"
    version = format(int(time.time()), "x") + "-ai"
    tiles = PUBLIC / "tiles"
    for old in tiles.glob("*-ai"):
        shutil.rmtree(old)
    (tiles / version).mkdir(parents=True)
    subprocess.run(["vips", "dzsave", src, tiles / version / "campus", "--suffix", ".webp[Q=86]", "--tile-size", "510", "--overlap", "1"], check=True)
    subprocess.run(["vips", "thumbnail", src, PUBLIC / "preview-ai.jpg", "2400"], check=True)
    meta_path = PUBLIC / "data" / "places.json"
    meta = json.loads(meta_path.read_text())
    meta["tilesAi"] = f"/tiles/{version}/campus.dzi"
    meta_path.write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False))
    print("registered", meta["tilesAi"])


if __name__ == "__main__":
    main()
