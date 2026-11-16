# Pixel Stanford

A giant isometric map of Stanford's campus in the style of SimCity 2000, built entirely from open data, and it moves.
Pan and zoom across ~2,400 building masses and ~57,000 trees, search any dorm, hall, library or café, take the
32-stop tour, and watch students walk between classes, bikes rush at the top and bottom of the hour, cars circle Campus
Drive and Marguerite shuttles run their published timetable.

The map is a plain render drawn by code that is truthful from above (real heights, roof shapes, roof and ground
colours). It is also the input for the planned AI-illustrated layer (see [Next: the AI layer](#next-the-ai-layer)).

## Run the app

```bash
npm install
npm run dev          # http://localhost:4317
```

The rendered map (`public/tiles/`), labels, tour, street network, shuttle schedule and sprites are committed, so the
app runs without the data pipeline.

### Using it

| Key | Action |
| --- | --- |
| `/` | Search dorms, halls, cafés and streets |
| `P` | Places: the tour and the browse list |
| `N` | Place and street names on or off |
| `T` | People and traffic on or off |
| `F` | Full screen |
| `H` | Hide tools (focus mode) |
| `+` `−` `0` | Zoom in, out, whole campus |
| `←` `→` | Previous / next tour stop |

Links are shareable: `#hoover-tower` opens a place, `#@x,y,zoom` an exact view, and `?time=class-change` (or
`morning`, `lunch`, `evening`, `night`) replays a weekday at that time instead of showing live Pacific time.

## How the map is made

| Step | Source | What it gives us |
| --- | --- | --- |
| Footprints, roads, paths, fields | [OpenStreetMap](https://www.openstreetmap.org) via Overpass | Building outlines (including hand-modelled parts such as Hoover Tower), the street, bike and footpath network, parking lots, pitches |
| Heights, roof shapes, trees | [USGS 3DEP lidar](https://www.usgs.gov/3d-elevation-program), `CA_SantaClaraCounty_2020` (public EPT on AWS) | Roof height and pitch for every building, height regions inside merged footprints, individual tree tops and crowns |
| Colours | [USDA NAIP](https://naip-usdaonline.hub.arcgis.com/) 2024, 0.6 m RGB + near-infrared (Microsoft Planetary Computer) | Real roof and ground colours, water vs. dry lakebed, tree colours |
| Official names | Stanford LBRE Maps & Records public Map Maker service | Official building names and IDs, dorm complexes, libraries, eateries |
| Shuttles | Stanford Transportation's public [Marguerite GTFS feed](https://transportation-forms.stanford.edu/google/google_transit.zip) | Routes, stops and timetables |

Pipeline (`pipeline/stanford_pixxel/`):

1. `fetch_*` download each source for a rectangle aligned to the campus street grid (14.4° off north).
2. `build_scene.py` fuses them:
   - roofs are classified from lidar slope; pitched roofs become hipped roofs with eave height and pitch measured from
     the point cloud; flat roofs take the 85th-percentile height;
   - footprints OpenStreetMap maps as one building (the Main Quad, the hospital) are split by clustering lidar roof
     heights, so arcades, wings and Memorial Church get their own masses; stadiums get seating bowls;
   - hand-modelled OSM parts (heights, roof shapes, domes) override lidar;
   - trees are local maxima of the lidar canopy height model, grouped into broadleaf, oak, eucalyptus, conifer and palm,
     and coloured from the aerial photo;
   - open ground and rooftops show the posterised aerial photo; ground hidden under canopy and roofs falls back to a
     landcover palette; OSM water is drawn only where the photo shows water (so Lake Lag is drawn as it was in 2024);
   - every label, outline and coordinate is projected with the same orthographic camera.
3. `network.py` exports the street, bike and footpath graph, parking stalls and Marguerite trips in map pixels.
4. `render/` renders buildings and trees in headless Chrome with three.js (`capture.mjs`), and the live-layer sprite
   atlas from tiny 3D models through the same camera (`sprites.mjs`). Hipped roofs come from CGAL's straight skeleton
   (`straight-skeleton`, WebAssembly); windows and roof tiles are procedural; outlines come from depth edges.
5. `compose.py` composites objects over the ground, cuts a versioned Deep Zoom pyramid with libvips, writes the
   occlusion mask the live layer uses to hide agents behind buildings and trees, and cuts tour thumbnails.

The viewer is Next.js + OpenSeadragon + shadcn/ui. The live layer (`src/lib/live/`) simulates agents on the network
with typed arrays, draws them on a canvas synced to the map, and only re-renders React when the set of visible labels
changes.

### Rebuilding the map

Requirements: Node 20+, [uv](https://docs.astral.sh/uv/), libvips (`apt install libvips-tools`), Google Chrome or
Chromium (set `CHROME_PATH` if it is not at `/usr/local/bin/google-chrome`).

```bash
npm run map:fetch    # ~5 min: OSM, Stanford names, 90M lidar points, NAIP imagery, GTFS -> data/raw/
npm run map:build    # ~4 min: scene, network, render, sprites, Deep Zoom tiles -> public/
```

Tweak the region, camera angle or scale in `pipeline/stanford_pixxel/config.py`, tour stops in
`pipeline/stanford_pixxel/tour.py`, and crowd sizes by time of day in `src/lib/live/clock.ts`.

## Next: the AI layer

Nano Banana 2.1 has already painted the campus (`public/tiles/*-ai/`, toggle with `L`). The original plan was
never to keep calling Gemini: those tiles are **style targets** for a Qwen-Image-Edit-2511 LoRA.

1. Cut paired 1024 px crops: `data/build/final.png` (control) → Nano Banana `data/ai/ai_final.png` (target).
2. Train the LoRA on Sherlock with musubi-tuner (`experiments/qwen-lora/`).
3. Generate the whole campus in overlapping windows (and average the overlap, so there are no seams).
4. Keep the Nano Banana landmark tiles (Hoover, Memorial Church, the Quad) as the high-quality layer.

## Credits

© OpenStreetMap contributors (ODbL) · USGS 3DEP lidar · USDA NAIP imagery · Stanford LBRE Maps & Records ·
Stanford Transportation (Marguerite GTFS). Not affiliated with Stanford University.
