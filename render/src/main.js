// Renders buildings and trees from data/build/scene.json with the exact isometric camera used by the
// ground painter, one tile at a time. Driven by render/capture.mjs through window.renderTile().
import * as THREE from "three";
import { SkeletonBuilder } from "straight-skeleton";

THREE.ColorManagement.enabled = false;

const DEPTH_MIN = -2500;
const DEPTH_MAX = 2500;
const FLOOR = 3.6;

let scene, renderer, cam, sun, target, post;

function lit(normal, ambient, diffuse) {
  const d = Math.max(0, normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2]);
  return ambient + diffuse * d;
}

function shade(hex, normal, ambient = 0.6, diffuse = 0.48) {
  const c = new THREE.Color(hex);
  const k = lit(normal, ambient, diffuse);
  return [Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k)];
}

class Mesh {
  constructor() {
    this.pos = [];
    this.col = [];
    this.uv = [];
    this.info = [];
  }
  tri(a, b, c, color, uvs, info) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.col.push(...color);
      this.uv.push(...(uvs ? uvs[i] : [-1, -1]));
      this.info.push(...(info || [0, 0]));
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("wuv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("info", new THREE.Float32BufferAttribute(this.info, 2));
    g.computeBoundingSphere();
    return g;
  }
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  let out = [n[0] / l, n[1] / l, n[2] / l];
  if (out[2] < 0) out = out.map((x) => -x);
  return out;
}

function windowStyle(b, wallH) {
  if (wallH < 2.8 || b.stands) return 0;
  if (b.category === "parking") return 2;
  if (b.category === "residence" && wallH < 9) return 3;
  return 1;
}

function addWalls(mesh, b, ring, z0, z1, viewDir, allSides = false) {
  const style = windowStyle(b, z1 - z0);
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const c = ring[i + 1];
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    const n = [dy / len, -dx / len, 0];
    const s0 = s;
    s += len;
    if (!allSides && n[0] * viewDir[0] + n[1] * viewDir[1] < -0.02) continue;
    const color = shade(b.wallColor, n, 0.58, 0.5);
    const info = [style, z1];
    const p00 = [a[0], a[1], z0];
    const p10 = [c[0], c[1], z0];
    const p11 = [c[0], c[1], z1];
    const p01 = [a[0], a[1], z1];
    mesh.tri(p00, p10, p11, color, [[s0, z0], [s, z0], [s, z1]], info);
    mesh.tri(p00, p11, p01, color, [[s0, z0], [s, z1], [s0, z1]], info);
  }
}

function addFlatRoof(mesh, b, rings, z, color) {
  const outer = rings[0].slice(0, -1).map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = rings.slice(1).map((r) => r.slice(0, -1).map((p) => new THREE.Vector2(p[0], p[1])));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  } catch {
    return;
  }
  const all = outer.concat(...holes);
  const col = shade(color, [0, 0, 1], 0.62, 0.42);
  const k0 = lit([0, 0, 1], 0.62, 0.42);
  for (const [i, j, k] of tris) {
    mesh.tri([all[i].x, all[i].y, z], [all[j].x, all[j].y, z], [all[k].x, all[k].y, z], col, null, [5, k0]);
  }
}

function clipPolygon(poly, tcap, keepBelow) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = keepBelow ? a[2] <= tcap : a[2] >= tcap;
    const inb = keepBelow ? b[2] <= tcap : b[2] >= tcap;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (tcap - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, tcap]);
    }
  }
  return out;
}

function addPolygon3d(mesh, poly, z, color, info) {
  if (poly.length < 3) return;
  const pts = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(pts, []);
  } catch {
    return;
  }
  for (const [i, j, k] of tris) {
    const a = [poly[i][0], poly[i][1], z(poly[i])];
    const b = [poly[j][0], poly[j][1], z(poly[j])];
    const c = [poly[k][0], poly[k][1], z(poly[k])];
    const n = faceNormal(a, b, c);
    mesh.tri(a, b, c, shade(color, n, 0.56, 0.55), null, [info[0], lit(n, 0.56, 0.55)]);
  }
}

function cleanRing(ring, wantCcw) {
  const pts = [];
  for (const p of ring.slice(0, -1)) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) pts.push(p);
  }
  // Drop nearly collinear vertices; CGAL rejects degenerate rings.
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) < 0.02) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3) return null;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 4) return null;
  if (area > 0 !== wantCcw) pts.reverse();
  pts.push(pts[0]);
  return pts;
}

let skeletonBroken = false;

function addHippedRoof(mesh, b, rings) {
  if (skeletonBroken) return false;
  const outer = cleanRing(rings[0], true);
  if (!outer) return false;
  const holes = rings.slice(1).map((r) => cleanRing(r, false)).filter(Boolean);
  let sk = null;
  try {
    sk = SkeletonBuilder.buildFromPolygon([outer, ...holes]);
  } catch {
    // A CGAL assertion aborts the WebAssembly module; the caller re-initialises it.
    skeletonBroken = true;
    sk = null;
  }
  if (!sk) return false;
  const tcap = b.rise / b.pitch;
  const z = (p) => b.eave + Math.min(p[2], tcap) * b.pitch;
  for (const face of sk.polygons) {
    const poly = face.map((i) => sk.vertices[i]);
    const below = clipPolygon(poly, tcap, true);
    addPolygon3d(mesh, below, z, b.roofColor, [6, b.eave]);
    const above = clipPolygon(poly, tcap, false);
    if (above.length >= 3) {
      const flat = above.map((p) => [p[0], p[1], tcap]);
      addPolygon3d(mesh, flat, z, b.roofColor, [5, b.eave + b.rise]);
    }
  }
  return true;
}

function addBowlRoof(mesh, b, rings) {
  // Stadium stands: seating rises from the field (the inner ring) to a flat rim along the outside.
  const outer = cleanRing(rings[0], true);
  const holes = rings.slice(1).map((r) => cleanRing(r, false)).filter(Boolean);
  if (!outer || !holes.length || skeletonBroken) return false;
  let sk = null;
  try {
    sk = SkeletonBuilder.buildFromPolygon([outer, ...holes]);
  } catch {
    skeletonBroken = true;
  }
  if (!sk) return false;
  const holeKeys = new Set(holes.flat().map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`));
  const top = b.eave + b.rise;
  for (const face of sk.polygons) {
    const poly = face.map((i) => sk.vertices[i]);
    const base = poly.filter((p) => p[2] < 1e-6);
    const fromField = base.length > 0 && base.every((p) => holeKeys.has(`${p[0].toFixed(1)},${p[1].toFixed(1)}`));
    const tcap = b.rise / b.pitch;
    if (fromField) {
      const z = (p) => b.eave + Math.min(p[2], tcap) * b.pitch;
      addPolygon3d(mesh, clipPolygon(poly, tcap, true), z, b.roofColor, [6, 0]);
      const above = clipPolygon(poly, tcap, false);
      if (above.length >= 3) addPolygon3d(mesh, above, () => top, "#b9b4aa", [5, 0]);
    } else {
      addPolygon3d(mesh, poly, () => top, "#b9b4aa", [5, 0]);
    }
  }
  // The field side of the stands: a low wall from the ground up to the first row.
  for (const ring of holes) addWalls(mesh, { ...b, wallColor: "#8f8a80" }, ring, 0, b.eave, [0, 0], true);
  return true;
}

function addDome(mesh, b, rings) {
  const ring = rings[0];
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p[0];
    cy += p[1];
  }
  cx /= ring.length;
  cy /= ring.length;
  let r = 0;
  for (const p of ring) r += Math.hypot(p[0] - cx, p[1] - cy);
  r /= ring.length;
  const seg = 16;
  const rings_ = 5;
  const pt = (i, j) => {
    const a = (i / seg) * Math.PI * 2;
    const t = (j / rings_) * (Math.PI / 2);
    return [cx + Math.cos(a) * r * Math.cos(t), cy + Math.sin(a) * r * Math.cos(t), b.eave + b.rise * Math.sin(t)];
  };
  for (let j = 0; j < rings_; j++) {
    for (let i = 0; i < seg; i++) {
      const a = pt(i, j);
      const c = pt(i + 1, j);
      const d = pt(i + 1, j + 1);
      const e = pt(i, j + 1);
      mesh.tri(a, c, d, shade(b.roofColor, faceNormal(a, c, d), 0.55, 0.6), null, [7, lit(faceNormal(a, c, d), 0.55, 0.6)]);
      mesh.tri(a, d, e, shade(b.roofColor, faceNormal(a, d, e), 0.55, 0.6), null, [7, lit(faceNormal(a, d, e), 0.55, 0.6)]);
    }
  }
}

async function buildBuildings(data, viewDir) {
  const mesh = new Mesh();
  for (const b of data.buildings) {
    if (skeletonBroken) {
      skeletonBroken = false;
      SkeletonBuilder.module = null;
      await SkeletonBuilder.init();
    }
    const rings = b.rings;
    const z0 = b.minH || 0;
    const wallTop = b.roof === "flat" ? b.h : b.roof === "bowl" ? b.eave + b.rise : b.eave;
    if (b.roof === "bowl") {
      addWalls(mesh, b, rings[0], z0, wallTop, viewDir);
      if (!addBowlRoof(mesh, b, rings)) addFlatRoof(mesh, b, rings, wallTop, b.roofColor);
      continue;
    }
    for (const ring of rings) addWalls(mesh, b, ring, z0, wallTop, viewDir);
    if (b.roof === "hipped") {
      if (!addHippedRoof(mesh, b, rings)) addFlatRoof(mesh, b, rings, b.h, b.roofColor);
    } else if (b.roof === "dome") {
      addFlatRoof(mesh, b, rings, b.eave, b.roofColor);
      addDome(mesh, b, rings);
    } else {
      addFlatRoof(mesh, b, rings, b.h, b.roofColor);
    }
  }
  return mesh.build();
}

// ?massing=1 renders plain blocks (real footprints, heights and roofs, no windows or textures) as a layout guide.
const MASSING = new URLSearchParams(location.search).get("massing") === "1";

const buildingMaterial = (roofTex, rt) =>
  new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
    uniforms: {
      tRoof: { value: roofTex },
      massing: { value: MASSING ? 1 : 0 },
      roofBox: { value: new THREE.Vector4(rt.x0, rt.y1, rt.w * rt.res, rt.h * rt.res) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 info;
      attribute vec2 wuv;
      varying vec3 vColor;
      varying vec2 vUv;
      varying vec2 vInfo;
      varying vec3 vPos;
      void main() {
        vColor = color;
        vUv = wuv;
        vInfo = info;
        vPos = position;
        gl_Position = projectionMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tRoof;
      uniform vec4 roofBox;
      uniform float massing;
      varying vec3 vColor;
      varying vec2 vUv;
      varying vec2 vInfo;
      varying vec3 vPos;
      void main() {
        vec3 c = vColor;
        float style = vInfo.x;
        if (massing > 0.5) {
          gl_FragColor = vec4(c, style > 4.5 ? 1.0 : 0.6);
          return;
        }
        if (style > 4.5 && style < 6.5) {
          // Rooftops show the real aerial photo, lit like the rest of the roof.
          vec2 ruv = vec2((vPos.x - roofBox.x) / roofBox.z, (roofBox.y - vPos.y) / roofBox.w);
          vec3 photo = texture2D(tRoof, ruv).rgb;
          c = mix(vColor, photo * vInfo.y * 1.06, 0.72);
        }
        if (vUv.x >= 0.0 && style > 0.5 && style < 4.5) {
          float z = vUv.y;
          float top = vInfo.y;
          float fl = fract(z / ${FLOOR.toFixed(1)});
          float col = fract(vUv.x / 2.7);
          bool inside = z > 1.0 && z < top - 0.7;
          vec3 glass = vec3(0.30, 0.37, 0.46) * (0.75 + 0.6 * dot(vColor, vec3(0.33)));
          if (style < 1.5) {
            if (inside && fl > 0.32 && fl < 0.78 && col > 0.22 && col < 0.72) c = mix(c, glass, 0.78);
          } else if (style < 2.5) {
            if (inside && fl > 0.45 && fl < 0.9) c *= 0.55;
          } else {
            float col2 = fract(vUv.x / 3.4);
            if (inside && fl > 0.30 && fl < 0.72 && col2 > 0.30 && col2 < 0.62) c = mix(c, glass, 0.7);
          }
        }
        if (style > 5.5 && style < 6.5) {
          float tiles = fract(vPos.z / 0.55);
          if (tiles < 0.22) c *= 0.88;
        }
        gl_FragColor = vec4(c, style > 4.5 ? 1.0 : 0.6);
      }`,
  });

function palmCrown() {
  // A star of drooping leaves: each leaf is a thin triangle from the crown centre out and down.
  const pos = [];
  const leaves = 9;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2;
    const w = 0.22;
    const tip = [Math.cos(a), Math.sin(a), -0.55];
    const l = [Math.cos(a - w) * 0.45, Math.sin(a - w) * 0.45, 0.05];
    const r = [Math.cos(a + w) * 0.45, Math.sin(a + w) * 0.45, 0.05];
    pos.push(0, 0, 0.2, ...l, ...tip, 0, 0, 0.2, ...tip, ...r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function treeGeometries() {
  const sh = (geo, kind) => {
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    const pos = geo.getAttribute("position");
    const colors = [];
    for (let i = 0; i < pos.count; i += 3) {
      const a = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const b = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)];
      const c = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
      const n = faceNormal(a, b, c);
      const d = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
      const k = kind === "trunk" ? 0.6 + 0.35 * d : 0.55 + 0.6 * d;
      for (let j = 0; j < 3; j++) colors.push(k, k, k);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  };
  const crown = sh(new THREE.IcosahedronGeometry(1, 1), "crown");
  const cone = sh(new THREE.ConeGeometry(1, 1, 7).rotateX(Math.PI / 2).translate(0, 0, 0.5), "crown");
  const trunk = sh(new THREE.CylinderGeometry(0.5, 0.6, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5), "trunk");
  const frond = sh(palmCrown(), "crown");
  return { crown, cone, trunk, frond };
}

function crownHeight(kind, h, r) {
  if (kind === 3) return Math.min(h * 0.62, r * 3.2);
  if (kind === 4) return Math.min(h * 0.6, r * 1.15);
  return Math.min(h * 0.72, r * 1.9);
}

function buildTrees(data) {
  const geos = treeGeometries();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, opacity: 0.3 });
  const group = new THREE.Group();
  const chunks = new Map();
  const CH = 200;
  for (const t of data.trees) {
    const key = `${Math.floor(t[0] / CH)},${Math.floor(t[1] / CH)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(t);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const trunkColor = new THREE.Color("#8a6a4c");
  const palmTrunk = new THREE.Color("#a58a68");
  for (const list of chunks.values()) {
    const parts = {
      crown: list.filter((t) => t[4] === 0 || t[4] >= 3),
      cone: list.filter((t) => t[4] === 1),
      frond: list.filter((t) => t[4] === 2),
    };
    for (const [name, items] of Object.entries(parts)) {
      if (!items.length) continue;
      const inst = new THREE.InstancedMesh(geos[name], mat, items.length);
      items.forEach((t, i) => {
        const [x, y, h, r, kind, color] = t;
        q.setFromAxisAngle(zAxis, ((x * 13.7 + y * 7.3) % 6.28));
        if (kind === 0 || kind >= 3) {
          const ch = crownHeight(kind, h, r);
          const rr = kind === 3 ? r * 0.85 : r;
          m.compose(new THREE.Vector3(x, y, h - ch / 2), q, new THREE.Vector3(rr, rr * (kind === 4 ? 0.92 : 1), ch / 2));
        } else if (kind === 1) {
          const ch = h * 0.85;
          m.compose(new THREE.Vector3(x, y, h - ch), q, new THREE.Vector3(r, r, ch));
        } else {
          m.compose(new THREE.Vector3(x, y, h - 0.6), q, new THREE.Vector3(Math.max(r, 2.6), Math.max(r, 2.6), 3.0));
        }
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, new THREE.Color(color));
      });
      inst.computeBoundingSphere();
      group.add(inst);
    }
    const trunks = new THREE.InstancedMesh(geos.trunk, mat, list.length);
    list.forEach((t, i) => {
      const [x, y, h, r, kind] = t;
      const th = kind === 0 || kind >= 3 ? h - crownHeight(kind, h, r) * 0.75 : kind === 1 ? h * 0.25 : h - 0.4;
      const w = kind === 2 ? 0.75 : Math.min(1.3, 0.55 + h * 0.03);
      m.compose(new THREE.Vector3(x, y, 0), q.identity(), new THREE.Vector3(w, w, Math.max(th, 0.5)));
      trunks.setMatrixAt(i, m);
      trunks.setColorAt(i, kind === 2 ? palmTrunk : trunkColor);
    });
    trunks.computeBoundingSphere();
    group.add(trunks);
  }
  return group;
}

function cameraMatrix(c, px0, py0, tw, th) {
  const b = (c.bearing * Math.PI) / 180;
  const e = (c.elevation * Math.PI) / 180;
  const sb = Math.sin(b);
  const cb = Math.cos(b);
  const se = Math.sin(e);
  const ce = Math.cos(e);
  const k = c.pxPerM;
  const D = DEPTH_MAX - DEPTH_MIN;
  const M = new THREE.Matrix4();
  M.set(
    (2 * k * cb) / tw, (-2 * k * sb) / tw, 0, (-2 * (c.ox + px0)) / tw - 1,
    (2 * k * se * sb) / th, (2 * k * se * cb) / th, (2 * k * ce) / th, 1 + (2 * (c.oy + py0)) / th,
    (2 * ce * sb) / D, (2 * ce * cb) / D, (-2 * se) / D, (-2 * DEPTH_MIN) / D - 1,
    0, 0, 0, 1,
  );
  return M;
}

function makePost() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: null }, texel: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 texel;
      varying vec2 vUv;
      float d(vec2 o) { return texture2D(tDepth, vUv + o * texel).r; }
      void main() {
        vec4 c = texture2D(tColor, vUv);
        float z = d(vec2(0.0));
        float zl = d(vec2(-1.0, 0.0)), zr = d(vec2(1.0, 0.0)), zu = d(vec2(0.0, 1.0)), zd = d(vec2(0.0, -1.0));
        float bg = 0.9999;
        if (z >= bg) {
          gl_FragColor = vec4(0.0);
          return;
        }
        float a = c.a;
        float ar = texture2D(tColor, vUv + vec2(1.0, 0.0) * texel).a;
        float ad = texture2D(tColor, vUv + vec2(0.0, -1.0) * texel).a;
        float zr2 = d(vec2(1.0, 0.0));
        float zd2 = d(vec2(0.0, -1.0));
        float crease = 0.0;
        if ((abs(a - ar) > 0.05 && zr2 < bg) || (abs(a - ad) > 0.05 && zd2 < bg)) crease = 1.0;
        float edge = 0.0;
        float thr = 1.4 / ${(DEPTH_MAX - DEPTH_MIN).toFixed(1)};
        // Darken the nearer side of every depth discontinuity, including silhouettes against the ground.
        if (zl - z > thr || zr - z > thr || zu - z > thr || zd - z > thr) edge = 1.0;
        vec3 col = c.rgb;
        if (edge > 0.5) col *= 0.62;
        else if (crease > 0.5 && a > 0.5) col *= 0.8;
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const s = new THREE.Scene();
  s.add(quad);
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene: s, camera: oc, material: mat };
}

async function init() {
  await SkeletonBuilder.init();
  const data = await (await fetch("/data/build/scene.json")).json();
  window.sceneInfo = { camera: data.camera, buildings: data.buildings.length, trees: data.trees.length };
  sun = data.sun;
  if (MASSING) {
    for (const b of data.buildings) {
      b.wallColor = "#e2ddd2";
      b.roofColor = b.roof === "flat" ? "#bab6ae" : b.stands ? "#b0aaa0" : "#c98466";
    }
  }
  const b = (data.camera.bearing * Math.PI) / 180;
  const viewDir = [-Math.sin(b), -Math.cos(b)];
  scene = new THREE.Scene();
  const bg = await buildBuildings(data, viewDir);
  const roofTex = await new THREE.TextureLoader().loadAsync("/data/build/roofs.png");
  roofTex.flipY = false;
  roofTex.magFilter = THREE.NearestFilter;
  roofTex.minFilter = THREE.NearestFilter;
  roofTex.generateMipmaps = false;
  roofTex.needsUpdate = true;
  scene.add(new THREE.Mesh(bg, buildingMaterial(roofTex, data.roofTex)));
  scene.add(buildTrees(data));
  cam = new THREE.Camera();
  cam.matrixAutoUpdate = false;
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  post = makePost();
  window.ready = true;
}

window.renderTile = (px0, py0, tw, th) => {
  if (!target || target.width !== tw || target.height !== th) {
    target?.dispose();
    target = new THREE.WebGLRenderTarget(tw, th, { depthTexture: new THREE.DepthTexture(tw, th, THREE.FloatType), magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    renderer.setSize(tw, th, false);
    renderer.setPixelRatio(1);
  }
  const c = window.sceneInfo.camera;
  cam.projectionMatrix.copy(cameraMatrix(c, px0, py0, tw, th));
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  post.material.uniforms.tColor.value = target.texture;
  post.material.uniforms.tDepth.value = target.depthTexture;
  post.material.uniforms.texel.value.set(1 / tw, 1 / th);
  renderer.clear();
  renderer.render(post.scene, post.camera);
  return renderer.domElement.toDataURL("image/png");
};

init().catch((e) => {
  window.initError = String(e && e.stack ? e.stack : e);
});
