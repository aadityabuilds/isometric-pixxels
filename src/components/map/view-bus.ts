import type { MapView } from "@/lib/live/types";

/** A tiny pub/sub for the map's current view, so overlays can follow pans without React re-renders. */
export class ViewBus {
  view: MapView | null = null;
  private subs = new Set<(v: MapView) => void>();

  set(v: MapView) {
    this.view = v;
    for (const fn of this.subs) fn(v);
  }

  subscribe(fn: (v: MapView) => void) {
    this.subs.add(fn);
    if (this.view) fn(this.view);
    return () => {
      this.subs.delete(fn);
    };
  }
}
