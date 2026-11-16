// Builds the sprite atlas for the live layer (cars, shuttles, bikes, students) by rendering tiny 3D models
// through the map's own isometric camera, so every sprite matches the map's angle and lighting.
// Driven by render/sprites.mjs through window.buildAtlas().
import * as THREE from "three";

THREE.ColorManagement.enabled = false;

const SCALE = 1.5; // sprites are drawn 1.5x real size so people stay readable at street zoom
const CAR_COLORS = ["#f2f0ea", "#1f2328", "#8a9099", "#b0342c", "#2f4f86", "#5f7f5a", "#c9b48a", "#3c3c44"];
const SHIRTS = ["#8c1515", "#2b5d9b", "#f0e6d2", "#3e7a55", "#d98c2b", "#5b4a8a", "#222222", "#c84f6e"];
const PANTS = ["#2d3a55", "#3b3b3b", "#6b5a45", "#20252d"];
const SKIN = ["#e8c3a0", "#c99a74", "#9b6b4a", "#6e4a33"];

function sunShade(n, sun) {
  const d = Math.max(0, n.x * sun[0] + n.y * sun[1] + n.z * sun[2]);
  return 0.58 + 0.55 * d;
}

function box(w, l, h, color, x, y, z, sun) {
  const g = new THREE.BoxGeometry(l, w, h).toNonIndexed();
  g.translate(x, y, z + h / 2);
  const pos = g.getAttribute("position");
  const col = [];
  const base = new THREE.Color(color);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    const k = sunShade(n, sun);
    for (let j = 0; j < 3; j++) col.push(Math.min(1, base.r * k), Math.min(1, base.g * k), Math.min(1, base.b * k));
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

function group(geoms) {
  const gr = new THREE.Group();
  for (const g of geoms) gr.add(new THREE.Mesh(g, material));
  return gr;
}

function car(color, sun, kind = "car") {
  if (kind === "bus") {
    return group([
      box(2.5, 11.5, 2.6, "#f4f2ee", 0, 0, 0.35, sun),
      box(2.52, 11.52, 0.45, "#8c1515", 0, 0, 0.9, sun),
      box(2.54, 10.4, 0.8, "#2c3440", 0.2, 0, 1.7, sun),
      box(2.4, 11.2, 0.2, "#dcd8d0", 0, 0, 2.95, sun),
    ]);
  }
  if (kind === "van") {
    return group([box(1.9, 5.2, 1.4, color, 0, 0, 0.3, sun), box(1.86, 3.6, 0.8, "#2c3440", -0.4, 0, 1.7, sun), box(1.8, 3.2, 0.12, color, -0.4, 0, 2.5, sun)]);
  }
  return group([
    box(1.8, 4.4, 0.75, color, 0, 0, 0.3, sun),
    box(1.6, 2.3, 0.55, "#2c3440", -0.25, 0, 1.05, sun),
    box(1.5, 2.0, 0.1, color, -0.25, 0, 1.6, sun),
  ]);
}

function bike(shirt, skin, frame, sun) {
  const pedal = frame === 0 ? 0.18 : -0.18;
  return group([
    box(0.12, 1.7, 0.7, "#2a2a2a", 0, 0, 0.0, sun),
    box(0.22, 0.24, 0.55, "#2d3a55", 0.05 + pedal, 0.08, 0.35, sun),
    box(0.22, 0.24, 0.55, "#2d3a55", 0.05 - pedal, -0.08, 0.35, sun),
    box(0.46, 0.4, 0.62, shirt, -0.05, 0, 0.9, sun),
    box(0.3, 0.3, 0.3, skin, 0.08, 0, 1.52, sun),
  ]);
}

function person(shirt, pants, skin, hair, frame, sun, backpack) {
  const swing = [0.22, 0, -0.22, 0][frame];
  const parts = [
    box(0.17, 0.2, 0.8, pants, swing, 0.1, 0, sun),
    box(0.17, 0.2, 0.8, pants, -swing, -0.1, 0, sun),
    box(0.44, 0.28, 0.62, shirt, 0, 0, 0.8, sun),
    box(0.28, 0.28, 0.28, skin, 0, 0, 1.42, sun),
    box(0.3, 0.3, 0.1, hair, -0.02, 0, 1.68, sun),
  ];
  if (backpack) parts.push(box(0.34, 0.16, 0.42, backpack, -0.22, 0, 0.88, sun));
  return group(parts);
}

function cameraMatrix(c, k, ax, ay, w, h) {
  const b = (c.bearing * Math.PI) / 180;
  const e = (c.elevation * Math.PI) / 180;
  const sb = Math.sin(b), cb = Math.cos(b), se = Math.sin(e), ce = Math.cos(e);
  const D = 400;
  const M = new THREE.Matrix4();
  M.set(
    (2 * k * cb) / w, (-2 * k * sb) / w, 0, (2 * ax) / w - 1,
    (2 * k * se * sb) / h, (2 * k * se * cb) / h, (2 * k * ce) / h, 1 - (2 * ay) / h,
    (2 * ce * sb) / D, (2 * ce * cb) / D, (-2 * se) / D, 0,
    0, 0, 0, 1,
  );
  return M;
}

function outline(ctx, x0, y0, w, h) {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 128;
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] > 128) {
        out[i + 3] = 255;
        continue;
      }
      out[i + 3] = 0;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        out[i] = 34; out[i + 1] = 28; out[i + 2] = 28; out[i + 3] = 210;
      }
    }
  }
  ctx.putImageData(new ImageData(out, w, h), x0, y0);
}

window.buildAtlas = async (camera, sun) => {
  const k = camera.pxPerM * SCALE;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const cam = new THREE.Camera();
  cam.matrixAutoUpdate = false;
  const scene = new THREE.Scene();

  // name -> {cell: [w,h], anchor: [ax, ay], headings, frames, variants, origin: [x,y]}
  const specs = [
    { name: "car", cell: [44, 34], anchor: [22, 22], headings: 16, frames: 1, variants: CAR_COLORS.length, make: (v, f) => car(CAR_COLORS[v], sun) },
    { name: "van", cell: [48, 38], anchor: [24, 26], headings: 16, frames: 1, variants: 3, make: (v) => car(["#f2f0ea", "#8a9099", "#2f4f86"][v], sun, "van") },
    { name: "bus", cell: [92, 66], anchor: [46, 42], headings: 16, frames: 1, variants: 1, make: () => car("#ffffff", sun, "bus") },
    { name: "bike", cell: [24, 24], anchor: [12, 17], headings: 16, frames: 2, variants: 6, make: (v, f) => bike(SHIRTS[v], SKIN[v % 4], f, sun) },
    {
      name: "person", cell: [16, 18], anchor: [8, 15], headings: 8, frames: 4, variants: 12,
      make: (v, f) => person(SHIRTS[v % 8], PANTS[v % 4], SKIN[(v * 3) % 4], ["#2a1d14", "#5a3a22", "#111111", "#b08850"][v % 4], f, sun, v % 3 === 0 ? "#3a3f4a" : v % 3 === 1 ? "#8c1515" : null),
    },
  ];

  let y = 0;
  const width = 1024;
  const meta = { scale: SCALE, sprites: {} };
  const layout = [];
  for (const s of specs) {
    const perRow = Math.floor(width / s.cell[0]);
    const count = s.headings * s.frames * s.variants;
    const rows = Math.ceil(count / perRow);
    layout.push({ s, y, perRow });
    meta.sprites[s.name] = { cell: s.cell, anchor: s.anchor, headings: s.headings, frames: s.frames, variants: s.variants, y, perRow };
    y += rows * s.cell[1];
  }
  const atlas = document.createElement("canvas");
  atlas.width = width;
  atlas.height = y;
  const ctx = atlas.getContext("2d", { willReadFrequently: true });

  for (const { s, y: y0, perRow } of layout) {
    renderer.setSize(s.cell[0], s.cell[1], false);
    cam.projectionMatrix.copy(cameraMatrix(camera, k, s.anchor[0], s.anchor[1], s.cell[0], s.cell[1]));
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    let i = 0;
    for (let v = 0; v < s.variants; v++) {
      for (let hdg = 0; hdg < s.headings; hdg++) {
        for (let f = 0; f < s.frames; f++) {
          const obj = s.make(v, f);
          obj.rotation.z = (hdg / s.headings) * Math.PI * 2;
          scene.add(obj);
          renderer.render(scene, cam);
          scene.remove(obj);
          const cx = (i % perRow) * s.cell[0];
          const cy = y0 + Math.floor(i / perRow) * s.cell[1];
          ctx.drawImage(renderer.domElement, cx, cy);
          outline(ctx, cx, cy, s.cell[0], s.cell[1]);
          i++;
        }
      }
    }
  }
  meta.width = width;
  meta.height = y;
  return { png: atlas.toDataURL("image/png"), meta };
};

window.ready = true;
