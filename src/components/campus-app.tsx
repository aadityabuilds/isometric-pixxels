"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bike,
  Bus,
  Car,
  Eye,
  EyeOff,
  Footprints,
  House,
  Info,
  Layers,
  LoaderCircle,
  Map as MapIcon,
  Maximize,
  Minimize,
  Minus,
  Plus,
  RotateCw,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AboutDialog } from "@/components/chrome/about";
import { BrowseList, FilterChips, SearchBox, TourList, type TourStop } from "@/components/chrome/explore";
import { PlaceCard } from "@/components/chrome/place-card";
import { CampusMap, type CampusMapHandle } from "@/components/map/campus-map";
import type { LiveStats } from "@/components/map/live-layer";
import type { LiveWorld } from "@/lib/live/engine";
import { loadLiveWorld } from "@/lib/live/load";
import type { ScenePreset } from "@/lib/live/types";
import { DEFAULT_VISIBLE, type CampusCamera, type Category, type Place } from "@/lib/places";
import { cn } from "@/lib/utils";

interface PlacesFile {
  camera: CampusCamera;
  places: Place[];
  attribution: string;
  occlusion?: { w: number; h: number; scale: number; url: string };
}

type Status = "loading" | "ready" | "error";

const PRESETS: { id: ScenePreset; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "morning", label: "8:40 AM rush" },
  { id: "class-change", label: "Class change" },
  { id: "lunch", label: "Lunch" },
  { id: "evening", label: "Evening" },
  { id: "night", label: "Late night" },
];

const chrome = "border border-[#f1e8d2]/14 bg-[#201e1c]/94 text-[#f1e8d2] shadow-[0_8px_24px_rgba(10,9,8,0.32),0_1px_3px_rgba(10,9,8,0.38)] backdrop-blur";

export function CampusApp({ tilesUrl, camera }: { tilesUrl: string; camera: CampusCamera }) {
  const [data, setData] = useState<PlacesFile | null>(null);
  const [tour, setTour] = useState<TourStop[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<Category>>(() => new Set(DEFAULT_VISIBLE));
  const [showLabels, setShowLabels] = useState(true);
  const [live, setLive] = useState(true);
  const [preset, setPresetState] = useState<ScenePreset>("live");
  const setPreset = useCallback((p: ScenePreset) => {
    setPresetState(p);
    const url = new URL(window.location.href);
    if (p === "live") url.searchParams.delete("time");
    else url.searchParams.set("time", p);
    history.replaceState(null, "", url);
  }, []);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("time");
    if (t && PRESETS.some((p) => p.id === t)) setPresetState(t as ScenePreset);
  }, []);
  const [world, setWorld] = useState<LiveWorld | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<"tour" | "browse">("tour");
  const [about, setAbout] = useState(false);
  const [focus, setFocus] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const mapRef = useRef<CampusMapHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const placesRef = useRef<Place[]>([]);

  useEffect(() => {
    fetch("/data/places.json")
      .then((r) => {
        if (!r.ok) throw new Error(`places.json returned ${r.status}`);
        return r.json();
      })
      .then((d: PlacesFile) => {
        placesRef.current = d.places;
        setData(d);
      })
      .catch((e) => {
        setError(String(e.message || e));
        setStatus("error");
      });
    fetch("/data/tour.json")
      .then((r) => (r.ok ? r.json() : []))
      .then(setTour)
      .catch(() => setTour([]));
  }, []);

  const places = useMemo(() => data?.places ?? [], [data]);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const tourIndex = selected ? tour.findIndex((t) => t.id === selected.id) : -1;

  const select = useCallback((place: Place | null, fly = true) => {
    setSelectedId(place?.id ?? null);
    if (place) {
      setVisible((v) => (v.has(place.category) ? v : new Set([...v, place.category])));
      if (fly) mapRef.current?.flyTo(place);
      history.replaceState(null, "", `${window.location.search}#${place.id}`);
    }
  }, []);

  const stepTour = useCallback(
    (delta: number) => {
      if (!tour.length) return;
      const i = tourIndex < 0 ? 0 : (tourIndex + delta + tour.length) % tour.length;
      const p = byId.get(tour[i].id);
      if (p) select(p);
    },
    [tour, tourIndex, byId, select],
  );

  const onReady = useCallback(() => {
    setStatus("ready");
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash.startsWith("@")) mapRef.current?.applyViewHash(hash, true);
    else if (hash) {
      const tryOpen = (n: number) => {
        const p = placesRef.current.find((x) => x.id === hash);
        if (p) setTimeout(() => select(p), 250);
        else if (n > 0) setTimeout(() => tryOpen(n - 1), 300);
      };
      tryOpen(10);
    }
  }, [select]);

  // The live layer loads after the map is on screen, so it never delays first paint.
  useEffect(() => {
    if (status !== "ready" || !data || world) return;
    const start = () =>
      loadLiveWorld(
        data.occlusion,
        ["main-quad", "white-plaza", "engineering-quad", "the-oval", "green-library", "tresidder-memorial-union"]
          .map((id) => data.places.find((p) => p.id === id))
          .filter((p): p is Place => !!p),
      )
        .then(setWorld)
        .catch((e) => console.warn("Live layer unavailable:", e));
    const timer = setTimeout(start, 600);
    return () => clearTimeout(timer);
  }, [status, data, world]);

  const share = useCallback(async () => {
    const hash = selected ? selected.id : (mapRef.current?.viewHash() ?? "");
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", { description: selected ? selected.name : "This exact view of the map" });
    } catch {
      toast("Copy failed", { description: "Long-press the address bar to copy instead." });
    }
  }, [selected]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }, []);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === "/") {
        e.preventDefault();
        setFocus(false);
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === "Escape") {
        if (selectedId) select(null, false);
        else setPanel(false);
      } else if (e.key === "+" || e.key === "=") mapRef.current?.zoomBy(1.5);
      else if (e.key === "-" || e.key === "_") mapRef.current?.zoomBy(1 / 1.5);
      else if (e.key === "0") mapRef.current?.home();
      else if (k === "n") setShowLabels((s) => !s);
      else if (k === "t") setLive((s) => !s);
      else if (k === "p") setPanel((s) => !s);
      else if (k === "f") toggleFullscreen();
      else if (k === "h") setFocus((s) => !s);
      else if (e.key === "?") setAbout(true);
      else if (e.key === "ArrowRight" && tourIndex >= 0) stepTour(1);
      else if (e.key === "ArrowLeft" && tourIndex >= 0) stepTour(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, selectedId, toggleFullscreen, tourIndex, stepTour]);

  const toggleCategory = (c: Category) =>
    setVisible((v) => {
      const next = new Set(v);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const onIdle = useCallback(() => {
    if (!selectedId) {
      const h = mapRef.current?.viewHash();
      if (h) history.replaceState(null, "", `${window.location.search}#${h}`);
    }
  }, [selectedId]);

  const panelBody = data && (
    <Tabs value={panelTab} onValueChange={(v) => setPanelTab(v as "tour" | "browse")} className="flex min-h-0 flex-1 flex-col">
      <TabsList className="w-full bg-[#2a2724]">
        <TabsTrigger value="tour" className="flex-1 text-[#f1e8d2]/70 data-active:bg-[#f1e8d2] data-active:text-[#201e1c]">
          Tour
        </TabsTrigger>
        <TabsTrigger value="browse" className="flex-1 text-[#f1e8d2]/70 data-active:bg-[#f1e8d2] data-active:text-[#201e1c]">
          Browse
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tour" className="flex min-h-0 flex-1 flex-col">
        {tour.length ? (
          <TourList
            tour={tour}
            activeId={selectedId}
            onOpen={(s) => {
              const p = byId.get(s.id);
              if (p) select(p);
            }}
          />
        ) : (
          <p className="p-2 text-sm text-[#f1e8d2]/60">The tour is loading…</p>
        )}
      </TabsContent>
      <TabsContent value="browse" className="flex min-h-0 flex-1 flex-col">
        <BrowseList places={places} onSelect={(p) => select(p)} />
      </TabsContent>
    </Tabs>
  );

  return (
    <TooltipProvider delay={250}>
      <main className="relative h-dvh w-full overflow-hidden bg-[#cfc9bc] text-[#201e1c]">
        <CampusMap
          ref={mapRef}
          tilesUrl={tilesUrl}
          imageWidth={camera.width}
          places={places}
          visible={visible}
          showLabels={showLabels && !!data}
          world={world}
          liveEnabled={live}
          preset={preset}
          selectedId={selectedId}
          onSelect={(p) => (p ? select(p, false) : setSelectedId(null))}
          onReady={onReady}
          onError={(m) => {
            setError(m);
            setStatus("error");
          }}
          onStats={setStats}
          onIdle={onIdle}
        />

        {!focus && (
          <>
            <header className={cn("absolute left-3 right-3 top-3 z-30 rounded-lg p-2 sm:right-auto sm:w-[380px]", chrome)}>
              <div className="flex items-center gap-2.5">
                <PixelMark />
                <div className="min-w-0 flex-1">
                  <h1 className="font-pixel text-[17px] leading-none text-[#f1e8d2]">Pixel Stanford</h1>
                  <p className="mt-0.5 truncate text-[11px] text-[#f1e8d2]/50">An isometric map of campus, drawn from open data</p>
                </div>
                <button
                  onClick={() => setPanel((s) => !s)}
                  className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition sm:hidden", panel ? "border-[#e9c46a]/70 bg-[#3a3530]" : "border-[#f1e8d2]/15")}
                >
                  <MapIcon className="size-3.5" />
                  Places
                </button>
              </div>
              {data && <SearchBox places={places} onSelect={(p) => select(p)} inputRef={searchRef} className="mt-2" />}
            </header>

            <LiveChip stats={stats} preset={preset} live={live} />

            {panel && data && (
              <aside className={cn("absolute bottom-3 left-3 top-[118px] z-20 hidden w-[380px] flex-col rounded-lg p-3 sm:flex", chrome)}>{panelBody}</aside>
            )}

            <nav
              aria-label="Map tools"
              className={cn(
                "absolute z-30 flex gap-0.5 rounded-lg p-1",
                chrome,
                "bottom-3 left-1/2 -translate-x-1/2 flex-row sm:bottom-auto sm:left-auto sm:right-3 sm:top-1/2 sm:-translate-y-1/2 sm:translate-x-0 sm:flex-col",
              )}
            >
              <Tool label="Zoom in" shortcut="+" onClick={() => mapRef.current?.zoomBy(1.6)} className="max-sm:hidden">
                <Plus />
              </Tool>
              <Tool label="Zoom out" shortcut="−" onClick={() => mapRef.current?.zoomBy(1 / 1.6)} className="max-sm:hidden">
                <Minus />
              </Tool>
              <Tool label="Whole campus" shortcut="0" onClick={() => mapRef.current?.home()}>
                <House />
              </Tool>
              <Divider />
              <Tool label="Places & tour" shortcut="P" active={panel} onClick={() => setPanel((s) => !s)} className="max-sm:hidden">
                <MapIcon />
              </Tool>
              <Popover>
                <Tooltip>
                  <TooltipTrigger render={<PopoverTrigger render={<ToolButton aria-label="Layers and time of day" />} />}>
                    <Layers />
                  </TooltipTrigger>
                  <TooltipContent side="left">Layers and time of day</TooltipContent>
                </Tooltip>
                <PopoverContent side="left" align="center" className={cn("w-[300px] p-3", chrome)}>
                  <LayersPanel
                    showLabels={showLabels}
                    setShowLabels={setShowLabels}
                    live={live}
                    setLive={setLive}
                    preset={preset}
                    setPreset={setPreset}
                    visible={visible}
                    toggle={toggleCategory}
                    loading={!world}
                  />
                </PopoverContent>
              </Popover>
              <Tool label="Share this view" onClick={share}>
                <Share2 />
              </Tool>
              <Tool label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F" onClick={toggleFullscreen} className="max-sm:hidden">
                {fullscreen ? <Minimize /> : <Maximize />}
              </Tool>
              <Tool label="About this map" shortcut="?" onClick={() => setAbout(true)}>
                <Info />
              </Tool>
              <Divider />
              <Tool label="Hide tools" shortcut="H" onClick={() => setFocus(true)}>
                <EyeOff />
              </Tool>
            </nav>

            {selected && data && (
              <div className="pointer-events-none absolute inset-x-3 bottom-16 z-30 sm:bottom-auto sm:left-auto sm:right-[64px] sm:top-[60px]">
                <PlaceCard
                  place={selected}
                  places={places}
                  pxPerM={camera.pxPerM}
                  tourStop={tourIndex >= 0 ? tour[tourIndex] : undefined}
                  tourIndex={tourIndex}
                  tourLength={tour.length}
                  onTourStep={stepTour}
                  onSelect={(p) => select(p)}
                  onShare={share}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}

            {data && <p className="pointer-events-none absolute bottom-1 right-3 z-10 hidden text-[10px] text-[#201e1c]/60 sm:block">{data.attribution}</p>}
          </>
        )}

        {focus && (
          <button onClick={() => setFocus(false)} className={cn("absolute bottom-3 right-3 z-30 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs", chrome)}>
            <Eye className="size-3.5" />
            Show tools
          </button>
        )}

        <Sheet open={narrow && panel && !focus} onOpenChange={setPanel}>
          <SheetContent side="bottom" className="h-[74dvh] rounded-t-xl border-[#f1e8d2]/14 bg-[#201e1c] px-3 pb-3 text-[#f1e8d2] sm:hidden">
            <SheetTitle className="px-1 pt-3 font-pixel text-lg text-[#f1e8d2]">Places on this map</SheetTitle>
            {panelBody}
          </SheetContent>
        </Sheet>

        <AboutDialog open={about} onOpenChange={setAbout} attribution={data?.attribution ?? ""} />

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-40 flex justify-center">
            <div className={cn("flex items-center gap-2.5 rounded-lg px-4 py-3", chrome)}>
              <LoaderCircle className="size-4 animate-spin text-[#e9c46a]" />
              <span className="font-pixel text-sm">Unfolding campus…</span>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 z-50 grid place-items-center bg-[#cfc9bc]/90 p-6">
            <div className={cn("max-w-sm rounded-lg p-5 text-center", chrome)}>
              <p className="font-pixel text-lg">The map didn’t load</p>
              <p className="mt-1 text-sm text-[#f1e8d2]/70">{error ?? "Something went wrong while loading map tiles."}</p>
              <button onClick={() => window.location.reload()} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#e9c46a] px-3 py-1.5 text-sm text-[#201e1c]">
                <RotateCw className="size-4" />
                Try again
              </button>
            </div>
          </div>
        )}
        <Toaster theme="dark" position="bottom-center" />
      </main>
    </TooltipProvider>
  );
}

function LiveChip({ stats, preset, live }: { stats: LiveStats | null; preset: ScenePreset; live: boolean }) {
  if (!stats || !live) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <div className={cn("pointer-events-none absolute right-3 top-3 z-20 hidden items-center gap-3 rounded-lg px-3 py-2 text-xs sm:flex", chrome)}>
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", preset === "live" ? "animate-pulse bg-[#e9573e]" : "bg-[#e9c46a]")} />
        <span className="font-mono text-[11px] text-[#f1e8d2]/70">{preset === "live" ? "LIVE" : "REPLAY"}</span>
        <span className="font-pixel text-[13px]">{stats.label}</span>
      </span>
      <Count icon={<Footprints className="size-3.5" />} value={n(stats.students)} label="students walking" />
      <Count icon={<Bike className="size-3.5" />} value={n(stats.bikes)} label="bikes" />
      <Count icon={<Car className="size-3.5" />} value={n(stats.cars)} label="cars" />
      <Count icon={<Bus className="size-3.5" />} value={n(stats.shuttles)} label="Marguerite shuttles running" />
    </div>
  );
}

function Count({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[#f1e8d2]/80" title={label}>
      {icon}
      <span className="font-mono text-[11px]">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function LayersPanel(props: {
  showLabels: boolean;
  setShowLabels(v: boolean): void;
  live: boolean;
  setLive(v: boolean): void;
  preset: ScenePreset;
  setPreset(p: ScenePreset): void;
  visible: Set<Category>;
  toggle(c: Category): void;
  loading: boolean;
}) {
  return (
    <div className="space-y-3 text-[#f1e8d2]">
      <Row label="Place and street names" hint="N" checked={props.showLabels} onChange={props.setShowLabels} />
      <Row label="People, bikes and traffic" hint="T" checked={props.live} onChange={props.setLive} note={props.loading ? "Loading…" : undefined} />
      <div>
        <p className="mb-1.5 font-pixel text-[11px] uppercase tracking-[0.12em] text-[#e9c46a]">Time of day</p>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => props.setPreset(p.id)}
              className={cn(
                "rounded-[4px] border px-1.5 py-1 text-[11px] transition",
                props.preset === p.id ? "border-[#e9c46a] bg-[#e9c46a] text-[#201e1c]" : "border-[#f1e8d2]/15 text-[#f1e8d2]/75 hover:bg-[#3a3530]",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 font-pixel text-[11px] uppercase tracking-[0.12em] text-[#e9c46a]">Labels to show</p>
        <FilterChips visible={props.visible} onToggle={props.toggle} />
      </div>
    </div>
  );
}

function Row({ label, hint, checked, onChange, note }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void; note?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>
        {label} <kbd className="ml-1 rounded border border-[#f1e8d2]/20 px-1 font-mono text-[10px] text-[#f1e8d2]/50">{hint}</kbd>
        {note && <span className="ml-2 text-xs text-[#f1e8d2]/45">{note}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ToolButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "grid size-9 place-items-center rounded-md text-[#f1e8d2]/85 transition hover:bg-[#3a3530] hover:text-[#f1e8d2] focus-visible:outline-2 focus-visible:outline-[#e9c46a] [&_svg]:size-[18px]",
        className,
      )}
    />
  );
}

function Tool({ label, shortcut, onClick, active, className, children }: { label: string; shortcut?: string; onClick(): void; active?: boolean; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<ToolButton aria-label={label} aria-pressed={active} onClick={onClick} className={cn(active && "bg-[#3a3530] text-[#e9c46a]", className)} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="left">
        {label}
        {shortcut && <kbd className="ml-2 rounded border border-current/30 px-1 font-mono text-[10px]">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <span aria-hidden className="m-1 bg-[#f1e8d2]/12 max-sm:w-px sm:h-px" />;
}

function PixelMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-8 shrink-0" shapeRendering="crispEdges" aria-hidden>
      <rect x="0" y="0" width="16" height="16" rx="2" fill="#8c1515" />
      <rect x="7" y="2" width="2" height="9" fill="#f1e8d2" />
      <rect x="6" y="4" width="4" height="2" fill="#f1e8d2" />
      <rect x="3" y="9" width="10" height="2" fill="#f1e8d2" />
      <rect x="4" y="11" width="2" height="3" fill="#f1e8d2" />
      <rect x="10" y="11" width="2" height="3" fill="#f1e8d2" />
      <rect x="7" y="11" width="2" height="3" fill="#e9c46a" />
    </svg>
  );
}
