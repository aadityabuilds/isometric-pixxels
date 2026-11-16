"use client";

import { useEffect, useRef } from "react";
import { campusTime } from "@/lib/live/clock";
import type { LiveWorld } from "@/lib/live/engine";
import type { ScenePreset } from "@/lib/live/types";
import type { ViewBus } from "./view-bus";

export interface LiveStats {
  students: number;
  bikes: number;
  cars: number;
  shuttles: number;
  label: string;
}

interface Props {
  bus: ViewBus;
  world: LiveWorld | null;
  enabled: boolean;
  preset: ScenePreset;
  onStats(stats: LiveStats): void;
}

export function LiveLayer({ bus, world, enabled, preset, onStats }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const statsCb = useRef(onStats);
  useEffect(() => {
    statsCb.current = onStats;
  });

  useEffect(() => {
    const el = canvas.current;
    if (!el || !world) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let lastStats = 0;
    let lastClock = 0;
    const since = Date.now();
    let t = campusTime(new Date(), preset, since);
    world.setTime(t);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = el.getBoundingClientRect();
      el.width = Math.round(r.width * dpr);
      el.height = Math.round(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = (now - last) / 1000;
      last = now;
      if (now - lastClock > 1000) {
        lastClock = now;
        t = campusTime(new Date(), preset, since);
        world.setTime(t);
      }
      if (!enabled) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, el.width, el.height);
        return;
      }
      world.update(dt, t.minutes);
      const v = bus.view;
      if (v) world.draw(ctx, v, el.width / Math.max(1, v.w));
      if (now - lastStats > 1000) {
        lastStats = now;
        statsCb.current({ ...world.stats, label: t.label });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [world, enabled, preset, bus]);

  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full [image-rendering:pixelated]" aria-hidden />;
}
