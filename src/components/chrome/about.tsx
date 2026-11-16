"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const KEYS: [string, string][] = [
  ["Drag, scroll, pinch", "Move and zoom"],
  ["/", "Search"],
  ["P", "Places & tour"],
  ["N", "Labels on or off"],
  ["L", "AI illustration or plain render"],
  ["T", "People & traffic on or off"],
  ["F", "Full screen"],
  ["H", "Hide tools"],
  ["+ / − / 0", "Zoom in, out, whole campus"],
  ["Esc", "Close"],
];

export function AboutDialog({ open, onOpenChange, attribution }: { open: boolean; onOpenChange(open: boolean): void; attribution: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto border-[#f1e8d2]/14 bg-[#201e1c] text-[#f1e8d2] sm:max-w-lg">
        <DialogTitle className="font-pixel text-xl text-[#f1e8d2]">About Pixel Stanford</DialogTitle>
        <p className="text-sm leading-relaxed text-[#f1e8d2]/80">
          Stanford&apos;s core campus as one isometric map you can zoom right into, from Lake Lagunita to the Palm Drive gate and from the medical center to
          Escondido Village. Every building is placed and sized from real data, and the campus moves: students walk between classes, bikes rush at the
          top and bottom of the hour, cars circle Campus Drive and Marguerite shuttles run their published timetable.
        </p>
        <h3 className="mt-2 font-pixel text-[12px] uppercase tracking-[0.12em] text-[#e9c46a]">How it&apos;s made</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[#f1e8d2]/80">
          <li>Footprints, streets, paths and fields come from OpenStreetMap; official building names and numbers from Stanford Maps &amp; Records.</li>
          <li>Heights, roof shapes and about 57,000 trees are measured from the USGS 2020 lidar survey of Santa Clara County.</li>
          <li>Roof and ground colours come from 2024 USDA aerial photography, posterised so it reads as pixel art.</li>
          <li>A program renders it all with one fixed camera, 30° above the ground and 45° off the campus grid, at about 3 pixels per metre.</li>
          <li>
            The illustrated layer was redrawn tile by tile with Google&apos;s Nano Banana image models, given the plain render&apos;s
            geometry, the aerial photo and freely licensed Wikimedia Commons photos of each area. Press L to compare it with the plain render.
          </li>
          <li>People, bikes and cars follow the real street and path network; shuttles follow Stanford&apos;s published Marguerite timetable.</li>
        </ul>
        <h3 className="mt-2 font-pixel text-[12px] uppercase tracking-[0.12em] text-[#e9c46a]">Getting around</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {KEYS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-[#f1e8d2]/20 px-1.5 font-mono text-[11px] text-[#f1e8d2]/80">{k}</kbd>
              </dt>
              <dd className="text-[#f1e8d2]/70">{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-2 font-pixel text-[12px] uppercase tracking-[0.12em] text-[#e9c46a]">Data and credits</h3>
        <p className="text-xs leading-relaxed text-[#f1e8d2]/60">
          {attribution}. Marguerite schedule from Stanford Transportation&apos;s public GTFS feed. Type: Pixelify Sans and Geist (SIL Open Font License).
          Not affiliated with Stanford University.
        </p>
      </DialogContent>
    </Dialog>
  );
}
