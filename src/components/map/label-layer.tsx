"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_META, type Category, type Place } from "@/lib/places";
import type { MapView } from "@/lib/live/types";
import { cn } from "@/lib/utils";
import type { ViewBus } from "./view-bus";

interface Props {
  bus: ViewBus;
  places: Place[];
  visible: Set<Category>;
  selectedId: string | null;
  hoverId: string | null;
  onSelect(place: Place): void;
  onHover(id: string | null): void;
}

const CELL = 512;

function minRankFor(scale: number) {
  if (scale < 0.11) return 9;
  if (scale < 0.17) return 8;
  if (scale < 0.26) return 7;
  if (scale < 0.38) return 6;
  if (scale < 0.55) return 5;
  if (scale < 0.85) return 4;
  if (scale < 1.3) return 3;
  if (scale < 2.0) return 2;
  return 1;
}

function fontSize(p: Place) {
  if (p.kind === "street") return 11;
  if (p.rank >= 8) return 14;
  if (p.rank >= 5) return 12.5;
  return 11.5;
}

interface Laid {
  p: Place;
  size: number;
}

/** Grid index of places by image position, so layout only looks at what's near the screen. */
function buildIndex(places: Place[]) {
  const grid = new Map<string, Place[]>();
  for (const p of places) {
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
    const list = grid.get(key);
    if (list) list.push(p);
    else grid.set(key, [p]);
  }
  for (const list of grid.values()) list.sort((a, b) => b.rank - a.rank);
  return grid;
}

function layout(index: Map<string, Place[]>, view: MapView, visible: Set<Category>, selected: Place | undefined): Laid[] {
  const minRank = minRankFor(view.scale);
  const x0 = -view.ox / view.scale - 300;
  const y0 = -view.oy / view.scale - 150;
  const x1 = (view.w - view.ox) / view.scale + 300;
  const y1 = (view.h - view.oy) / view.scale + 150;
  const candidates: Place[] = [];
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
      for (const p of index.get(`${cx},${cy}`) ?? []) {
        if (p === selected || !visible.has(p.category)) continue;
        if (p.kind === "complex" && view.scale > 1.1) continue;
        const need = p.kind === "street" ? Math.max(minRank, 3) + (view.scale < 0.45 ? 1 : 0) : minRank;
        if (p.rank >= need) candidates.push(p);
      }
    }
  }
  candidates.sort((a, b) => b.rank - a.rank || (a.kind === "complex" ? -1 : 0) - (b.kind === "complex" ? -1 : 0));
  const boxes: number[][] = [];
  const out: Laid[] = [];
  const pad = 5;
  const tryPlace = (p: Place, force: boolean) => {
    const sx = view.ox + p.x * view.scale;
    const sy = view.oy + p.y * view.scale;
    if (sx < -200 || sy < -60 || sx > view.w + 200 || sy > view.h + 80) return;
    const size = fontSize(p);
    const w = p.name.length * size * 0.6 + (p.kind === "street" ? 10 : 34);
    const h = size + 14;
    const box = p.kind === "street" ? [sx - w / 2, sy - h / 2, sx + w / 2, sy + h / 2] : [sx - w / 2, sy - h - 10, sx + w / 2, sy - 6];
    if (!force && boxes.some((o) => box[0] < o[2] + pad && box[2] + pad > o[0] && box[1] < o[3] + pad && box[3] + pad > o[1])) return;
    boxes.push(box);
    out.push({ p, size });
  };
  if (selected && visible.has(selected.category)) tryPlace(selected, true);
  else if (selected) tryPlace(selected, true);
  for (const p of candidates) {
    if (out.length > 160) break;
    tryPlace(p, false);
  }
  return out;
}

function position(el: HTMLElement, p: Place, v: MapView) {
  const sx = v.ox + p.x * v.scale;
  const sy = v.oy + p.y * v.scale;
  el.style.transform =
    p.kind === "street"
      ? `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -50%) rotate(${p.angle ?? 0}deg)`
      : `translate3d(${sx}px, ${sy}px, 0) translate(-50%, calc(-100% - 9px))`;
}

export function LabelLayer({ bus, places, visible, selectedId, hoverId, onSelect, onHover }: Props) {
  const index = useMemo(() => buildIndex(places), [places]);
  const selected = useMemo(() => places.find((p) => p.id === selectedId), [places, selectedId]);
  const [laid, setLaid] = useState<Laid[]>([]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const state = useRef({ last: 0, scale: 0, ox: 0, oy: 0, key: "" });
  const laidRef = useRef(laid);
  useEffect(() => {
    laidRef.current = laid;
    if (bus.view) for (const l of laid) {
      const el = nodes.current.get(l.p.id);
      if (el) position(el, l.p, bus.view);
    }
  }, [laid, bus]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const relayout = (v: MapView) => {
      const next = layout(index, v, visible, selected);
      const key = next.map((l) => l.p.id).join("|");
      state.current = { last: performance.now(), scale: v.scale, ox: v.ox, oy: v.oy, key };
      if (key !== laidRef.current.map((l) => l.p.id).join("|")) setLaid(next);
    };
    const unsub = bus.subscribe((v) => {
      for (const l of laidRef.current) {
        const el = nodes.current.get(l.p.id);
        if (el) position(el, l.p, v);
      }
      const s = state.current;
      const zoomed = Math.abs(v.scale - s.scale) / (s.scale || 1) > 0.12;
      const panned = Math.hypot(v.ox - s.ox, v.oy - s.oy) > 220;
      if (zoomed || panned || performance.now() - s.last > 350) relayout(v);
      clearTimeout(timer);
      timer = setTimeout(() => bus.view && relayout(bus.view), 120);
    });
    if (bus.view) relayout(bus.view);
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [bus, index, visible, selected]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={false}>
      {laid.map(({ p, size }) => (
        <MapLabel
          key={p.id}
          place={p}
          size={size}
          active={p.id === selectedId || p.id === hoverId}
          register={(el) => {
            if (el) {
              nodes.current.set(p.id, el);
              if (bus.view) position(el, p, bus.view);
            } else nodes.current.delete(p.id);
          }}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </div>
  );
}

const MapLabel = memo(function MapLabel({
  place,
  size,
  active,
  register,
  onSelect,
  onHover,
}: {
  place: Place;
  size: number;
  active: boolean;
  register(el: HTMLElement | null): void;
  onSelect(place: Place): void;
  onHover(id: string | null): void;
}) {
  const meta = CATEGORY_META[place.category];
  if (place.kind === "street") {
    return (
      <div
        ref={register}
        className="label-in absolute left-0 top-0 whitespace-nowrap font-pixel text-[11px] uppercase tracking-[0.14em] text-[#2a2724] [text-shadow:0_0_2px_#f6eedd,0_0_3px_#f6eedd,0_0_5px_#f6eedd]"
        style={{ fontSize: size }}
      >
        {place.name}
      </div>
    );
  }
  const area = place.kind === "area" || place.kind === "complex";
  const landmark = place.category === "landmark";
  return (
    <button
      ref={register}
      type="button"
      onClick={() => onSelect(place)}
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "label-in pointer-events-auto absolute left-0 top-0 flex items-stretch whitespace-nowrap font-pixel leading-none transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9c46a]",
        area ? "text-[#201e1c]" : "",
        active && "z-20",
      )}
      style={{ fontSize: size }}
    >
      {place.kind === "complex" ? (
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-[3px] border border-[#201e1c]/25 bg-[#f1e8d2] px-1.5 py-[3px] font-semibold text-[#201e1c] shadow-[0_2px_0_rgba(0,0,0,0.22)]",
            active && "outline-2 outline-[#e9c46a]",
          )}
        >
          <span aria-hidden className="h-[0.95em] w-[3px] rounded-[1px]" style={{ background: meta.color }} />
          {place.name}
        </span>
      ) : area ? (
        <span className="px-1 py-0.5 font-semibold italic tracking-wide [text-shadow:0_0_2px_#f6eedd,0_0_2px_#f6eedd,0_0_4px_#f6eedd,0_0_8px_#f6eedd]">{place.name}</span>
      ) : (
        <span
          className={cn(
            "relative flex items-center gap-1.5 rounded-[3px] border px-1.5 py-[3px] text-[#f1e8d2] shadow-[0_2px_0_rgba(0,0,0,0.28)]",
            landmark ? "border-[#e9c46a]/60 bg-[#8c1515]" : "border-black/30 bg-[#201e1c]/92",
            active && "outline-2 outline-[#e9c46a]",
          )}
        >
          <span aria-hidden className="h-[0.95em] w-[3px] rounded-[1px]" style={{ background: landmark ? "#e9c46a" : meta.color }} />
          <span className={cn(place.rank >= 8 && "tracking-wide")}>{place.name}</span>
          <span aria-hidden className="absolute left-1/2 top-full h-[9px] w-px -translate-x-1/2 bg-[#201e1c]/60" />
        </span>
      )}
    </button>
  );
});
