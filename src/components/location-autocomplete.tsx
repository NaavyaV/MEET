"use client";

import { useEffect, useId, useRef, useState } from "react";

export type LocationChoice = { label: string; latitude: number; longitude: number };

export function LocationAutocomplete({ value, onChange, onSelect, onUseCurrent }: { value: string; onChange: (value: string) => void; onSelect: (choice: LocationChoice) => void; onUseCurrent: () => void }) {
  const [options, setOptions] = useState<LocationChoice[]>([]); const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false); const controller = useRef<AbortController | null>(null); const listId = useId();
  useEffect(() => {
    const query = value.trim();
    if (query.length < 3) return;
    const timeout = window.setTimeout(async () => {
      controller.current?.abort(); const next = new AbortController(); controller.current = next; setLoading(true);
      try { const response = await fetch(`/api/location?q=${encodeURIComponent(query)}`, { signal: next.signal }); const payload = await response.json() as { options?: LocationChoice[] }; if (!next.signal.aborted) { setOptions(payload.options ?? []); setOpen(true); } } catch { if (!next.signal.aborted) setOptions([]); } finally { if (!next.signal.aborted) setLoading(false); }
    }, 420);
    return () => { window.clearTimeout(timeout); controller.current?.abort(); };
  }, [value]);
  const choose = (choice: LocationChoice) => { onSelect(choice); setOptions([]); setOpen(false); };
  const showOptions = open;
  const query = value.trim();
  return <div className="location-combobox"><input value={value} placeholder="Start typing a city, ZIP code, or address" role="combobox" aria-controls={listId} aria-expanded={showOptions} aria-autocomplete="list" onFocus={() => setOpen(true)} onChange={(event) => { const nextValue = event.target.value; if (nextValue.trim().length < 3) setOptions([]); onChange(nextValue); setOpen(true); }} onBlur={() => window.setTimeout(() => setOpen(false), 160)} />{showOptions && <div className="location-options" id={listId} role="listbox">{loading && <span className="location-option muted">Searching locations…</span>}{!loading && query.length >= 3 && options.map((choice) => <button type="button" role="option" aria-selected={false} key={`${choice.latitude}-${choice.longitude}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(choice)}><b>{choice.label.split(",").slice(0, 2).join(",")}</b><small>{choice.label}</small></button>)}{!loading && query.length > 0 && query.length < 3 && <span className="location-option muted">Type at least 3 characters to search.</span>}{!loading && query.length >= 3 && !options.length && <span className="location-option muted">No matching locations found. Try a broader search.</span>}<button type="button" className="current-location-option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onUseCurrent(); setOpen(false); }}>Use my current location</button></div>}</div>;
}
