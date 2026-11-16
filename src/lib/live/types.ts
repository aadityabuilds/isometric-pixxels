export interface NetworkEdge {
  a: number;
  b: number;
  /** bit flags: 1 car, 2 bike, 4 walk */
  m: number;
  /** speed limit in m/s for cars (0 = no cars) */
  s: number;
  /** one-way for cars */
  o: number;
  /** length in metres */
  l: number;
  /** lane offset in metres from the centre line */
  w: number;
  /** flattened polyline in image pixels */
  p: number[];
}

export interface NetworkData {
  nodes: [number, number][];
  edges: NetworkEdge[];
  parking: [number, number, number][];
  anchors: Record<string, number[]>;
  pxPerM: number;
}

export interface ShuttleData {
  shapes: Record<string, { p: number[]; d: number[] }>;
  trips: { s: string; sh: string; r: string; c: string; t: number[]; d: number[] }[];
  services: Record<string, { days: number[]; start: string; end: string; add: string[]; remove: string[] }>;
}

export interface SpriteInfo {
  cell: [number, number];
  anchor: [number, number];
  headings: number;
  frames: number;
  variants: number;
  y: number;
  perRow: number;
}

export interface AtlasData {
  scale: number;
  width: number;
  height: number;
  sprites: Record<"car" | "van" | "bus" | "bike" | "person", SpriteInfo>;
  camera: { bearing: number; elevation: number; pxPerM: number };
}

export interface OcclusionData {
  w: number;
  h: number;
  scale: number;
  bits: Uint8Array;
}

export interface MapView {
  ox: number;
  oy: number;
  scale: number;
  w: number;
  h: number;
}

export type ScenePreset = "live" | "morning" | "class-change" | "lunch" | "evening" | "night";
