# Pixel Stanford — agent handoff

Isometric SimCity-style map of Stanford campus, from open data, with a live people/traffic layer and a Nano Banana illustrated overlay. The remaining job is to **fine-tune Qwen-Image-Edit-2511 on those Nano Banana tiles** and regenerate the campus locally on Sherlock so we stop paying Gemini.

GitHub (source of truth as of 17 Nov 2026): https://github.com/aadityabuilds/isometric-pixxels

Owner: Aaditya Nalawade (`aadityabuilds` on GitHub and Hugging Face, `aaditya1@stanford.edu`). Hugging Face account is **free** (no Jobs). Training target is **Stanford Sherlock**, not this laptop and not HF Jobs.

This file is the handoff for the next agent. Read it before changing anything.

---

## Current state (one paragraph)

The app is a working Next.js viewer. You can pan/zoom a truthful-from-above isometric render of campus, search 845 named places, run a 32-stop tour, and watch students/bikes/cars/Marguerite shuttles on a live layer. Press **L** to toggle a second Deep Zoom pyramid: the same camera, redrawn tile-by-tile by Gemini Nano Banana 2.1 (~50 tiles, ~$4.07 including tests and west-campus fixes). Those tiles are **style targets**, not the end product. Training pairs (175 overlapping 1024×1024 crops: plain render → Nano Banana) are prepared. Training has **not** been run. There is no GPU on the machine that built this. Sherlock is the plan.

---

## How to run the app

```bash
git clone https://github.com/aadityabuilds/isometric-pixxels.git
cd isometric-pixxels
npm install
npm run dev          # http://localhost:4317
```

Rendered tiles, labels, tour, street network, shuttle GTFS-derived trips and sprites are committed, so the viewer runs with `npm install && npm run dev`. Nano Banana composites, LoRA pairs, and `data/build/final.png` are also in the repo. You do **not** need to re-run Gemini to train. Lidar/NAIP/OSM fetches (`data/raw/`) are still gitignored (~700 MB); re-run `npm run map:fetch` only if you need to rebuild the plain map from scratch.

| Key | Action |
| --- | --- |
| `/` | Search dorms, halls, cafés, streets |
| `P` | Places panel (tour + browse) |
| `N` | Names on/off |
| `L` | AI illustration vs plain render |
| `T` | People and traffic on/off |
| `F` | Full screen |
| `H` | Hide chrome |
| `+` `−` `0` | Zoom in, out, whole campus |
| `←` `→` | Tour prev/next |
| `?` | About |

Shareable hashes: `#hoover-tower`, `#@x,y,zoom`. Query `?time=class-change` (or `morning`, `lunch`, `evening`, `night`) replays a weekday instead of live Pacific time.

Stack: Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + OpenSeadragon. Dev server is **port 4317** on purpose.

---

## Repo map

```
src/                         Next.js viewer
  app/page.tsx               loads tiles + tilesAi from public/data/places.json
  components/campus-app.tsx  chrome, keyboard, AI/plain toggle
  components/map/            OpenSeadragon + labels + live canvas
  lib/live/                  agent sim (typed arrays, Pacific clock, class-change pulses)
pipeline/stanford_pixxel/    open-data → scene → network → compose DZI
render/                      three.js headless Chrome capture + sprite atlas
public/tiles/6afa80bc/       plain-render Deep Zoom (committed)
public/tiles/6afb855b-ai/    Nano Banana Deep Zoom (committed)
public/data/places.json      845 places, camera, tiles, tilesAi, occlusion path
experiments/style-test/      FLUX Kontext / schnell / Qwen Spaces tests (done)
experiments/nanobanana/      Gemini campus redraw + west/Row seam fixes
experiments/qwen-lora/       musubi-tuner dataset + Sherlock train/infer scripts
data/                        GITIGNORED. See "Critical: data is not on GitHub"
```

`places.json` currently points at:

- `tiles`: `/tiles/6afa80bc/campus.dzi`
- `tilesAi`: `/tiles/6afb855b-ai/campus.dzi`

Canvas size: **10607 × 5660** px. Camera: orthographic, bearing **239.4°**, elevation **30°**, **3 px/m**, 2:1 isometric, aligned 45° off the campus grid (grid bearing 14.4°). Defined in `pipeline/stanford_pixxel/config.py`. Do not change the camera if you want existing Nano Banana tiles to still register.

---

## What has been done

### 1. Open-data isometric map (the “plain render”)

Sources, all public:

| Source | Use |
| --- | --- |
| OSM via Overpass | footprints, roads, paths, parking, pitches. Hand-modelled OSM parts (Hoover height/dome) override lidar |
| USGS 3DEP lidar `CA_SantaClaraCounty_2020` | roof height, pitch, height-partitioned masses inside merged footprints (Quad arcades, Memorial Church, hospital wings, stadium bowl), ~57k tree crowns |
| USDA NAIP 2024 0.6 m RGB+NIR | roof and ground colour, water vs dry lakebed |
| Stanford LBRE Map Maker | official names / building IDs |
| Marguerite GTFS | shuttle routes, stops, timetable |

Pipeline:

1. `npm run map:fetch` → `data/raw/`
2. `build_scene.py` fuses geometry + colour
3. `network.py` exports graph, parking stalls, shuttle trips in map pixels
4. `render/capture.mjs` draws buildings/trees in headless Chrome (three.js). Hipped roofs via CGAL `straight-skeleton` WASM. Outlines from depth edges.
5. `compose.py` composites over ground, cuts Deep Zoom with libvips, writes occlusion mask, tour thumbs.

Rebuild (needs Node 20+, uv, libvips, Chrome/Chromium):

```bash
npm run map:fetch    # ~5 min
npm run map:build    # ~4 min
```

The plain render is **truthful from above** (real footprints, heights, roof shapes, NAIP colours). Facades are procedural placeholders. That is why it is the **control image** for the edit model: geometry is right, style is not.

Live layer (`src/lib/live/`): students walk between classes, bikes peak at hour/half-hour, cars on Campus Drive, Marguerite on GTFS. Occlusion mask hides agents behind buildings/trees. Crowd sizes by time of day live in `src/lib/live/clock.ts`.

### 2. Style tests (open models, no training yet)

`experiments/style-test/`

| Model | Result |
| --- | --- |
| FLUX.1 Kontext [dev] (HF Space, anonymous) | Keeps layout, game-art look, ~30 s/tile. Non-commercial licence. |
| FLUX.1 schnell (text only) | Pretty, invents a different campus. Useless as a map. |
| Qwen-Image-Edit-2511 on public Spaces | Refused for anonymous users (GPU quota). Needs HF token or Sherlock. |
| Qwen-Image-Edit-2511 + Lightning + Wikimedia photo of Memorial Church | Layout kept; photo refs actually pull real facades on tight crops. This is why Qwen-Image-**Edit** (not text-to-image) is the training target. |

Comparison sheets are committed under `experiments/style-test/`.

### 3. Nano Banana campus illustration (the “teacher”)

`experiments/nanobanana/`

Goal was never “Gemini forever.” Goal was a few dozen high-quality tiles to **teach a LoRA**.

Per 1024 tile, Gemini saw:

1. Massing layout (true geometry, blank walls), with already-finished neighbours pasted into the 128 px overlap
2. 2024 NAIP aerial warped onto the same ground plane (follow Image 1 for position, Image 2 for colour)
3. Approved Main Quad Nano Banana Pro tile as style anchor + one Pixel Chennai crop (style only, not architecture)
4. Up to three Wikimedia photos near the tile
5. Named buildings in the tile

Grid: 1024 tiles, step 896 (128 px overlap). Model: **`gemini-nano-banana-2.1`**. Scripts:

- `nb.py` — Gemini calls, costs to `ledger.jsonl`. Needs `GEMINI_API_KEY`.
- `campus.py` — full campus pass, budget flag, `--redo x,y`
- `campus_prep.py` — inputs
- `publish_layer.py` — `vips dzsave` of `data/ai/ai_final.png` → `public/tiles/<hex>-ai/`, writes `tilesAi` into `places.json`
- `fix_west.py` — **failed** (Pro model drifted camera, cartoon labels). Reverted.
- `fix_west2.py` — 2K plates with 2.1 + strict layout. Lake + FloMo/Row geography.
- `fix_row_seam.py` — Pearce Mitchell / The Row were split across two disagreeing tiles at x≈3300. Regenerated one 2048 plate at `(2280, 1570)` so the condo cluster is uncut, feathered into `ai_final.png`, recut DZI.

Spend: **64 Gemini calls, $4.07** (61× 2.1, 3× Pro). Ledger: `experiments/nanobanana/ledger.jsonl`.

User-visible bugs that were already fixed, do not reintroduce:

- Lake Lagunita is a **dry seasonal oval** (2024 NAIP), not a water body and not a golf course. Roble / Lagunita Court / FloMo / Governor's Corner sit **outside** the trail ring.
- West campus (FloMo, The Row) had wrong geography; redrawn as two coherent 2K plates.
- Visible double-building seam on Pearce Mitchell / The Row from overlapping 1024 tiles that did not agree. Fixed by one uncut 2048 plate.

Known remaining AI-layer flaws (expected; this is why we train Qwen instead of generating more Gemini tiles):

- Tile-to-tile style drift and leftover seams away from the Row fix
- Invented rooftop clutter, windows, sometimes lettering
- Facades are not survey-accurate unless a Wikimedia photo was in-context
- Lake still looks a bit cartoon/flat compared to the Quad

### 4. Qwen-Image-Edit-2511 LoRA dataset (ready, not trained)

`experiments/qwen-lora/`

Same recipe as Pixel Chennai and Isometric NYC: **control = plain render, target = Nano Banana, train a small LoRA on Qwen-Image-Edit-2511, generate the rest locally.**

```bash
pipeline/.venv/bin/python experiments/qwen-lora/build_dataset.py
```

Writes `data/ai/lora_pairs/{control,target}/` (**tracked in git**, 175 pairs). 1024×1024, step 512 over the finished maps, plus the exact Nano Banana tiles first. Crops with <28% coverage of the map mask are skipped. Same caption on every pair:

> Redraw this isometric Stanford campus render as SimCity 2000 pixel art. Keep the camera, every building footprint, road, path, lawn and tree exactly in place. Buff sandstone or cream stucco, red clay tile roofs, crisp pixel outlines, empty campus. No people, no cars, no signs, no lettering.

Preview sheet (committed): `experiments/qwen-lora/pairs_preview.jpg`.

**175 is not 175 unique scenes.** It is a sliding window over ~50 Nano Banana tiles. Unique geography is one campus. Style LoRAs saturate fast: Isometric NYC used ~40 pairs for five boroughs. Extra overlapping crops mostly teach the teacher’s habits, including its mistakes. Do not expect “more pairs ⇒ much better map.” The real advantage over Pixel Chennai is the **control** (lidar roofs, real trees, NAIP), not pair count.

Training scripts (not yet executed):

- `dataset.toml` — musubi-tuner; paths filled by the train script
- `train_sherlock.sh` — cache latents + text encoder, then `qwen_image_train_network.py` with `--model_version edit-2511`, LoRA rank 16, 16 epochs, adamw8bit, lr 5e-5, fp8, flow shift 2.2
- `sherlock.sbatch` — Slurm: 1× L40S (or H100), 8 h, 64 GB RAM. Weights in `$SCRATCH/qwen-edit-2511`, output `$SCRATCH/pixel-stanford-lora`
- `generate.py` — Diffusers `QwenImageEditPipeline` + LoRA, one control crop. First sanity check after training: control `04480_01792` (Quad/Hoover) should look like the Nano Banana target without calling Gemini.

Weights to download onto Sherlock (flatten so the three files sit in `$SCRATCH/qwen-edit-2511`):

```
huggingface-cli download Comfy-Org/Qwen-Image-Edit_ComfyUI \
  split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors --local-dir $SCRATCH/qwen-edit-2511
huggingface-cli download Comfy-Org/Qwen-Image-Edit_ComfyUI \
  split_files/vae/qwen_image_vae.safetensors --local-dir $SCRATCH/qwen-edit-2511
huggingface-cli download Comfy-Org/Qwen-Image_ComfyUI \
  split_files/text_encoders/qwen_2.5_vl_7b.safetensors --local-dir $SCRATCH/qwen-edit-2511
```

Plus clone `https://github.com/kohya-ss/musubi-tuner` to `third_party/musubi-tuner` (gitignored if you put it there; sbatch clones it).

At inference, stack the [Lightning 4-step LoRA](https://huggingface.co/lightx2v/Qwen-Image-Lightning) for speed (Chennai did this on a Mac). Then denoise **overlapping 1024 windows of `data/build/final.png` and average the overlap** (tiny.london’s seam trick, not Chennai’s tile-by-tile). Keep Nano Banana Hoover / Memorial Church / Quad as hero patches if Qwen is softer there.

### 5. Git / hosting

- Code lives on GitHub: `aadityabuilds/isometric-pixxels`, branch `main`.
- Cursor Cloud Agent GitHub App **cannot create repos**; the empty GitHub repo was created by hand, then history was pushed.
- A Cursor Cloud publish of the web app was proposed as slug `pixel-stanford` (user confirms in the Publish dialog). Do not invent a preview URL.
- Do not add auth, a database, or a second component library unless asked.

---

## What is and is not in git

| Path | In git? | Why |
| --- | --- | --- |
| `public/tiles/6afa80bc/` | yes | plain-render Deep Zoom (viewer) |
| `public/tiles/6afb855b-ai/` | yes | Nano Banana Deep Zoom (viewer, press L) |
| `data/ai/lora_pairs/` | yes | 175 control/target jpgs + captions — **train with this** |
| `data/ai/ai_final.png` | yes | full Nano Banana composite (~57 MB) |
| `data/ai/ai_final.before_*.png` | yes | backups before lake / west / Row-seam redraws |
| `data/ai/tiles/`, `data/ai/raw/` | yes | per-tile Gemini outputs |
| `data/ai/state.json`, `mask.png` | yes | which tiles exist; coverage mask for `build_dataset.py` |
| `data/build/final.png` | yes | plain-render composite — LoRA **control** at inference |
| `data/build/scene.json` | yes | fused scene used by the renderer |
| `data/raw/` (lidar.npz, naip.npz, osm.json) | **no** | 270 MB + 140 MB, over GitHub’s 100 MB file limit. Re-fetch. |
| `data/build/objects.v`, `data/ai/massing.v` | **no** | 288 MB three.js dumps. Re-render. |

A fresh clone **can train**. Copy `data/ai/lora_pairs` onto Sherlock `$SCRATCH` (home quota is small) and run `sbatch experiments/qwen-lora/sherlock.sbatch`.

Clone the GitHub repo onto Sherlock `$SCRATCH` or `$GROUP_HOME`, not `$HOME`.

---

## What the next agent should do (in order)

### 1. Train the LoRA on Sherlock

Owner can SSH to Sherlock. This Cloud Agent could not: no SSH keys, Stanford Duo on `login.sherlock.stanford.edu`.

```bash
git clone https://github.com/aadityabuilds/isometric-pixxels.git
cd isometric-pixxels
export PAIRS=$SCRATCH/pixel-stanford/lora_pairs
export MODELS=$SCRATCH/qwen-edit-2511
export OUT=$SCRATCH/pixel-stanford-lora
sbatch experiments/qwen-lora/sherlock.sbatch
```

If the L40S queue is long, edit `#SBATCH -C GPU_SKU:H100_SXM5`. Job is ~3–6 h once weights are downloaded. Keep the ~60 GB of base weights in `$SCRATCH`.

Sanity check, on a GPU node:

```bash
python experiments/qwen-lora/generate.py \
  --control $PAIRS/control/04480_01792.jpg \
  --lora $OUT/pixel-stanford-qwen-edit.safetensors \
  --out /tmp/qwen_quad.png
```

Compare `/tmp/qwen_quad.png` to `$PAIRS/target/04480_01792.jpg`. If Hoover/Church/Quad don’t match the teacher, stop and inspect checkpoints (`save_every_n_epochs 2`) rather than generating the whole campus.

### 2. Generate the campus without Gemini

Write a small loop (does not exist yet — `generate.py` is one tile only):

- Slide 1024 windows over `data/build/final.png` with step 512
- Run Qwen-Image-Edit-2511 + our LoRA + Lightning 4-step
- Average overlapping pixels
- Optional: paste original Nano Banana patches for Hoover, Memorial Church, Main Quad
- Save `data/ai/qwen_final.png`
- `python experiments/nanobanana/publish_layer.py` (point it at `qwen_final.png` or copy over `ai_final.png`) so `tilesAi` updates
- Commit new `public/tiles/<new>-ai/` and the `places.json` `tilesAi` field

Do **not** burn more Gemini budget unless a landmark is still wrong after Qwen and the owner asks.

### 3. Only then, polish

- Hunt seams at The Row, Lake Lag, Med School, Stadium
- Mobile layout already exists; don’t restyle the chrome without a reason
- Live layer is independent of the AI tiles; don’t break occlusion (`public/data/occlusion.bin.gz`)

---

## What not to do

- Do not train on a CPU Cloud Agent VM. There is no NVIDIA GPU (`nvidia-smi` fails).
- Do not use Hugging Face Jobs on `aadityabuilds` — not a Pro account.
- Do not call Nano Banana for the whole campus again. Teacher data is enough.
- Do not treat 175 overlapping crops as a huge diverse dataset. Quality of the teacher caps the LoRA.
- Do not change `config.py` camera / region if you still want Nano Banana tiles to align.
- Do not commit `data/raw/` (lidar/NAIP) or API keys. `.env*` is gitignored. Do not add `*.v` render dumps.
- Do not add a second UI library, auth, or a database.
- Pixel Chennai style refs are **drawing technique only**. Do not copy Indian architecture onto Stanford.
- Lake Lagunita is dry grass/sand in the 2024 photo. OSM “water” is filtered by NAIP on purpose.

---

## Comparisons (so you don’t re-research this)

| | Pixel Chennai | Isometric NYC | tiny.london | Us |
| --- | --- | --- | --- | --- |
| Control | OSM extrusions | Google 3D tiles | Google 3D tiles | Lidar + OSM + NAIP |
| Teacher | “a few” Nano Banana tiles | ~40 pairs | thousands of Gemini frames | ~50 Nano Banana tiles → 175 crops |
| Train | Qwen-Image-Edit-2511 LoRA, Mac | Qwen Image-Edit LoRA, ~$12 / 4 h | Qwen-Image-2.1-Turbo LoRA, H100 | Same Edit-2511 LoRA, Sherlock, **not run yet** |
| Seams | Hand-fixed | Masked 512 infill | Overlap + average | Plan: overlap + average |
| Speed LoRA | Lightning 4-step | — | — | Lightning at inference |

We are **not** copying tiny.london’s Gemini-every-frame pipeline.

---

## Secrets / accounts

| Name | Status |
| --- | --- |
| `GEMINI_API_KEY` | Used for Nano Banana. Not in repo. Only needed if you redo a teacher tile. |
| `HF_TOKEN` | Optional. Style tests used public Spaces; Qwen Spaces needed a token. Download of Edit-2511 weights on Sherlock may need `huggingface-cli login`. |
| Sherlock | SUNet `aaditya1`. SSH + Duo from the owner’s machine. This agent never logged in. |

Never paste secrets into chat. Never commit them.

---

## Credits

© OpenStreetMap contributors (ODbL) · USGS 3DEP lidar · USDA NAIP 2024 · Stanford LBRE Maps & Records · Stanford Transportation (Marguerite GTFS). Not affiliated with Stanford University. Inspired by Pixel Chennai, isometric.nyc, and tiny.london.
