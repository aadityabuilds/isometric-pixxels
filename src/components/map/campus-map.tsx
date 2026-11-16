"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type OpenSeadragon from "openseadragon";
import type { LiveWorld } from "@/lib/live/engine";
import type { MapView, ScenePreset } from "@/lib/live/types";
import { pointInPolygon, type Category, type Place } from "@/lib/places";
import { LabelLayer } from "./label-layer";
import { LiveLayer, type LiveStats } from "./live-layer";
import { ViewBus } from "./view-bus";

export interface CampusMapHandle {
  flyTo(place: Place, zoom?: number): void;
  zoomBy(factor: number): void;
  home(): void;
  /** Current view as image-pixel centre and zoom, for share links. */
  viewHash(): string | null;
  applyViewHash(hash: string, immediately?: boolean): boolean;
}

interface Props {
  tilesUrl: string;
  /** Optional AI-illustrated layer drawn over the plain render with the same camera. */
  tilesAiUrl?: string;
  showAi?: boolean;
  imageWidth: number;
  places: Place[];
  visible: Set<Category>;
  showLabels: boolean;
  world: LiveWorld | null;
  liveEnabled: boolean;
  preset: ScenePreset;
  selectedId: string | null;
  onSelect(place: Place | null): void;
  onReady(): void;
  onError(message: string): void;
  onStats(stats: LiveStats): void;
  onIdle?(): void;
  ref?: Ref<CampusMapHandle>;
}

const HIT_CELL = 256;

export function CampusMap(props: Props) {
  const { tilesUrl, tilesAiUrl, showAi = true, imageWidth, places, visible, showLabels, world, liveEnabled, preset, selectedId, ref } = props;
  const showAiRef = useRef(showAi);
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const osdRef = useRef<typeof OpenSeadragon | null>(null);
  const bus = useMemo(() => new ViewBus(), []);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverPoly = useRef<SVGPolygonElement>(null);
  const selectPoly = useRef<SVGPolygonElement>(null);
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const hitGrid = useMemo(() => {
    const grid = new Map<string, { p: Place; bbox: number[]; area: number }[]>();
    for (const p of places) {
      if (!p.outline || p.outline.length < 3) continue;
      const xs = p.outline.map((q) => q[0]);
      const ys = p.outline.map((q) => q[1]);
      const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const item = { p, bbox, area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) };
      for (let cx = Math.floor(bbox[0] / HIT_CELL); cx <= Math.floor(bbox[2] / HIT_CELL); cx++) {
        for (let cy = Math.floor(bbox[1] / HIT_CELL); cy <= Math.floor(bbox[3] / HIT_CELL); cy++) {
          const k = `${cx},${cy}`;
          const list = grid.get(k);
          if (list) list.push(item);
          else grid.set(k, [item]);
        }
      }
    }
    for (const list of grid.values()) list.sort((a, b) => a.area - b.area);
    return grid;
  }, [places]);
  const hitRef = useRef(hitGrid);
  useEffect(() => {
    hitRef.current = hitGrid;
  }, [hitGrid]);

  const drawOutline = useCallback((el: SVGPolygonElement | null, place: Place | undefined, v: MapView | null) => {
    if (!el) return;
    if (!place?.outline || !v) {
      el.setAttribute("points", "");
      return;
    }
    el.setAttribute("points", place.outline.map(([x, y]) => `${v.ox + x * v.scale},${v.oy + y * v.scale}`).join(" "));
  }, []);

  const hovered = hoverId ? byId.get(hoverId) : undefined;
  const selected = selectedId ? byId.get(selectedId) : undefined;
  useEffect(() => {
    drawOutline(hoverPoly.current, hovered !== selected ? hovered : undefined, bus.view);
    drawOutline(selectPoly.current, selected, bus.view);
    return bus.subscribe((v) => {
      drawOutline(hoverPoly.current, hovered !== selected ? hovered : undefined, v);
      drawOutline(selectPoly.current, selected, v);
    });
  }, [bus, hovered, selected, drawOutline]);

  useEffect(() => {
    let destroyed = false;
    (async () => {
      const OSD = (await import("openseadragon")).default;
      if (destroyed || !container.current) return;
      osdRef.current = OSD;
      const viewer = OSD({
        element: container.current,
        tileSources: tilesUrl,
        showNavigationControl: false,
        imageSmoothingEnabled: false,
        maxZoomPixelRatio: 3,
        minZoomImageRatio: 0.7,
        visibilityRatio: 0.5,
        constrainDuringPan: true,
        animationTime: 0.8,
        springStiffness: 9,
        blendTime: 0,
        alwaysBlend: false,
        immediateRender: true,
        imageLoaderLimit: 8,
        maxImageCacheCount: 400,
        preserveImageSizeOnResize: true,
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
        gestureSettingsTouch: { pinchRotate: false },
      });
      viewerRef.current = viewer;
      const base = () => viewer.world.getItemAt(0);

      const emit = () => {
        const img = base();
        if (!img) return;
        const a = img.imageToViewerElementCoordinates(new OSD.Point(0, 0));
        const b = img.imageToViewerElementCoordinates(new OSD.Point(imageWidth, 0));
        const el = viewer.container;
        bus.set({ ox: a.x, oy: a.y, scale: (b.x - a.x) / imageWidth, w: el.clientWidth, h: el.clientHeight });
      };
      viewer.addHandler("open", () => {
        if (tilesAiUrl && viewer.world.getItemCount() === 1) {
          viewer.addTiledImage({ tileSource: tilesAiUrl, opacity: showAiRef.current ? 1 : 0, index: 1 });
        }
        if (viewer.container.clientWidth < 640) {
          const vp = viewer.viewport;
          const img = base();
          const quad = places.find((p) => p.id === "main-quad");
          const c = quad ? new OSD.Point(quad.x, quad.y) : new OSD.Point(imageWidth / 2, imageWidth / 4);
          vp.zoomTo(img.imageToViewportZoom(0.22), undefined, true);
          vp.panTo(img.imageToViewportCoordinates(c), true);
        }
        emit();
        cb.current.onReady();
      });
      viewer.addHandler("open-failed", (e) => cb.current.onError(String(e.message || "Could not load map tiles")));
      viewer.addHandler("animation", emit);
      viewer.addHandler("resize", emit);
      viewer.addHandler("update-viewport", emit);
      viewer.addHandler("animation-finish", () => cb.current.onIdle?.());

      const hit = (pos: OpenSeadragon.Point) => {
        const p = base().viewerElementToImageCoordinates(pos);
        const list = hitRef.current.get(`${Math.floor(p.x / HIT_CELL)},${Math.floor(p.y / HIT_CELL)}`) ?? [];
        for (const t of list) {
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
          setHoverId((prev) => (prev === (found?.id ?? null) ? prev : found?.id ?? null));
          viewer.canvas.style.cursor = found ? "pointer" : "";
        },
        leaveHandler: () => setHoverId(null),
      });
      viewer.addHandler("canvas-click", (e) => {
        if (e.quick) cb.current.onSelect(hit(e.position));
      });
    })().catch((e) => cb.current.onError(String(e)));
    return () => {
      destroyed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // The viewer is created once per tile set; places only seed the initial mobile view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesUrl, tilesAiUrl, imageWidth, bus]);

  useEffect(() => {
    showAiRef.current = showAi;
    const item = viewerRef.current?.world.getItemAt(1);
    item?.setOpacity(showAi ? 1 : 0);
  }, [showAi]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo(place, zoom = 1.1) {
        const viewer = viewerRef.current;
        const OSD = osdRef.current;
        if (!viewer || !OSD) return;
        const vp = viewer.viewport;
        const img = viewer.world.getItemAt(0);
        const target = img.imageToViewportCoordinates(new OSD.Point(place.x, place.y + 40));
        const current = img.viewportToImageZoom(vp.getZoom(true));
        const z = place.kind === "complex" || place.kind === "area" ? Math.min(zoom, 0.7) : zoom;
        vp.zoomTo(img.imageToViewportZoom(Math.max(current, z)), undefined, false);
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
      viewHash() {
        const viewer = viewerRef.current;
        if (!viewer) return null;
        const vp = viewer.viewport;
        const img = viewer.world.getItemAt(0);
        const c = img.viewportToImageCoordinates(vp.getCenter(true));
        const z = img.viewportToImageZoom(vp.getZoom(true));
        return `@${Math.round(c.x)},${Math.round(c.y)},${z.toFixed(2)}`;
      },
      applyViewHash(hash, immediately = false) {
        const viewer = viewerRef.current;
        const OSD = osdRef.current;
        const m = /^@(-?\d+),(-?\d+),([\d.]+)$/.exec(hash);
        if (!viewer || !OSD || !m) return false;
        const vp = viewer.viewport;
        const img = viewer.world.getItemAt(0);
        vp.zoomTo(img.imageToViewportZoom(Number(m[3])), undefined, immediately);
        vp.panTo(img.imageToViewportCoordinates(new OSD.Point(Number(m[1]), Number(m[2]))), immediately);
        return true;
      },
    }),
    [],
  );

  const onHover = useCallback((id: string | null) => setHoverId(id), []);
  const onSelectLabel = useCallback((p: Place) => cb.current.onSelect(p), []);
  const onStats = useCallback((s: LiveStats) => cb.current.onStats(s), []);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="absolute inset-0 [&_canvas]:[image-rendering:pixelated]" aria-label="Isometric map of Stanford campus" role="application" />
      <LiveLayer bus={bus} world={world} enabled={liveEnabled} preset={preset} onStats={onStats} />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <polygon ref={hoverPoly} fill="rgba(255,250,235,0.16)" stroke="#f1e8d2" strokeWidth={2} strokeLinejoin="round" />
        <polygon ref={selectPoly} fill="rgba(233,196,106,0.16)" stroke="#e9c46a" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      {showLabels && (
        <LabelLayer bus={bus} places={places} visible={visible} selectedId={selectedId} hoverId={hoverId} onSelect={onSelectLabel} onHover={onHover} />
      )}
    </div>
  );
}
