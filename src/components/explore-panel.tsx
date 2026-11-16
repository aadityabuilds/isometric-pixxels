"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CATEGORY_META, FILTER_ORDER, searchPlaces, type Category, type Place } from "@/lib/places";
import { cn } from "@/lib/utils";

interface Props {
  places: Place[];
  visible: Set<Category>;
  onToggle(category: Category): void;
  onSelect(place: Place): void;
  inputRef?: RefObject<HTMLInputElement | null>;
  compact?: boolean;
}

const BROWSE: Category[] = ["residence", "dining", "library", "landmark", "athletics", "arts", "academic", "medical"];

export function SearchBox({ places, onSelect, inputRef, className }: Pick<Props, "places" | "onSelect" | "inputRef"> & { className?: string }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const results = useMemo(() => searchPlaces(places, query, 8), [places, query]);

  const choose = (p: Place) => {
    onSelect(p);
    setQuery("");
    ref.current?.blur();
  };

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
      <Input
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
          } else if (e.key === "Enter" && results[active]) {
            choose(results[active]);
          } else if (e.key === "Escape") {
            setQuery("");
            ref.current?.blur();
          }
        }}
        placeholder="Search dorms, halls, cafés…"
        className="h-10 rounded-lg border-stone-900/15 bg-white pl-9 pr-16 text-[15px] shadow-[0_2px_0_rgba(0,0,0,0.08)]"
        aria-label="Search places"
      />
      {query ? (
        <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-700" aria-label="Clear search">
          <X className="size-4" />
        </button>
      ) : (
        <Kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 max-sm:hidden">/</Kbd>
      )}
      {focused && query && (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-stone-900/10 bg-white shadow-xl">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-stone-500">No places match “{query}”.</p>
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
                      className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", i === active && "bg-stone-100")}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded text-white" style={{ background: meta.color }}>
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-stone-900">{p.name}</span>
                        <span className="block truncate text-xs text-stone-500">{p.group || meta.label}</span>
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

export function FilterChips({ visible, onToggle, className }: Pick<Props, "visible" | "onToggle"> & { className?: string }) {
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
              "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition",
              on ? "border-transparent text-white shadow-[0_2px_0_rgba(0,0,0,0.18)]" : "border-stone-900/15 bg-white/70 text-stone-500 hover:text-stone-800",
            )}
            style={on ? { background: meta.color } : undefined}
          >
            <Icon className="size-3.5" />
            {meta.plural}
          </button>
        );
      })}
    </div>
  );
}

export function BrowseList({ places, onSelect }: Pick<Props, "places" | "onSelect">) {
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
    const list = items
      .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
      .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
    return [{ title: "", list }];
  }, [places, category]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none]">
        {BROWSE.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-xs font-medium transition",
              c === category ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-900/5",
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
                className="sticky top-0 z-10 mb-1 flex w-full items-center justify-between bg-[#fffaf0] py-1 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 hover:text-[#8c1515]"
              >
                {s.title}
                <span className="font-normal normal-case text-stone-400">{s.list.length}</span>
              </button>
            )}
            <ul>
              {s.list.map((p) => (
                <li key={p.id}>
                  <button onClick={() => onSelect(p)} className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-900/5">
                    <span className="truncate">{p.name}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-stone-300 group-hover:text-stone-500" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {sections.every((s) => s.list.length === 0) && <p className="px-2 py-4 text-sm text-stone-500">Nothing in this category yet.</p>}
      </ScrollArea>
    </div>
  );
}
