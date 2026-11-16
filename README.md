# Pixel Stanford

A giant isometric map of Stanford's campus in the style of SimCity 2000, built entirely from open data. Pan and zoom
across ~2,000 buildings and ~57,000 trees, search any dorm, hall, library or café, and click a building for details.

This is "step zero" of the project: a plain render drawn by code. It is also the input for a later AI-illustrated layer
(see [Next: the AI layer](#next-the-ai-layer)).

## Run the app

```bash
npm install
npm run dev          # http://localhost:4317
```

The rendered map (`public/tiles/`) and labels (`public/data/places.json`) are committed, so the app runs without the
data pipeline.

## How the map is made

| Step | Source | What it gives us |
| --- | --- | --- |
| Footprints, roads, fields, pools | [OpenStreetMap](https://www.openstreetmap.org) via Overpass | Building outlines (including hand-modelled parts such as Hoover Tower), streets, paths, pitches, water |
| Heights, roof shapes, trees | [USGS 3DEP lidar](https://www.usgs.gov/3d-elevation-program), `CA_SantaClaraCounty_2020` (public EPT on AWS) | Roof height and pitch for every building; individual tree tops and crown sizes |
| Colours | [USDA NAIP](https://naip-usdaonline.hub.arcgis.com/) 2024, 0.6 m RGB + near-infrared (Microsoft Planetary Computer) | Roof colours, lawn vs. dry grass vs. paving, tree vigour |
| Official names | Stanford LBRE Maps & Records public Map Maker service | Official building names and IDs, dorm complexes, libraries, eateries |

Pipeline (`pipeline/stanford_pixxel/`):

1. `fetch_*` download each source for a rectangle aligned to the campus street grid (14.4° off north).
2. `build_scene.py` fuses them:
   - roofs are classified from lidar slope; pitched roofs become hipped roofs with eave height and pitch measured from
     the point cloud, flat roofs take the 85th-percentile height, and towers/wings are split out where the lidar shows a
     much taller section;
   - trees are local maxima of the vegetation canopy height model;
   - the ground is classified (lawn, dry grass, dirt, paving, asphalt, shrubs) from NAIP, with OSM roads, paths, courts
     and pools drawn crisply on top and shadows cast from the lidar surface;
   - every label, outline and coordinate is projected with the same orthographic camera.
3. `render/` renders buildings and trees in headless Chrome with three.js. Hipped roofs come from CGAL's straight
   skeleton (`straight-skeleton`, WebAssembly), windows and roof tiles are procedural, and outlines come from depth
   edges.
4. `compose.py` composites objects over the ground and cuts a Deep Zoom pyramid with libvips.

The viewer is Next.js + OpenSeadragon + shadcn/ui.

### Rebuilding the map

Requirements: Node 20+, [uv](https://docs.astral.sh/uv/), libvips (`apt install libvips-tools`), Google Chrome or
Chromium (set `CHROME_PATH` if it is not at `/usr/local/bin/google-chrome`).

```bash
npm run map:fetch    # ~5 min: OSM, Stanford names, 90M lidar points, NAIP imagery -> data/raw/
npm run map:build    # ~2 min: scene + render + Deep Zoom tiles -> public/
```

Tweak the region, camera angle or scale in `pipeline/stanford_pixxel/config.py`.

## Next: the AI layer

The plan is to repaint this render as hand-drawn pixel art, the way Pixel Chennai does:

1. Cut `data/build/final.png` into overlapping 1024 px tiles (same camera, so layers line up).
2. Make 30–50 style references with an image model.
3. Train a Qwen-Image-Edit-2511 style LoRA on Stanford's Sherlock cluster, then run every tile through it with the
   Lightning 4-step LoRA.
4. Hand-polish landmark tiles (Hoover Tower, Memorial Church, the Main Quad), cut a second pyramid, and add a toggle.

## Credits

© OpenStreetMap contributors (ODbL) · USGS 3DEP lidar · USDA NAIP imagery · Stanford LBRE Maps & Records.
Not affiliated with Stanford University.
