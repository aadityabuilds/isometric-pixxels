import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CampusApp } from "@/components/campus-app";
import type { CampusCamera } from "@/lib/places";

async function mapInfo() {
  "use cache";
  const raw = JSON.parse(await readFile(join(process.cwd(), "public", "data", "places.json"), "utf8"));
  return { tilesUrl: raw.tiles as string, camera: raw.camera as CampusCamera };
}

export default async function Home() {
  const { tilesUrl, camera } = await mapInfo();
  return (
    <>
      <link rel="preload" href={tilesUrl} as="fetch" crossOrigin="anonymous" />
      <CampusApp tilesUrl={tilesUrl} camera={camera} />
    </>
  );
}
