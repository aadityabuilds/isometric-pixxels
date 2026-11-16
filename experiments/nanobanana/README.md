# Nano Banana test: Main Quad, Memorial Church and Hoover Tower

One 1024 px cluster of the map, redrawn by Gemini image models from:

1. a clean massing layout (`node render/capture.mjs --window 4910,1760,1024,1024 --massing` over a desaturated ground):
   true footprints, heights, roofs and trees, with blank walls, so the model gets geometry but not our wrong facades;
2. three style references cut from Pixel Chennai's landmark thumbnails (Ripon Building, Fort St. George, Parthasarathy
   Temple), used only as a style reference for this test;
3. three public-domain / CC BY-SA photos from Wikimedia Commons: the Main Quad from Hoover Tower, Memorial Church's
   front and Hoover Tower.

Prompts follow Google's guide: explicit image roles, step-by-step instructions, hyper-specific architecture, and
positive phrasing for what to leave out ("a quiet, empty campus").

| Run | Model | Cost |
| --- | --- | --- |
| `prompt1.txt` | `gemini-3-pro-image` (Nano Banana Pro), 2K | $0.15 |
| `prompt2.txt` (+ pixel-art finish, clean ground) | `gemini-3-pro-image`, 2K | $0.15 |
| `prompt2.txt` | `gemini-nano-banana-2.1`, 2K | $0.06 |

`nb.py` reads `GEMINI_API_KEY` from the environment and appends every call's cost to `ledger.jsonl`.
