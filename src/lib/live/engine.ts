import { densities, serviceActive, type CampusTime } from "./clock";
import type { AtlasData, MapView, NetworkData, OcclusionData, ShuttleData, SpriteInfo } from "./types";

const CAR = 1;
const BIKE = 2;
const WALK = 4;

const T_VAN = 1;
const T_BIKE = 2;
const T_PERSON = 3;
const MODE_OF = [CAR, CAR, BIKE, WALK];
const SPRITE_OF = ["car", "van", "bike", "person"] as const;

/** Everything moves a little faster than life so the map feels busy at a glance. */
const PACE = 2.2;
const MAX_AGENTS = 9000;

interface Edge {
  a: number;
  b: number;
  m: number;
  speed: number;
  oneway: boolean;
  lane: number;
  pts: Float32Array;
  cum: Float32Array;
  lenPx: number;
  mPerPx: number;
}

interface Adj {
  edge: number;
  dir: 1 | -1;
}

interface Shape {
  pts: Float32Array;
  cum: Float32Array;
}

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export class LiveWorld {
  private edges: Edge[] = [];
  private adj: Map<number, Adj[]>[] = [new Map(), new Map(), new Map()];
  private pick: { prefix: Float64Array; ids: Int32Array }[] = [];
  private anchors: Record<string, number[]>;
  private nodes: [number, number][];
  private parking: [number, number, number][];
  private parkedHeading: Uint8Array;
  private shapes = new Map<string, Shape>();
  private shuttles: ShuttleData | null;
  private activeTrips: ShuttleData["trips"] = [];
  private tripCheck = -1;
  private occ: OcclusionData | null;
  private atlas: AtlasData;
  private image: CanvasImageSource;
  private M: [number, number, number, number];
  private Mi: [number, number, number, number];
  private random = rand(20260915);

  private n = 0;
  private type = new Uint8Array(MAX_AGENTS);
  private variant = new Uint8Array(MAX_AGENTS);
  private edge = new Int32Array(MAX_AGENTS);
  private dir = new Int8Array(MAX_AGENTS);
  private s = new Float32Array(MAX_AGENTS);
  private speed = new Float32Array(MAX_AGENTS);
  private offset = new Float32Array(MAX_AGENTS);
  private phase = new Float32Array(MAX_AGENTS);
  private retire = new Uint8Array(MAX_AGENTS);

  stats = { students: 0, bikes: 0, cars: 0, shuttles: 0, parked: 0 };
  private lastMinutes = 0;
  private target = { students: 0, bikes: 0, cars: 0, parkedShare: 0.5 };

  constructor(
    net: NetworkData,
    shuttles: ShuttleData | null,
    occ: OcclusionData | null,
    atlas: AtlasData,
    image: CanvasImageSource,
    core?: { x: number; y: number }[],
  ) {
    this.atlas = atlas;
    this.image = image;
    this.occ = occ;
    this.shuttles = shuttles;
    this.nodes = net.nodes;
    this.anchors = net.anchors;
    this.parking = net.parking;

    const b = (atlas.camera.bearing * Math.PI) / 180;
    const e = (atlas.camera.elevation * Math.PI) / 180;
    const k = net.pxPerM;
    this.M = [k * Math.cos(b), -k * Math.sin(b), -k * Math.sin(e) * Math.sin(b), -k * Math.sin(e) * Math.cos(b)];
    const det = this.M[0] * this.M[3] - this.M[1] * this.M[2];
    this.Mi = [this.M[3] / det, -this.M[1] / det, -this.M[2] / det, this.M[0] / det];

    for (const ed of net.edges) {
      const pts = Float32Array.from(ed.p);
      const cum = new Float32Array(pts.length / 2);
      for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      const lenPx = cum[cum.length - 1];
      if (lenPx < 0.5) continue;
      const id = this.edges.length;
      this.edges.push({ a: ed.a, b: ed.b, m: ed.m, speed: ed.s, oneway: !!ed.o, lane: ed.w || 1.7, pts, cum, lenPx, mPerPx: ed.l / lenPx });
      for (const [bit, slot] of [[CAR, 0], [BIKE, 1], [WALK, 2]] as const) {
        if (!(ed.m & bit)) continue;
        const map = this.adj[slot];
        const push = (node: number, item: Adj) => {
          const list = map.get(node);
          if (list) list.push(item);
          else map.set(node, [item]);
        };
        push(ed.a, { edge: id, dir: 1 });
        if (!(bit === CAR && ed.o)) push(ed.b, { edge: id, dir: -1 });
      }
    }
    // Foot and bike traffic concentrates around the academic core; cars spread over the street grid.
    const corePts = core ?? [];
    const coreRadius = 420 * k;
    const centrality = (ed: Edge) => {
      if (!corePts.length) return 1;
      const mx = ed.pts[Math.floor(ed.pts.length / 4) * 2];
      const my = ed.pts[Math.floor(ed.pts.length / 4) * 2 + 1];
      let best = Infinity;
      for (const c of corePts) best = Math.min(best, Math.hypot(mx - c.x, (my - c.y) * 2));
      return 0.35 + 3 * Math.exp(-((best / coreRadius) ** 2));
    };
    for (const bit of [CAR, BIKE, WALK]) {
      const ids: number[] = [];
      const prefix: number[] = [];
      let total = 0;
      this.edges.forEach((ed, i) => {
        if (!(ed.m & bit)) return;
        const w = ed.lenPx * (bit === CAR ? Math.max(0.3, ed.speed / 10) : centrality(ed));
        total += w;
        ids.push(i);
        prefix.push(total);
      });
      this.pick.push({ prefix: Float64Array.from(prefix), ids: Int32Array.from(ids) });
    }

    this.parkedHeading = new Uint8Array(this.parking.length);
    this.parking.forEach(([, , ang], i) => {
      this.parkedHeading[i] = this.headingIndex(Math.cos(ang), Math.sin(ang), 16);
    });

    if (shuttles) {
      for (const [id, sh] of Object.entries(shuttles.shapes)) this.shapes.set(id, { pts: Float32Array.from(sh.p), cum: Float32Array.from(sh.d) });
    }
  }

  private slot(bit: number) {
    return bit === CAR ? 0 : bit === BIKE ? 1 : 2;
  }

  private randomEdge(bit: number) {
    const { prefix, ids } = this.pick[this.slot(bit)];
    if (!ids.length) return -1;
    const r = this.random() * prefix[prefix.length - 1];
    let lo = 0;
    let hi = prefix.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prefix[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return ids[lo];
  }

  private edgeFromAnchor(bit: number, categories: string[]) {
    const list = categories.flatMap((c) => this.anchors[c] ?? []);
    if (!list.length) return null;
    const node = list[Math.floor(this.random() * list.length)];
    const options = this.adj[this.slot(bit)].get(node);
    if (!options?.length) return null;
    return options[Math.floor(this.random() * options.length)];
  }

  private spawn(type: number, minutes: number) {
    if (this.n >= MAX_AGENTS) return;
    const bit = MODE_OF[type];
    let start: Adj | null = null;
    if (type >= T_BIKE && this.random() < 0.45) {
      const morning = minutes < 11 * 60;
      const cats = morning ? ["residence"] : this.random() < 0.4 ? ["dining", "library"] : ["academic", "residence", "landmark"];
      start = this.edgeFromAnchor(bit, cats);
    }
    if (!start) {
      const id = this.randomEdge(bit);
      if (id < 0) return;
      const ed = this.edges[id];
      const back = !(bit === CAR && ed.oneway) && this.random() < 0.5;
      start = { edge: id, dir: back ? -1 : 1 };
    }
    const i = this.n++;
    const ed = this.edges[start.edge];
    this.type[i] = type;
    this.edge[i] = start.edge;
    this.dir[i] = start.dir;
    this.s[i] = this.random() * ed.lenPx;
    this.retire[i] = 0;
    this.phase[i] = this.random() * 4;
    const sp = this.atlas.sprites[SPRITE_OF[type]];
    this.variant[i] = Math.floor(this.random() * sp.variants);
    if (type <= T_VAN) {
      this.speed[i] = Math.max(3, ed.speed) * (0.75 + 0.25 * this.random());
      this.offset[i] = ed.lane * 0.55;
    } else if (type === T_BIKE) {
      this.speed[i] = 4.2 + 2.2 * this.random();
      this.offset[i] = 0.6 + 0.5 * this.random();
    } else {
      this.speed[i] = 1.15 + 0.45 * this.random();
      this.offset[i] = (this.random() - 0.5) * 2.4;
    }
  }

  private remove(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.type[i] = this.type[j];
    this.variant[i] = this.variant[j];
    this.edge[i] = this.edge[j];
    this.dir[i] = this.dir[j];
    this.s[i] = this.s[j];
    this.speed[i] = this.speed[j];
    this.offset[i] = this.offset[j];
    this.phase[i] = this.phase[j];
    this.retire[i] = this.retire[j];
  }

  /** Direction of travel when entering an edge. */
  private entryTan(ed: Edge, dir: number): [number, number] {
    const p = ed.pts;
    const n = p.length;
    const [dx, dy] = dir > 0 ? [p[2] - p[0], p[3] - p[1]] : [p[n - 4] - p[n - 2], p[n - 3] - p[n - 1]];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }

  /** Direction of travel when leaving an edge. */
  private exitTan(ed: Edge, dir: number): [number, number] {
    const p = ed.pts;
    const n = p.length;
    const [dx, dy] = dir > 0 ? [p[n - 2] - p[n - 4], p[n - 1] - p[n - 3]] : [p[0] - p[2], p[1] - p[3]];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }

  private nextEdge(i: number) {
    const ed = this.edges[this.edge[i]];
    const d = this.dir[i];
    const node = d > 0 ? ed.b : ed.a;
    const bit = MODE_OF[this.type[i]];
    const options = this.adj[this.slot(bit)].get(node) ?? [];
    const [ix, iy] = this.exitTan(ed, d);
    let total = 0;
    const weights: number[] = [];
    for (const o of options) {
      if (o.edge === this.edge[i]) {
        weights.push(options.length === 1 ? 1 : 0);
        total += weights[weights.length - 1];
        continue;
      }
      const [ox, oy] = this.entryTan(this.edges[o.edge], o.dir);
      const straight = Math.max(0, ix * ox + iy * oy);
      let w = bit === CAR ? 0.15 + straight * straight * 3 : 0.5 + straight;
      if (bit === CAR && this.edges[o.edge].speed <= 6 && ed.speed > 6) w *= 0.35;
      weights.push(w);
      total += w;
    }
    if (total <= 0) return null;
    let r = this.random() * total;
    for (let k = 0; k < options.length; k++) {
      r -= weights[k];
      if (r <= 0) return options[k];
    }
    return options[options.length - 1];
  }

  setTime(t: CampusTime) {
    this.lastMinutes = t.minutes;
    const d = densities(t);
    this.target = d;
    if (this.shuttles && Math.floor(t.minutes) !== this.tripCheck) {
      this.tripCheck = Math.floor(t.minutes);
      const sec = t.minutes * 60;
      this.activeTrips = this.shuttles.trips.filter(
        (tr) => sec >= tr.t[0] && sec <= tr.t[tr.t.length - 1] && serviceActive(this.shuttles!.services[tr.s], t),
      );
    }
  }

  update(dt: number, minutes: number) {
    dt = Math.min(dt, 0.1) * PACE;
    const want = [this.target.cars * 0.86, this.target.cars * 0.14, this.target.bikes, this.target.students];
    const have = [0, 0, 0, 0];
    for (let i = 0; i < this.n; i++) have[this.type[i]]++;
    for (let type = 0; type < 4; type++) {
      const gap = want[type] - have[type];
      if (gap > 0) {
        const burst = this.n === 0 ? gap : Math.min(gap, Math.ceil(gap * 0.08) + 2);
        for (let k = 0; k < burst; k++) this.spawn(type, minutes);
      } else if (gap < -8) {
        let toRetire = Math.ceil(-gap * 0.05);
        for (let i = 0; i < this.n && toRetire > 0; i++) {
          if (this.type[i] === type && !this.retire[i]) {
            this.retire[i] = 1;
            toRetire--;
          }
        }
      }
    }

    for (let i = 0; i < this.n; i++) {
      const ed = this.edges[this.edge[i]];
      this.s[i] += (this.speed[i] * dt) / ed.mPerPx;
      this.phase[i] += dt * (this.type[i] === T_PERSON ? 5 : 3);
      let guard = 0;
      while (this.s[i] >= this.edges[this.edge[i]].lenPx && guard++ < 4) {
        const cur = this.edges[this.edge[i]];
        if (this.retire[i]) {
          this.remove(i);
          i--;
          break;
        }
        const next = this.nextEdge(i);
        if (!next) {
          this.dir[i] = -this.dir[i] as 1 | -1;
          this.s[i] = 0;
          break;
        }
        this.s[i] -= cur.lenPx;
        this.edge[i] = next.edge;
        this.dir[i] = next.dir;
        if (this.type[i] <= T_VAN) {
          const ne = this.edges[next.edge];
          this.speed[i] = Math.max(3, ne.speed) * (0.75 + 0.25 * this.random());
          this.offset[i] = ne.lane * 0.55;
        }
      }
    }
    const st = { students: 0, bikes: 0, cars: 0 };
    for (let i = 0; i < this.n; i++) {
      const t = this.type[i];
      if (t === T_PERSON) st.students++;
      else if (t === T_BIKE) st.bikes++;
      else st.cars++;
    }
    this.stats = { ...this.stats, ...st, shuttles: this.activeTrips.length };
  }

  private headingIndex(sx: number, sy: number, count: number) {
    const [a, b, c, d] = this.Mi;
    const e = a * sx + b * sy;
    const n = c * sx + d * sy;
    const ang = Math.atan2(n, e);
    return ((Math.round((ang / (Math.PI * 2)) * count) % count) + count) % count;
  }

  private rightOffset(tx: number, ty: number, meters: number): [number, number] {
    const [a, b, c, d] = this.Mi;
    const e = a * tx + b * ty;
    const n = c * tx + d * ty;
    const l = Math.hypot(e, n) || 1;
    const re = (n / l) * meters;
    const rn = (-e / l) * meters;
    const [m0, m1, m2, m3] = this.M;
    return [m0 * re + m1 * rn, m2 * re + m3 * rn];
  }

  private occluded(x: number, y: number) {
    const o = this.occ;
    if (!o) return false;
    const ix = (x / o.scale) | 0;
    const iy = (y / o.scale) | 0;
    if (ix < 0 || iy < 0 || ix >= o.w || iy >= o.h) return true;
    const idx = iy * o.w + ix;
    return ((o.bits[idx >> 3] >> (7 - (idx & 7))) & 1) === 1;
  }

  private at(pts: Float32Array, cum: Float32Array, s: number): [number, number, number, number] {
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const f = Math.min(1, Math.max(0, (s - cum[lo]) / seg));
    const x0 = pts[lo * 2];
    const y0 = pts[lo * 2 + 1];
    const x1 = pts[hi * 2];
    const y1 = pts[hi * 2 + 1];
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, x1 - x0, y1 - y0];
  }

  draw(ctx: CanvasRenderingContext2D, view: MapView, dpr: number) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const scale = view.scale;
    if (scale < 0.22) return;
    ctx.imageSmoothingEnabled = false;
    const x0 = -view.ox / scale - 60;
    const y0 = -view.oy / scale - 60;
    const x1 = (view.w - view.ox) / scale + 60;
    const y1 = (view.h - view.oy) / scale + 60;
    const showSmall = scale >= 0.42;
    const list: { y: number; x: number; sp: SpriteInfo; idx: number; badge?: [string, string] }[] = [];

    if (showSmall) {
      const share = this.target.parkedShare;
      let parked = 0;
      const car = this.atlas.sprites.car;
      for (let i = 0; i < this.parking.length; i++) {
        if (((i * 2654435761) >>> 0) % 1000 > share * 1000) continue;
        const [x, y] = this.parking[i];
        if (x < x0 || x > x1 || y < y0 || y > y1 || this.occluded(x, y)) continue;
        const v = (i * 7) % car.variants;
        list.push({ x, y, sp: car, idx: (v * car.headings + this.parkedHeading[i]) * car.frames });
        parked++;
      }
      this.stats.parked = parked;

      for (let i = 0; i < this.n; i++) {
        const ed = this.edges[this.edge[i]];
        const along = this.dir[i] > 0 ? this.s[i] : ed.lenPx - this.s[i];
        const [px, py, tx0, ty0] = this.at(ed.pts, ed.cum, along);
        const tx = tx0 * this.dir[i];
        const ty = ty0 * this.dir[i];
        const [ox, oy] = this.rightOffset(tx, ty, this.offset[i]);
        const x = px + ox;
        const y = py + oy;
        if (x < x0 || x > x1 || y < y0 || y > y1 || this.occluded(x, y)) continue;
        const sp = this.atlas.sprites[SPRITE_OF[this.type[i]]];
        const h = this.headingIndex(tx, ty, sp.headings);
        const f = Math.floor(this.phase[i]) % sp.frames;
        list.push({ x, y, sp, idx: (this.variant[i] * sp.headings + h) * sp.frames + f });
      }
    }

    if (this.shuttles) {
      const bus = this.atlas.sprites.bus;
      const now = this.lastMinutes * 60;
      for (const tr of this.activeTrips) {
        const shape = this.shapes.get(tr.sh);
        if (!shape) continue;
        let k = 0;
        while (k < tr.t.length - 2 && tr.t[k + 1] < now) k++;
        const span = tr.t[k + 1] - tr.t[k] || 1;
        const f = Math.min(1, Math.max(0, (now - tr.t[k]) / span));
        const dist = tr.d[k] + (tr.d[k + 1] - tr.d[k]) * f;
        const [x, y, tx, ty] = this.at(shape.pts, shape.cum, dist);
        if (x < x0 || x > x1 || y < y0 || y > y1 || this.occluded(x, y)) continue;
        const [ox, oy] = this.rightOffset(tx, ty, 1.8);
        list.push({ x: x + ox, y: y + oy, sp: bus, idx: this.headingIndex(tx, ty, bus.headings), badge: [tr.r, tr.c] });
      }
    }

    list.sort((a, b) => a.y - b.y);
    const s = scale * dpr;
    const ox = view.ox * dpr;
    const oy = view.oy * dpr;
    for (const it of list) {
      const { sp, idx } = it;
      const cx = (idx % sp.perRow) * sp.cell[0];
      const cy = sp.y + Math.floor(idx / sp.perRow) * sp.cell[1];
      const dx = Math.round(ox + (it.x - sp.anchor[0]) * s);
      const dy = Math.round(oy + (it.y - sp.anchor[1]) * s);
      ctx.drawImage(this.image, cx, cy, sp.cell[0], sp.cell[1], dx, dy, Math.round(sp.cell[0] * s), Math.round(sp.cell[1] * s));
      if (it.badge && scale >= 0.6) {
        const [label, color] = it.badge;
        const fs = Math.max(9, Math.round(10 * dpr));
        ctx.font = `600 ${fs}px ui-monospace, monospace`;
        const w = ctx.measureText(label).width + 8 * dpr;
        const bx = Math.round(ox + it.x * s - w / 2);
        const by = Math.round(oy + (it.y - 34) * s - fs);
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, w, fs + 5 * dpr);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, bx + 4 * dpr, by + fs);
      }
    }
  }
}
