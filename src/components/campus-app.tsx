"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compass, House, List, LoaderCircle, Minus, Plus, RotateCw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CampusMap, type CampusMapHandle } from "@/components/campus-map";
import { BrowseList, FilterChips, SearchBox } from "@/components/explore-panel";
import { PlaceCard } from "@/components/place-card";
import { DEFAULT_VISIBLE, type CampusData, type Category, type Place } from "@/lib/places";

type Status = "loading" | "ready" | "error";

export function CampusApp() {
  const [data, setData] = useState<CampusData | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<Category>>(() => new Set(DEFAULT_VISIBLE));
  const [showLabels, setShowLabels] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const mapRef = useRef<CampusMapHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/data/places.json")
      .then((r) => {
        if (!r.ok) throw new Error(`places.json returned ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        setError(String(e.message || e));
        setStatus("error");
      });
  }, []);

  const byId = useMemo(() => new Map((data?.places ?? []).map((p) => [p.id, p])), [data]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const select = useCallback((place: Place | null, fly = true) => {
    setSelectedId(place?.id ?? null);
    if (place) {
      setVisible((v) => (v.has(place.category) ? v : new Set([...v, place.category])));
      if (fly) mapRef.current?.flyTo(place);
      history.replaceState(null, "", `#${place.id}`);
    } else {
      history.replaceState(null, "", window.location.pathname);
    }
    setBrowseOpen(false);
  }, []);

  const onReady = useCallback(() => {
    setStatus("ready");
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) {
      const p = byId.get(id);
      if (p) setTimeout(() => select(p), 300);
    }
  }, [byId, select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") select(null, false);
      else if (e.key === "+" || e.key === "=") mapRef.current?.zoomBy(1.5);
      else if (e.key === "-" || e.key === "_") mapRef.current?.zoomBy(1 / 1.5);
      else if (e.key === "0") mapRef.current?.home();
      else if (e.key.toLowerCase() === "l") setShowLabels((s) => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const toggle = (c: Category) =>
    setVisible((v) => {
      const next = new Set(v);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const northRotation = useMemo(() => {
    if (!data) return 0;
    const b = (data.camera.bearing * Math.PI) / 180;
    const e = (data.camera.elevation * Math.PI) / 180;
    const sx = -Math.sin(b);
    const sy = -Math.sin(e) * Math.cos(b);
    return (Math.atan2(sx, -sy) * 180) / Math.PI;
  }, [data]);

  return (
    <TooltipProvider>
      <main className="relative h-dvh w-full overflow-hidden bg-[#efe7d6] text-stone-900">
        <div
          aria-hidden
          className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(120,100,70,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(120,100,70,0.08)_1px,transparent_1px)] [background-size:24px_24px]"
        />

        {data && (
          <CampusMap
            ref={mapRef}
            places={data.places}
            imageWidth={data.camera.width}
            visible={visible}
            showLabels={showLabels}
            selectedId={selectedId}
            onSelect={(p) => select(p, false)}
            onReady={onReady}
            onError={(m) => {
              setError(m);
              setStatus("error");
            }}
          />
        )}

        {/* Desktop panel */}
        <aside className="pointer-events-none absolute inset-y-4 left-4 z-20 hidden w-[340px] flex-col sm:flex">
          <div className="pointer-events-auto flex max-h-full min-h-0 flex-col rounded-xl border border-stone-900/10 bg-[#fffaf0]/95 p-4 shadow-[0_6px_0_rgba(0,0,0,0.1),0_18px_40px_-16px_rgba(0,0,0,0.35)] backdrop-blur">
            <Brand />
            {data && (
              <>
                <SearchBox places={data.places} onSelect={(p) => select(p)} inputRef={searchRef} className="mt-4" />
                <p className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-stone-500">Show on map</p>
                <FilterChips visible={visible} onToggle={toggle} />
                <p className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-stone-500">Browse</p>
                <div className="flex h-[38vh] min-h-[220px] flex-col">
                  <BrowseList places={data.places} onSelect={(p) => select(p)} />
                </div>
                <Attribution text={data.attribution} />
              </>
            )}
          </div>
        </aside>

        {/* Mobile header */}
        <div className="absolute inset-x-2 top-2 z-20 flex flex-col gap-2 sm:hidden">
          <div className="rounded-xl border border-stone-900/10 bg-[#fffaf0]/95 p-3 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <Brand compact />
              {data && (
                <Sheet open={browseOpen} onOpenChange={setBrowseOpen}>
                  <SheetTrigger render={<Button variant="outline" size="sm" />}>
                    <List />
                    Browse
                  </SheetTrigger>
                  <SheetContent side="bottom" className="h-[78dvh] rounded-t-2xl bg-[#fffaf0] px-4 pb-4">
                    <SheetHeader className="px-0 pb-0">
                      <SheetTitle className="font-pixel text-lg">Explore campus</SheetTitle>
                    </SheetHeader>
                    <FilterChips visible={visible} onToggle={toggle} className="flex-nowrap overflow-x-auto pb-1 [scrollbar-width:none]" />
                    <BrowseList places={data.places} onSelect={(p) => select(p)} />
                  </SheetContent>
                </Sheet>
              )}
            </div>
            {data && <SearchBox places={data.places} onSelect={(p) => select(p)} className="mt-3" />}
          </div>
        </div>

        {/* Selected place */}
        {selected && data && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4">
            <PlaceCard
              place={selected}
              places={data.places}
              pxPerM={data.camera.pxPerM}
              onSelect={(p) => select(p)}
              onClose={() => select(null, false)}
            />
          </div>
        )}

        {/* Map controls */}
        <div className={`absolute right-4 z-20 flex flex-col items-end gap-2 ${selected ? "max-sm:hidden" : ""} bottom-4`}>
          <div className="flex items-center gap-2 rounded-lg border border-stone-900/10 bg-[#fffaf0]/95 px-2.5 py-1.5 shadow-[0_2px_0_rgba(0,0,0,0.1)]">
            <Tag className="size-3.5 text-stone-500" />
            <label htmlFor="labels" className="text-xs font-medium text-stone-700">Labels</label>
            <Switch id="labels" checked={showLabels} onCheckedChange={setShowLabels} />
          </div>
          <div className="flex flex-col overflow-hidden rounded-lg border border-stone-900/10 bg-[#fffaf0]/95 shadow-[0_2px_0_rgba(0,0,0,0.1)]">
            <ControlButton label="Zoom in (+)" onClick={() => mapRef.current?.zoomBy(1.6)}>
              <Plus />
            </ControlButton>
            <ControlButton label="Zoom out (−)" onClick={() => mapRef.current?.zoomBy(1 / 1.6)}>
              <Minus />
            </ControlButton>
            <ControlButton label="Whole campus (0)" onClick={() => mapRef.current?.home()}>
              <House />
            </ControlButton>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="grid size-11 place-items-center rounded-full border border-stone-900/10 bg-[#fffaf0]/95 shadow-[0_2px_0_rgba(0,0,0,0.1)]" />
              }
            >
              <div className="relative grid size-8 place-items-center" style={{ transform: `rotate(${northRotation}deg)` }}>
                <Compass className="size-5 text-stone-400" />
                <span className="absolute -top-1.5 font-pixel text-[10px] font-bold text-[#8c1515]">N</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">North points this way. The camera looks down Palm Drive toward the Main Quad.</TooltipContent>
          </Tooltip>
        </div>

        {data && (
          <div className="absolute inset-x-0 bottom-1 z-10 text-center text-[10px] text-stone-500 sm:hidden">{data.attribution}</div>
        )}

        {status === "loading" && (
          <div className="absolute inset-0 z-40 grid place-items-center bg-[#efe7d6]/80 backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-xl border border-stone-900/10 bg-[#fffaf0] px-5 py-4 shadow-xl">
              <LoaderCircle className="size-5 animate-spin text-[#8c1515]" />
              <div>
                <p className="font-pixel text-base">Unfolding campus…</p>
                <p className="text-xs text-stone-500">Loading 2,000 buildings and 57,000 trees</p>
              </div>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 z-40 grid place-items-center bg-[#efe7d6]/90 p-6">
            <div className="max-w-sm rounded-xl border border-stone-900/10 bg-[#fffaf0] p-5 text-center shadow-xl">
              <p className="font-pixel text-lg">The map didn’t load</p>
              <p className="mt-1 text-sm text-stone-600">{error ?? "Something went wrong while loading map tiles."}</p>
              <Button className="mt-4" onClick={() => window.location.reload()}>
                <RotateCw />
                Try again
              </Button>
            </div>
          </div>
        )}
      </main>
    </TooltipProvider>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <PixelMark />
      <div>
        <h1 className="font-pixel text-xl leading-none text-[#8c1515]">Pixel Stanford</h1>
        {!compact && <p className="mt-1 text-xs text-stone-500">An isometric map of campus, built from open data</p>}
      </div>
    </div>
  );
}

function PixelMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-9 shrink-0" shapeRendering="crispEdges" aria-hidden>
      <rect x="0" y="0" width="16" height="16" rx="2" fill="#8c1515" />
      <rect x="7" y="2" width="2" height="9" fill="#f5e6c8" />
      <rect x="6" y="4" width="4" height="2" fill="#f5e6c8" />
      <rect x="3" y="9" width="10" height="2" fill="#f5e6c8" />
      <rect x="4" y="11" width="2" height="3" fill="#f5e6c8" />
      <rect x="10" y="11" width="2" height="3" fill="#f5e6c8" />
      <rect x="7" y="11" width="2" height="3" fill="#f5e6c8" />
    </svg>
  );
}

function ControlButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className="rounded-none" onClick={onClick} aria-label={label} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

function Attribution({ text }: { text: string }) {
  return <p className="mt-3 border-t border-stone-900/10 pt-2 text-[10px] leading-snug text-stone-500">{text}</p>;
}
