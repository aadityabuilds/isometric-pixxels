"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CATEGORY_META, FILTER_ORDER, searchPlaces, type Category, type Place } from "@/lib/places";
import { cn } from "@/lib/utils";

export interface TourStop {
  id: string;
  title: string;
  blurb: string;
  image: string;
}

export function SearchBox({
  places,
  onSelect,
  inputRef,
  className,
}: {
  places: Place[];
  onSelect(p: Place): void;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const local = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? local;
  const results = useMemo(() => searchPlaces(places, query, 8), [places, query]);
  const choose = (p: Place) => {
    onSelect(p);
    setQuery("");
    ref.current?.blur();
  };
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#f1e8d2]/50" />
      <input
        ref={ref}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) choose(results[active]);
          else if (e.key === "Escape") {
            setQuery("");
            ref.current?.blur();
          }
        }}
        placeholder="Search a dorm, hall, café or street"
        aria-label="Search the map"
        className="h-9 w-full rounded-md border border-[#f1e8d2]/14 bg-[#2a2724] pl-8 pr-8 text-[14px] text-[#f1e8d2] outline-none placeholder:text-[#f1e8d2]/45 focus:border-[#e9c46a]/70"
      />
      {query ? (
        <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#f1e8d2]/50 hover:text-[#f1e8d2]">
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[#f1e8d2]/20 px-1 font-mono text-[10px] text-[#f1e8d2]/50 max-sm:hidden">/</kbd>
      )}
      {focused && query && (
        <div className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-md border border-[#f1e8d2]/14 bg-[#201e1c] shadow-[0_8px_24px_rgba(10,9,8,0.4)]">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-[#f1e8d2]/60">No places match “{query}”. Try a dorm, a building or a street.</p>
          ) : (
            <ul role="listbox">
              {results.map((p, i) => {
                const meta = CATEGORY_META[p.category];
                const Icon = meta.icon;
                return (
                  <li key={p.id} role="option" aria-selected={i === active}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(p)}
                      onMouseEnter={() => setActive(i)}
                      className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", i === active && "bg-[#3a3530]")}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-[3px]" style={{ background: meta.color }}>
                        <Icon className="size-3.5 text-white" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[#f1e8d2]">{p.name}</span>
                        <span className="block truncate text-xs text-[#f1e8d2]/50">{p.group || meta.label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterChips({ visible, onToggle, className }: { visible: Set<Category>; onToggle(c: Category): void; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {FILTER_ORDER.map((c) => {
        const meta = CATEGORY_META[c];
        const Icon = meta.icon;
        const on = visible.has(c);
        return (
          <button
            key={c}
            onClick={() => onToggle(c)}
            aria-pressed={on}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[4px] border px-2 py-1 text-xs transition",
              on ? "border-[#f1e8d2]/20 bg-[#3a3530] text-[#f1e8d2]" : "border-[#f1e8d2]/10 text-[#f1e8d2]/45 hover:text-[#f1e8d2]/80",
            )}
          >
            <span className={cn("grid size-4 place-items-center rounded-[2px]", !on && "opacity-40")} style={{ background: meta.color }}>
              <Icon className="size-2.5 text-white" />
            </span>
            {meta.plural}
          </button>
        );
      })}
    </div>
  );
}

const BROWSE: Category[] = ["residence", "dining", "library", "landmark", "athletics", "arts", "academic", "medical"];

export function BrowseList({ places, onSelect }: { places: Place[]; onSelect(p: Place): void }) {
  const [category, setCategory] = useState<Category>("residence");
  const sections = useMemo(() => {
    const items = places.filter((p) => p.category === category && p.kind !== "street" && p.rank >= 2);
    if (category === "residence") {
      const groups = new Map<string, Place[]>();
      for (const p of items) {
        if (p.kind === "complex") continue;
        const key = p.group || "Houses & halls";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      }
      return [...groups.entries()]
        .map(([title, list]) => ({ title, list: list.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => (a.title === "Houses & halls" ? 1 : b.title === "Houses & halls" ? -1 : a.title.localeCompare(b.title)));
    }
    const seen = new Set<string>();
    return [
      {
        title: "",
        list: items.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true))).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
      },
    ];
  }, [places, category]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none]">
        {BROWSE.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "shrink-0 rounded-[4px] px-2 py-1 text-xs transition",
              c === category ? "bg-[#f1e8d2] text-[#201e1c]" : "text-[#f1e8d2]/60 hover:bg-[#3a3530] hover:text-[#f1e8d2]",
            )}
          >
            {CATEGORY_META[c].plural}
          </button>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1 pr-2">
        {sections.map((s) => (
          <div key={s.title || "all"} className="mb-3">
            {s.title && (
              <button
                onClick={() => {
                  const complex = places.find((p) => p.kind === "complex" && p.name === s.title);
                  if (complex) onSelect(complex);
                }}
                className="sticky top-0 z-10 mb-1 flex w-full items-center justify-between bg-[#201e1c] py-1 text-left font-pixel text-[11px] uppercase tracking-[0.12em] text-[#e9c46a] hover:text-[#f1e8d2]"
              >
                {s.title}
                <span className="font-sans normal-case tracking-normal text-[#f1e8d2]/40">{s.list.length}</span>
              </button>
            )}
            <ul>
              {s.list.map((p) => (
                <li key={p.id}>
                  <button onClick={() => onSelect(p)} className="group flex w-full items-center justify-between rounded-[4px] px-2 py-1.5 text-left text-sm text-[#f1e8d2]/90 hover:bg-[#3a3530]">
                    <span className="truncate">{p.name}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-[#f1e8d2]/25 group-hover:text-[#f1e8d2]/60" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {sections.every((s) => s.list.length === 0) && <p className="px-2 py-4 text-sm text-[#f1e8d2]/50">Nothing in this category yet.</p>}
      </ScrollArea>
    </div>
  );
}

export function TourList({ tour, activeId, onOpen }: { tour: TourStop[]; activeId: string | null; onOpen(stop: TourStop): void }) {
  return (
    <ScrollArea className="min-h-0 flex-1 pr-2">
      <ol className="space-y-2">
        {tour.map((stop, i) => (
          <li key={stop.id}>
            <button
              onClick={() => onOpen(stop)}
              className={cn(
                "group flex w-full gap-3 rounded-md border p-1.5 text-left transition",
                stop.id === activeId ? "border-[#e9c46a]/70 bg-[#3a3530]" : "border-transparent hover:border-[#f1e8d2]/15 hover:bg-[#2a2724]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stop.image} alt="" loading="lazy" className="h-14 w-[88px] shrink-0 rounded-[3px] object-cover [image-rendering:pixelated]" />
              <span className="min-w-0 py-0.5">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] text-[#e9c46a]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="truncate font-pixel text-[13px] text-[#f1e8d2]">{stop.title}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-[#f1e8d2]/55">{stop.blurb}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}
