"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type OpenSeadragon from "openseadragon";
import { CATEGORY_META, pointInPolygon, type Category, type Place } from "@/lib/places";
import { cn } from "@/lib/utils";

export interface CampusMapHandle {
  flyTo(place: Place, zoom?: number): void;
  zoomBy(factor: number): void;
  home(): void;
}

interface Props {
  places: Place[];
  imageWidth: number;
  visible: Set<Category>;
  showLabels: boolean;
  selectedId: string | null;
  onSelect(place: Place | null): void;
  onReady(): void;
  onError(message: string): void;
  ref?: Ref<CampusMapHandle>;
}

interface View {
  ox: number;
  oy: number;
  scale: number;
  w: number;
  h: number;
}

const FONT = { big: 15, mid: 13, small: 12 };

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

function labelSize(p: Place) {
  if (p.kind === "street") return FONT.small;
  if (p.rank >= 8) return FONT.big;
  if (p.rank >= 5) return FONT.mid;
  return FONT.small;
}

function layoutLabels(places: Place[], view: View, visible: Set<Category>, selectedId: string | null) {
  const minRank = minRankFor(view.scale);
  const boxes: [number, number, number, number][] = [];
  const out: { p: Place; sx: number; sy: number; size: number }[] = [];
  const pad = 4;
  const fits = (b: [number, number, number, number]) =>
    !boxes.some((o) => b[0] < o[2] + pad && b[2] + pad > o[0] && b[1] < o[3] + pad && b[3] + pad > o[1]);

  const consider = (p: Place, force: boolean) => {
    const sx = view.ox + p.x * view.scale;
    const sy = view.oy + p.y * view.scale;
    if (sx < -200 || sy < -60 || sx > view.w + 200 || sy > view.h + 60) return;
    const size = labelSize(p);
    const width = p.name.length * size * 0.56 + (p.kind === "street" ? 8 : 30);
    const height = size + 12;
    const box: [number, number, number, number] =
      p.kind === "street"
        ? [sx - width / 2, sy - height / 2, sx + width / 2, sy + height / 2]
        : [sx - width / 2, sy - height - 8, sx + width / 2, sy - 4];
    if (!force && !fits(box)) return;
    boxes.push(box);
    out.push({ p, sx, sy, size });
  };

  const selected = selectedId ? places.find((p) => p.id === selectedId) : undefined;
  if (selected) consider(selected, true);
  for (const p of places) {
    if (p === selected || !visible.has(p.category)) continue;
    if (p.kind === "complex" && view.scale > 1.1) continue;
    const need = p.kind === "street" ? Math.max(minRank, 3) + (view.scale < 0.45 ? 1 : 0) : minRank;
    if (p.rank < need) continue;
    consider(p, false);
  }
  return out;
}

export function CampusMap({ places, imageWidth, visible, showLabels, selectedId, onSelect, onReady, onError, ref }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const osdRef = useRef<typeof OpenSeadragon | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const callbacks = useRef({ onSelect, onReady, onError });
  useEffect(() => {
    callbacks.current = { onSelect, onReady, onError };
  });

  const sorted = useMemo(
    () =>
      [...places].sort((a, b) => b.rank - a.rank || (a.kind === "complex" ? -1 : 0) - (b.kind === "complex" ? -1 : 0)),
    [places],
  );
  const hitTargets = useMemo(
    () =>
      places
        .filter((p) => p.outline && p.outline.length > 2)
        .map((p) => {
          const xs = p.outline!.map((q) => q[0]);
          const ys = p.outline!.map((q) => q[1]);
          const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
          return { p, bbox, area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) };
        })
        .sort((a, b) => a.area - b.area),
    [places],
  );
  const hitRef = useRef(hitTargets);
  useEffect(() => {
    hitRef.current = hitTargets;
  }, [hitTargets]);

  useEffect(() => {
    let destroyed = false;
    let frame = 0;
    (async () => {
      const OSD = (await import("openseadragon")).default;
      if (destroyed || !container.current) return;
      osdRef.current = OSD;
      const viewer = OSD({
        element: container.current,
        tileSources: "/tiles/campus.dzi",
        showNavigationControl: false,
        imageSmoothingEnabled: false,
        maxZoomPixelRatio: 3,
        minZoomImageRatio: 0.7,
        visibilityRatio: 0.5,
        constrainDuringPan: true,
        animationTime: 0.9,
        springStiffness: 9,
        blendTime: 0.15,
        immediateRender: false,
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
        gestureSettingsTouch: { pinchRotate: false },
        crossOriginPolicy: false,
      });
      viewerRef.current = viewer;

      const update = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const vp = viewer.viewport;
          const a = vp.imageToViewerElementCoordinates(new OSD.Point(0, 0));
          const b = vp.imageToViewerElementCoordinates(new OSD.Point(imageWidth, 0));
          const size = viewer.container.getBoundingClientRect();
          setView({ ox: a.x, oy: a.y, scale: (b.x - a.x) / imageWidth, w: size.width, h: size.height });
        });
      };
      viewer.addHandler("open", () => {
        const narrow = viewer.container.clientWidth < 640;
        if (narrow) {
          const vp = viewer.viewport;
          const quad = places.find((p) => p.id === "main-quad");
          const center = quad ? new OSD.Point(quad.x, quad.y) : new OSD.Point(imageWidth / 2, imageWidth / 4);
          vp.zoomTo(vp.imageToViewportZoom(0.2), undefined, true);
          vp.panTo(vp.imageToViewportCoordinates(center), true);
        }
        update();
        callbacks.current.onReady();
      });
      viewer.addHandler("open-failed", (e) => callbacks.current.onError(String(e.message || "Could not load map tiles")));
      viewer.addHandler("animation", update);
      viewer.addHandler("resize", update);
      viewer.addHandler("update-viewport", update);

      const toImage = (pos: OpenSeadragon.Point) => viewer.viewport.viewerElementToImageCoordinates(pos);
      const hit = (pos: OpenSeadragon.Point) => {
        const p = toImage(pos);
        for (const t of hitRef.current) {
          const [x0, y0, x1, y1] = t.bbox;
          if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
          if (pointInPolygon(p.x, p.y, t.p.outline!)) return t.p;
        }
        return null;
      };
      new OSD.MouseTracker({
        element: viewer.canvas,
        moveHandler: (e) => {
          const found = hit(e.position as OpenSeadragon.Point);
          setHoverId(found ? found.id : null);
          viewer.canvas.style.cursor = found ? "pointer" : "";
        },
        leaveHandler: () => setHoverId(null),
      });
      viewer.addHandler("canvas-click", (e) => {
        if (!e.quick) return;
        callbacks.current.onSelect(hit(e.position));
      });
    })().catch((e) => callbacks.current.onError(String(e)));
    return () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // The viewer is created once per image; places only seed the initial mobile view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageWidth]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo(place, zoom = 1.1) {
        const viewer = viewerRef.current;
        const OSD = osdRef.current;
        if (!viewer || !OSD) return;
        const vp = viewer.viewport;
        const target = vp.imageToViewportCoordinates(new OSD.Point(place.x, place.y + 40));
        const current = vp.viewportToImageZoom(vp.getZoom(true));
        const z = place.kind === "complex" || place.kind === "area" ? Math.min(zoom, 0.7) : zoom;
        vp.zoomTo(vp.imageToViewportZoom(Math.max(current, z)), undefined, false);
        vp.panTo(target, false);
      },
      zoomBy(factor) {
        const vp = viewerRef.current?.viewport;
        if (!vp) return;
        vp.zoomBy(factor);
        vp.applyConstraints();
      },
      home() {
        viewerRef.current?.viewport.goHome();
      },
    }),
    [],
  );

  const labels = view && showLabels ? layoutLabels(sorted, view, visible, selectedId) : [];
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const hovered = hoverId ? byId.get(hoverId) : undefined;
  const selected = selectedId ? byId.get(selectedId) : undefined;

  const poly = (p: Place | undefined) =>
    p?.outline && view ? p.outline.map(([x, y]) => `${view.ox + x * view.scale},${view.oy + y * view.scale}`).join(" ") : null;

  return (
    <div className="absolute inset-0">
      <div ref={container} className="absolute inset-0 [&_canvas]:[image-rendering:pixelated]" aria-label="Isometric map of Stanford campus" role="application" />
      {view && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {hovered && hovered !== selected && poly(hovered) && (
            <polygon points={poly(hovered)!} fill="rgba(255,255,255,0.18)" stroke="#fff" strokeWidth={2} strokeLinejoin="round" />
          )}
          {selected && poly(selected) && (
            <polygon points={poly(selected)!} fill="rgba(140,21,21,0.16)" stroke="#8c1515" strokeWidth={2.5} strokeLinejoin="round" />
          )}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels.map(({ p, sx, sy, size }) => (
          <MapLabel
            key={p.id}
            place={p}
            x={sx}
            y={sy}
            size={size}
            active={p.id === selectedId || p.id === hoverId}
            onClick={() => onSelect(p)}
            onHover={(on) => setHoverId(on ? p.id : null)}
          />
        ))}
      </div>
    </div>
  );
}

function MapLabel({
  place,
  x,
  y,
  size,
  active,
  onClick,
  onHover,
}: {
  place: Place;
  x: number;
  y: number;
  size: number;
  active: boolean;
  onClick(): void;
  onHover(on: boolean): void;
}) {
  const meta = CATEGORY_META[place.category];
  if (place.kind === "street") {
    return (
      <div
        className="absolute font-pixel uppercase tracking-[0.12em] text-stone-700/90 [text-shadow:0_0_3px_#f5efe2,0_0_3px_#f5efe2,0_0_6px_#f5efe2]"
        style={{ left: x, top: y, fontSize: size - 1, transform: `translate(-50%,-50%) rotate(${place.angle ?? 0}deg)` }}
      >
        {place.name}
      </div>
    );
  }
  const Icon = meta.icon;
  const area = place.kind === "area" || place.kind === "complex";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "pointer-events-auto absolute flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-pixel leading-none shadow-[0_2px_0_rgba(0,0,0,0.18)] transition-transform hover:z-10 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2",
        area
          ? "border-white/70 bg-white/55 text-stone-800 backdrop-blur-[2px]"
          : "border-stone-900/10 bg-[#fffaf0]/95 text-stone-900",
        active && "z-20 scale-105 border-[#8c1515] bg-white ring-2 ring-[#8c1515]/30",
      )}
      style={{ left: x, top: y, fontSize: size, transform: "translate(-50%, calc(-100% - 8px))" }}
    >
      <span className="grid size-[1.15em] place-items-center rounded-[3px] text-white" style={{ background: meta.color }}>
        <Icon className="size-[0.8em]" strokeWidth={2.5} />
      </span>
      <span className={cn(place.rank >= 8 && "font-semibold")}>{place.name}</span>
      {!area && (
        <span
          aria-hidden
          className="absolute left-1/2 top-full h-2 w-0.5 -translate-x-1/2 bg-stone-900/40"
        />
      )}
    </button>
  );
}
