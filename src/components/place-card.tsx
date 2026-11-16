"use client";

import { useState } from "react";
import { Check, ExternalLink, Link as LinkIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CATEGORY_META, distance, type Place } from "@/lib/places";

interface Props {
  place: Place;
  places: Place[];
  pxPerM: number;
  onSelect(place: Place): void;
  onClose(): void;
}

export function PlaceCard({ place, places, pxPerM, onSelect, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const meta = CATEGORY_META[place.category];
  const Icon = meta.icon;
  const [lon, lat] = place.lonlat;

  const siblings = place.group
    ? places.filter((p) => p.group === place.group && p.id !== place.id && p.kind === "building").slice(0, 12)
    : place.kind === "complex"
      ? places.filter((p) => p.group === place.name && p.kind === "building").slice(0, 16)
      : [];
  const nearbyFood = places
    .filter((p) => p.category === "dining" && p.id !== place.id && p.kind !== "street")
    .map((p) => ({ p, d: distance(p, place) }))
    .filter((x) => x.d < 260 * pxPerM)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#${place.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="pointer-events-auto w-full rounded-xl border border-stone-900/10 bg-[#fffaf0]/97 p-4 shadow-[0_6px_0_rgba(0,0,0,0.12),0_18px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur sm:w-[340px]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md text-white shadow-[0_2px_0_rgba(0,0,0,0.2)]" style={{ background: meta.color }}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-pixel text-lg leading-tight text-stone-900">{place.name}</h2>
          {place.group && place.group !== place.name && <p className="text-sm text-stone-600">{place.group}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-stone-900/5">{meta.label}</Badge>
            {place.bldgId && <Badge variant="outline">Bldg {place.bldgId}</Badge>}
            {place.height ? <Badge variant="outline">~{Math.round(place.height)} m tall</Badge> : null}
            {place.kind === "complex" && place.count ? <Badge variant="outline">{place.count} buildings</Badge> : null}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>

      {place.official && place.official !== place.name && (
        <p className="mt-3 text-xs text-stone-500">
          Official name: <span className="text-stone-700">{place.official}</span>
        </p>
      )}

      {siblings.length > 0 && (
        <>
          <Separator className="my-3" />
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
            {place.kind === "complex" ? "Buildings here" : `Also in ${place.group}`}
          </p>
          <div className="flex flex-wrap gap-1">
            {siblings.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s)}
                className="rounded-md border border-stone-900/10 bg-white px-2 py-0.5 text-xs text-stone-700 transition hover:border-[#8c1515]/40 hover:text-[#8c1515]"
              >
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}

      {nearbyFood.length > 0 && (
        <>
          <Separator className="my-3" />
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Food nearby</p>
          <ul className="space-y-1">
            {nearbyFood.map(({ p, d }) => (
              <li key={p.id}>
                <button onClick={() => onSelect(p)} className="flex w-full items-center justify-between gap-2 text-left text-sm text-stone-700 hover:text-[#8c1515]">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-xs text-stone-400">{Math.max(10, Math.round(d / pxPerM / 10) * 10)} m</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Separator className="my-3" />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check /> : <LinkIcon />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink />
          Open in Maps
        </Button>
      </div>
    </div>
  );
}
