import { LiveWorld } from "./engine";
import type { AtlasData, NetworkData, OcclusionData, ShuttleData } from "./types";

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}

async function occlusion(meta: { w: number; h: number; scale: number; url: string }): Promise<OcclusionData> {
  const r = await fetch(meta.url);
  if (!r.ok || !r.body) throw new Error(`${meta.url} returned ${r.status}`);
  const bytes = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  return { w: meta.w, h: meta.h, scale: meta.scale, bits: bytes };
}

function image(url: string) {
  return new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

export async function loadLiveWorld(occMeta?: { w: number; h: number; scale: number; url: string }, core?: { x: number; y: number }[]) {
  const [net, shuttles, atlas, sprites, occ] = await Promise.all([
    json<NetworkData>("/data/network.json"),
    json<ShuttleData>("/data/shuttles.json").catch(() => null),
    json<AtlasData>("/sprites/atlas.json"),
    image("/sprites/atlas.png"),
    occMeta ? occlusion(occMeta).catch(() => null) : Promise.resolve(null),
  ]);
  return new LiveWorld(net, shuttles, occ, atlas, sprites, core);
}
