"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Link as LinkIcon, X } from "lucide-react";
import { CATEGORY_META, distance, type Place } from "@/lib/places";
import type { TourStop } from "./explore";

interface Props {
  place: Place;
  places: Place[];
  pxPerM: number;
  tourStop?: TourStop;
  tourIndex: number;
  tourLength: number;
  onTourStep(delta: number): void;
  onSelect(place: Place): void;
  onShare(): void;
  onClose(): void;
}

export function PlaceCard({ place, places, pxPerM, tourStop, tourIndex, tourLength, onTourStep, onSelect, onShare, onClose }: Props) {
  const meta = CATEGORY_META[place.category];
  const Icon = meta.icon;
  const [lon, lat] = place.lonlat;
  const siblings = place.group
    ? places.filter((p) => p.group === place.group && p.id !== place.id && p.kind === "building").slice(0, 12)
    : place.kind === "complex"
      ? places.filter((p) => p.group === place.name && p.kind === "building").slice(0, 16)
      : [];
  const food = places
    .filter((p) => p.category === "dining" && p.id !== place.id)
    .map((p) => ({ p, d: distance(p, place) }))
    .filter((x) => x.d < 260 * pxPerM)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  return (
    <article className="pointer-events-auto max-h-[62dvh] w-full overflow-y-auto rounded-lg border border-[#f1e8d2]/14 bg-[#201e1c]/96 text-[#f1e8d2] shadow-[0_8px_24px_rgba(10,9,8,0.32),0_1px_3px_rgba(10,9,8,0.38)] backdrop-blur sm:w-[360px]">
      {tourStop && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tourStop.image} alt={`${tourStop.title} on the map`} className="h-28 w-full object-cover [image-rendering:pixelated] sm:h-40" />
          <span className="absolute left-2 top-2 rounded-[3px] bg-[#201e1c]/85 px-1.5 py-0.5 font-mono text-[10px] text-[#e9c46a]">
            STOP {tourIndex + 1} / {tourLength}
          </span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[4px]" style={{ background: meta.color }}>
            <Icon className="size-4 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-pixel text-lg leading-tight">{tourStop?.title ?? place.name}</h2>
            <p className="text-xs text-[#f1e8d2]/55">
              {[place.group && place.group !== place.name ? place.group : null, meta.label, place.bldgId ? `Bldg ${place.bldgId}` : null, place.height ? `~${Math.round(place.height)} m tall` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-[#f1e8d2]/50 hover:bg-[#3a3530] hover:text-[#f1e8d2]">
            <X className="size-4" />
          </button>
        </div>

        {tourStop && <p className="mt-3 text-sm leading-relaxed text-[#f1e8d2]/85">{tourStop.blurb}</p>}
        {place.official && place.official !== place.name && <p className="mt-2 text-xs text-[#f1e8d2]/45">Official name: {place.official}</p>}

        {siblings.length > 0 && (
          <section className="mt-3 border-t border-[#f1e8d2]/10 pt-3">
            <h3 className="mb-1.5 font-pixel text-[11px] uppercase tracking-[0.12em] text-[#e9c46a]">{place.kind === "complex" ? "Buildings here" : `Also in ${place.group}`}</h3>
            <div className="flex flex-wrap gap-1">
              {siblings.map((s) => (
                <button key={s.id} onClick={() => onSelect(s)} className="rounded-[3px] border border-[#f1e8d2]/15 px-1.5 py-0.5 text-xs text-[#f1e8d2]/80 hover:border-[#e9c46a]/60 hover:text-[#f1e8d2]">
                  {s.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {food.length > 0 && (
          <section className="mt-3 border-t border-[#f1e8d2]/10 pt-3">
            <h3 className="mb-1.5 font-pixel text-[11px] uppercase tracking-[0.12em] text-[#e9c46a]">Food nearby</h3>
            <ul className="space-y-1">
              {food.map(({ p, d }) => (
                <li key={p.id}>
                  <button onClick={() => onSelect(p)} className="flex w-full items-center justify-between gap-2 text-left text-sm text-[#f1e8d2]/85 hover:text-[#f1e8d2]">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-[#f1e8d2]/40">{Math.max(10, Math.round(d / pxPerM / 10) * 10)} m</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={onShare} className="flex items-center gap-1.5 rounded-[4px] border border-[#f1e8d2]/15 px-2 py-1 text-xs hover:bg-[#3a3530]">
            <LinkIcon className="size-3.5" />
            Copy link
          </button>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-[4px] border border-[#f1e8d2]/15 px-2 py-1 text-xs hover:bg-[#3a3530]"
          >
            <ExternalLink className="size-3.5" />
            Open in Maps
          </a>
          {tourStop && (
            <div className="ml-auto flex gap-1">
              <button onClick={() => onTourStep(-1)} aria-label="Earlier stop" className="rounded-[4px] border border-[#f1e8d2]/15 p-1 hover:bg-[#3a3530]">
                <ChevronLeft className="size-4" />
              </button>
              <button onClick={() => onTourStep(1)} aria-label="Next stop" className="rounded-[4px] border border-[#e9c46a]/50 bg-[#e9c46a] p-1 text-[#201e1c] hover:brightness-110">
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
