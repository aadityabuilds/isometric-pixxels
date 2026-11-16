import {
  BedDouble,
  BookOpen,
  Building2,
  GraduationCap,
  Landmark,
  Palette,
  Signpost,
  SquareParking,
  Stethoscope,
  Trees,
  Trophy,
  Utensils,
  type LucideIcon,
} from "lucide-react";

export type Category =
  | "landmark"
  | "residence"
  | "academic"
  | "dining"
  | "library"
  | "athletics"
  | "arts"
  | "medical"
  | "parking"
  | "place"
  | "street"
  | "other";

export type PlaceKind = "building" | "complex" | "area" | "poi" | "street";

export interface Place {
  id: string;
  name: string;
  group?: string | null;
  category: Category;
  kind: PlaceKind;
  x: number;
  y: number;
  rank: number;
  lonlat: [number, number];
  outline?: [number, number][];
  official?: string | null;
  bldgId?: string | null;
  height?: number;
  angle?: number;
  count?: number;
}

export interface CampusCamera {
  bearing: number;
  elevation: number;
  pxPerM: number;
  width: number;
  height: number;
}

export interface CampusData {
  camera: CampusCamera;
  places: Place[];
  attribution: string;
}

export const CATEGORY_META: Record<Category, { label: string; plural: string; color: string; icon: LucideIcon }> = {
  landmark: { label: "Landmark", plural: "Landmarks", color: "#8c1515", icon: Landmark },
  residence: { label: "Residence", plural: "Dorms & housing", color: "#c2410c", icon: BedDouble },
  academic: { label: "Academic", plural: "Academic buildings", color: "#1d4ed8", icon: GraduationCap },
  dining: { label: "Dining", plural: "Dining & cafés", color: "#b45309", icon: Utensils },
  library: { label: "Library", plural: "Libraries", color: "#6d28d9", icon: BookOpen },
  athletics: { label: "Athletics", plural: "Athletics", color: "#047857", icon: Trophy },
  arts: { label: "Arts", plural: "Arts & culture", color: "#be185d", icon: Palette },
  medical: { label: "Medical", plural: "Medical center", color: "#0e7490", icon: Stethoscope },
  parking: { label: "Parking", plural: "Parking", color: "#475569", icon: SquareParking },
  place: { label: "Place", plural: "Places & open spaces", color: "#4d7c0f", icon: Trees },
  street: { label: "Street", plural: "Streets", color: "#57534e", icon: Signpost },
  other: { label: "Building", plural: "Other buildings", color: "#57534e", icon: Building2 },
};

export const FILTER_ORDER: Category[] = [
  "landmark",
  "residence",
  "academic",
  "dining",
  "library",
  "athletics",
  "arts",
  "medical",
  "place",
  "street",
  "parking",
];

export const DEFAULT_VISIBLE: Category[] = FILTER_ORDER.filter((c) => c !== "parking");

export function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchPlaces(places: Place[], query: string, limit = 8): Place[] {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(" ");
  const scored: { p: Place; s: number }[] = [];
  for (const p of places) {
    if (p.kind === "street" && q.length < 3) continue;
    const hay = normalize(`${p.name} ${p.group ?? ""} ${p.official ?? ""}`);
    if (!terms.every((t) => hay.includes(t))) continue;
    const name = normalize(p.name);
    let s = p.rank;
    if (name === q) s += 40;
    else if (name.startsWith(q)) s += 20;
    else if (name.split(" ").some((w) => w.startsWith(terms[0]))) s += 10;
    if (p.kind === "complex") s += 4;
    scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.p);
}

export function distance(a: Place, b: Place) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
