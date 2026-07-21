"use client";

import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LocationAutocomplete, LocationChoice } from "./location-autocomplete";
import { defaultProfile, initialLedger } from "@/src/lib/demo-data";
import { createSupabaseBrowserClient, supabaseBrowserConfigured } from "@/src/lib/supabase";
import { EventAction, LedgerEntry, Opportunity, RefreshResult, UserProfile } from "@/src/lib/types";

type Tab = "discover" | "ledger" | "network" | "settings" | "about";
type Stage = "landing" | "onboarding" | "app";
type AccountProfilePayload = { profile: UserProfile; onboardingCompleted: boolean; digestFrequency?: "daily" | "weekly" | "on-demand"; error?: string };

const LocationRadiusMap = dynamic(() => import("./location-map"), { ssr: false, loading: () => <div className="location-map map-loading">Loading your map…</div> });

const icons: Record<string, ReactNode> = {
  spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.3 4.7-4.7 2.3 2.3-4.7 4.7-2.3Z" /></>,
  ledger: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
  people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.08h-3v-.08A1.7 1.7 0 0 0 10.66 18.7a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15.04a1.7 1.7 0 0 0-1.56-1.04h-.08v-3h.08A1.7 1.7 0 0 0 7 9.96a1.7 1.7 0 0 0-.34-1.88L6.6 8.02 8.72 5.9l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.74v-.08h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.56 1.04h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.8-3M4 5v4h4M4 13a8 8 0 0 0 14.8 3M20 19v-4h-4" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  bookmark: <><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17l-6-3-6 3V4Z" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  upload: <><path d="M12 16V3M7 8l5-5 5 5M5 21h14" /></>,
  external: <><path d="M14 3h7v7M21 3l-9 9" /><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-6" /></>,
  locate: <><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" /></>,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function dateParts(date: string) {
  const value = new Date(date);
  const options = { timeZone: "America/Chicago" };
  return { day: new Intl.DateTimeFormat("en-US", { weekday: "short", ...options }).format(value), number: new Intl.DateTimeFormat("en-US", { day: "numeric", ...options }).format(value), month: new Intl.DateTimeFormat("en-US", { month: "short", ...options }).format(value), time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...options }).format(value) };
}

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; } catch { return { error: "The server returned an incomplete response. Please try again." } as T; }
}

async function accountProfile(accessToken: string, options?: { profile: UserProfile; digestFrequency?: "daily" | "weekly" | "on-demand"; completeOnboarding?: boolean }): Promise<AccountProfilePayload> {
  const response = await fetch("/api/account/profile", { method: options ? "PUT" : "GET", headers: { Authorization: `Bearer ${accessToken}`, ...(options ? { "Content-Type": "application/json" } : {}) }, ...(options ? { body: JSON.stringify(options) } : {}) });
  const payload = await responseJson<AccountProfilePayload>(response);
  if (!response.ok) throw new Error(payload.error || "Could not save your MEET profile.");
  return payload;
}

async function accountActions(accessToken: string): Promise<Record<string, EventAction>> {
  const response = await fetch("/api/account/preferences", { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await responseJson<{ actions?: Record<string, EventAction>; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Could not load saved event decisions.");
  return payload.actions ?? {};
}

function FriendLine({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return <div className="friend-line"><span className="avatars">{names.slice(0, 3).map((name, index) => <span className={`avatar a${index}`} key={name}>{name.split(" ").map((part) => part[0]).join("")}</span>)}</span><span>{names.length === 1 ? `${names[0]} is going.` : `${names[0]} and ${names.length - 1} ${names.length === 2 ? "other" : "others"} are going.`}</span></div>;
}

function sourceTypeLabel(sourceType?: Opportunity["sourceType"]) {
  if (sourceType === "web-discovery") return "Web-discovered";
  if (sourceType === "curated-crawler") return "Curated source";
  if (sourceType === "rss") return "Structured source";
  if (sourceType === "api") return "API source";
  return "Sample";
}

function EventCard({ event, action, onSelect, onAction }: { event: Opportunity; action?: EventAction; onSelect: () => void; onAction: (action: EventAction) => void }) {
  const date = dateParts(event.startsAt);
  return <article className="event-card">
    <button className="event-main" onClick={onSelect} aria-label={`Open ${event.title}`}>
      <time className="date-block"><span>{date.day}</span><b>{date.number}</b><small>{date.month}</small></time>
      <div className="event-copy">
        <div className="source-row"><span className="source-dot" />{event.source}<span className="soft-dot">·</span>{event.category}<span className="source-type">{sourceTypeLabel(event.sourceType)}</span></div>
        <h3>{event.title}</h3>
        <p className="event-meta"><span><Icon name="calendar" size={14} />{date.time}</span><span><Icon name={event.format === "online" ? "spark" : "pin"} size={14} />{event.format === "online" ? "Online" : event.distanceMiles == null ? event.venue || "In person" : `${event.distanceMiles.toFixed(1)} mi away`}</span></p>
        <p className="event-reason">{event.distanceMiles == null || event.format === "online" ? "Fits your preferred format" : `Within your ${event.distanceMiles <= 5 ? "nearby" : "selected"} travel area`}</p>
        <FriendLine names={event.friendNames} />
      </div>
      <span className="event-distance">{event.format === "online" ? "ONLINE" : event.distanceMiles == null ? "LOCATION" : `${event.distanceMiles.toFixed(1)} MI`}</span>
    </button>
    <div className="card-actions">
      <button className={action === "saved" ? "pressed" : ""} onClick={() => onAction(action === "saved" ? "dismissed" : "saved")} title="Save event"><Icon name="bookmark" size={16} />{action === "saved" ? "Saved" : "Save"}</button>
      <button className={action === "going" ? "pressed going" : ""} onClick={() => onAction(action === "going" ? "interested" : "going")}><Icon name="check" size={16} />{action === "going" ? "Going" : "I’m going"}</button>
      <button className="open-arrow" onClick={onSelect} title="View reasoning"><Icon name="arrow" size={17} /></button>
    </div>
  </article>;
}

function EventDetail({ event, action, onClose, onAction }: { event: Opportunity; action?: EventAction; onClose: () => void; onAction: (action: EventAction) => void }) {
  const date = dateParts(event.startsAt);
  const score = event.score;
  if (!score) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="event-detail" role="dialog" aria-modal="true" aria-label={event.title} onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Close event details"><Icon name="close" /></button>
      <div className="detail-topline"><span className="eyebrow">{event.source}</span><span className="format-chip">{event.format}</span></div>
      <h2>{event.title}</h2>
      <div className="detail-meta"><span><Icon name="calendar" size={16} />{date.day}, {date.month} {date.number} · {date.time}</span><span><Icon name="pin" size={16} />{event.format === "online" ? "Online" : event.venue || event.address || "In person"}</span></div>
      <p className="detail-description">{event.description}</p>
      <div className="tag-row">{event.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      <div className="detail-actions"><button className={action === "saved" ? "button secondary selected" : "button secondary"} onClick={() => onAction(action === "saved" ? "dismissed" : "saved")}><Icon name="bookmark" size={16} />{action === "saved" ? "Saved" : "Save"}</button><button className={action === "going" ? "button selected" : "button"} onClick={() => onAction(action === "going" ? "interested" : "going")}><Icon name="check" size={16} />{action === "going" ? "You’re going" : "I’m going"}</button><a className="button tertiary" target="_blank" rel="noreferrer" href={event.url}>Original source <Icon name="external" size={15} /></a></div>
      <FriendLine names={event.friendNames} />
      {event.provenance && <section className="provenance-panel"><div><span className="eyebrow">Source provenance</span><h3>Why MEET trusts this listing</h3></div><div className="provenance-grid"><p><span>Discovery</span>{event.sourceType === "web-discovery" ? "Web-discovered" : sourceTypeLabel(event.sourceType)}{event.provenance.discoveryQuery && <small>“{event.provenance.discoveryQuery}”</small>}</p><p><span>Extraction</span>{event.provenance.extractionMethod === "llm" ? "LLM-reasoned / Groq" : event.provenance.extractionMethod === "structured" ? "Structured source" : "Direct source"}<small>{event.provenance.extractionConfidence != null ? `${Math.round(event.provenance.extractionConfidence * 100)}% confidence` : "Source-backed"}</small></p><p><span>Domain</span>{event.provenance.sourceDomain}<a href={event.provenance.sourceUrl} target="_blank" rel="noreferrer">View source <Icon name="external" size={11} /></a></p></div><div className="evidence"><span>Page evidence</span>{event.provenance.evidence.map((item) => <p key={item}>“{item}”</p>)}</div></section>}
      <div className="score-panel fit-summary">
        <div className="score-panel-head"><div><span className="eyebrow">Why it’s here</span><h3>Built around what you told MEET</h3></div></div>
        <div className="fit-summary-grid">
          <article><span>Profile</span><p>{score.reasons.relevance}</p></article>
          <article><span>Distance</span><p>{score.reasons.distance}</p></article>
          <article><span>Time & format</span><p>{score.reasons.timing} {score.reasons.format}</p></article>
        </div>
        <p className="fit-footnote">Your goals, interests, skills, preferred format, availability, and travel area guide this ordering. There are no sliders to tune.</p>
      </div>
    </section>
  </div>;
}

function Landing({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  return <main className="landing">
    <nav className="landing-nav"><div className="brand"><span><Icon name="spark" size={18} /></span>MEET</div><button className="text-button" onClick={onSignIn}>Sign in</button></nav>
    <div className="landing-grid">
      <section className="landing-copy"><span className="eyebrow light">Opportunity intelligence, made human</span><h1>Good rooms should not be a rumor.</h1><p>MEET finds, filters, and explains the hackathons, events, and communities that move your story forward — before a lucky overheard conversation does.</p><button className="button landing-cta" onClick={onStart}>Build your signal <Icon name="arrow" /></button><small>No noisy calendar. No mystery ranking. Just the opportunities that fit — with the why in plain sight.</small></section>
      <section className="signal-orbit" aria-label="MEET opportunity signal visualization"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="signal-core"><Icon name="spark" size={29} /><span>your<br />signal</span></div><div className="float-card c1"><span className="float-icon teal"><Icon name="spark" /></span><b>AI Build Night</b><small>3.2 mi · 9.1 match</small></div><div className="float-card c2"><span className="float-icon violet"><Icon name="people" /></span><b>3 friends going</b><small>Open Source Sprint</small></div><div className="float-card c3"><span className="float-icon amber"><Icon name="compass" /></span><b>New opportunity</b><small>caught before it’s gone</small></div></section>
    </div>
    <footer>MEET exists because opportunity shouldn’t depend on who you happen to overhear.</footer>
  </main>;
}

function Chips({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = () => { const value = input.trim(); if (value && !values.includes(value)) onChange([...values, value]); setInput(""); };
  return <div className="chips-input"><div className="chips">{values.map((value) => <span key={value}>{value}<button onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Remove ${value}`}>×</button></span>)}<input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} onBlur={add} placeholder={values.length ? "Add another" : "Type and press enter"} /></div></div>;
}

function Onboarding({ profile, onFinish, onBack }: { profile: UserProfile; onFinish: (profile: UserProfile) => void; onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(profile);
  const [locationQuery, setLocationQuery] = useState(profile.location);
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState("");
  const [missed, setMissed] = useState("");
  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function readUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setParsing(true); setParseNote("");
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const fileBase64 = isPdf ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Could not read that file.")); reader.readAsDataURL(file); }) : undefined;
      const text = isPdf ? undefined : await file.text();
      const response = await fetch("/api/ai/parse-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, fileBase64, fileType: file.type }) });
      const data = await responseJson<{ profile?: Partial<UserProfile>; model?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Could not parse this file.");
      if (!data.profile) throw new Error("The profile service returned no usable profile.");
      setDraft((current) => ({ ...current, ...data.profile, skills: data.profile?.skills ?? current.skills, interests: data.profile?.interests ?? current.interests }));
      setParseNote(`Parsed with ${data.model}. Review and edit every field before continuing.`);
    } catch (error) { setParseNote(error instanceof Error ? error.message : "Could not parse this file. You can enter details below."); }
    finally { setParsing(false); }
  }
  function applyCurrentLocation() {
    if (!navigator.geolocation) { setParseNote("Your browser does not support location access. Enter a city, ZIP code, or address instead."); return; }
    navigator.geolocation.getCurrentPosition(async (position) => {
      const latitude = position.coords.latitude; const longitude = position.coords.longitude;
      try { const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitude, longitude }) }); const result = await responseJson<{ label?: string }>(response); const label = response.ok && result.label ? result.label : "Current location"; setDraft((current) => ({ ...current, latitude, longitude, location: label })); setLocationQuery(label); setParseNote("Current location is now the center of your discovery area."); } catch { setDraft((current) => ({ ...current, latitude, longitude, location: "Current location" })); setLocationQuery("Current location"); setParseNote("Current location is now the center of your discovery area."); }
    }, () => setParseNote("Location access was not granted. Enter a city, ZIP code, or address instead."), { enableHighAccuracy: false, timeout: 8000 });
  }
  const chooseLocation = (choice: LocationChoice) => { setDraft((current) => ({ ...current, location: choice.label, latitude: choice.latitude, longitude: choice.longitude })); setLocationQuery(choice.label); setParseNote(""); };
  return <main className="onboarding-shell"><button className="onboarding-brand" onClick={onBack}><span><Icon name="spark" size={18} /></span>MEET</button><section className="onboarding"><div className="onboard-progress"><span className={step >= 1 ? "active" : ""}>1</span><i /><span className={step >= 2 ? "active" : ""}>2</span><i /><span className={step >= 3 ? "active" : ""}>3</span></div>
    {step === 1 && <><span className="eyebrow">Make your signal visible</span><h1>What are you building toward?</h1><p className="onboard-intro">Bring a resume or your LinkedIn export, or simply tell us what you care about. MEET pulls the visible details into these editable fields and never stores the raw file.</p><label className="upload-zone"><input type="file" accept=".txt,.md,.pdf,.json,.csv" onChange={readUpload} /><span className="upload-icon"><Icon name="upload" /></span><b>{parsing ? "Reading your file…" : "Upload resume or LinkedIn export"}</b><small>PDF, TXT, JSON, or CSV · parsed once by Groq</small></label>{parseNote && <p className="parse-note">{parseNote}</p>}<div className="form-grid"><label>Your name<input value={draft.name} onChange={(event) => set("name", event.target.value)} /></label><label>Email for your digest<input type="email" value={draft.email ?? ""} placeholder="you@example.com" onChange={(event) => set("email", event.target.value)} /></label></div><div className="form-grid"><label>Career stage<select value={draft.careerStage} onChange={(event) => set("careerStage", event.target.value)}><option>Student / early career</option><option>Career switcher</option><option>Mid-career builder</option><option>Founder</option></select></label><label>What are you building toward?<input value={draft.goals} placeholder="e.g. Build applied AI products" onChange={(event) => set("goals", event.target.value)} /></label></div><label>Skills <Chips values={draft.skills} onChange={(values) => set("skills", values)} /></label><label>Interests <Chips values={draft.interests} onChange={(values) => set("interests", values)} /></label></>}
    {step === 2 && <><span className="eyebrow">Location & logistics</span><h1>Where should MEET look?</h1><p className="onboard-intro">Start typing a city, ZIP code, or address, then choose a result. MEET uses its coordinates—not just the text you entered.</p><label>Home base<LocationAutocomplete value={locationQuery} onChange={setLocationQuery} onSelect={chooseLocation} onUseCurrent={applyCurrentLocation} /></label><div className="form-grid location-fields"><label>Travel area<select value={draft.travelRadius} onChange={(event) => set("travelRadius", Number(event.target.value))}>{[3, 5, 10, 15, 25, 40, 60].map((miles) => <option value={miles} key={miles}>{miles} miles</option>)}</select></label><label>Event format<select value={draft.formatPreference} onChange={(event) => set("formatPreference", event.target.value as UserProfile["formatPreference"])}><option value="both">In person + online</option><option value="in-person">In person only</option><option value="online">Online only</option></select></label><label>Best times<select value={draft.availability} onChange={(event) => set("availability", event.target.value as UserProfile["availability"])}><option value="evenings">Weekday evenings</option><option value="weekdays">Weekdays</option><option value="weekends">Weekends</option><option value="flexible">Any time</option></select></label></div><LocationRadiusMap latitude={draft.latitude} longitude={draft.longitude} location={draft.location} radius={draft.travelRadius} /></>}
    {step === 3 && <><span className="eyebrow">Ready to discover</span><h1>MEET will use your story—not sliders.</h1><p className="onboard-intro">Your goals, skills, interests, schedule, format choice, and travel area shape the feed. You can update any of them in Settings.</p><div className="signal-receipt"><article><span>Looking for</span><b>{draft.goals || "The opportunities that fit your next step"}</b></article><article><span>Near</span><b>{draft.location || "your selected home base"} · {draft.travelRadius} mi</b></article><article><span>Schedule</span><b>{draft.availability === "flexible" ? "Any time" : draft.availability.replace("weekdays", "weekdays")}</b></article></div><label className="missed-field">A past opportunity you wish you hadn’t missed <small>Optional — helps MEET understand the kinds of rooms you want to catch sooner.</small><input value={missed} onChange={(event) => setMissed(event.target.value)} placeholder="e.g. local climate hackathon, Spring 2025" /></label></>}
    <div className="onboard-actions"><button className="text-button" onClick={() => step === 1 ? onBack() : setStep(step - 1)}>{step === 1 ? "Back" : "Previous"}</button><button className="button" onClick={() => step === 3 ? onFinish(draft) : setStep(step + 1)}>{step === 3 ? "See my opportunities" : "Continue"}<Icon name="arrow" /></button></div>
  </section></main>;
}

function SignInModal({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: (accessToken: string) => Promise<void> }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [status, setStatus] = useState(""); const [sending, setSending] = useState(false);
  async function submit() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setStatus("Supabase is not connected yet. Add the public URL and publishable key to .env.local first."); return; }
    if (mode === "signup" && !name.trim()) { setStatus("Add your name to create an account."); return; }
    if (password.length < 8) { setStatus("Use a password with at least 8 characters."); return; }
    setSending(true); setStatus("");
    try {
      const result = mode === "signup"
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/auth/callback`, data: { full_name: name.trim() } } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) { setStatus(result.error.message); return; }
      if (result.data.session) { await onAuthenticated(result.data.session.access_token); onClose(); return; }
      setStatus("Check your inbox to confirm your account, then come back to sign in.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "We could not complete that request."); }
    finally { setSending(false); }
  }
  const creating = mode === "signup";
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="signin-modal" role="dialog" aria-modal="true" aria-label={creating ? "Create a MEET account" : "Sign in to MEET"} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close account dialog"><Icon name="close" /></button><span className="brand-mini"><Icon name="spark" size={16} /> MEET</span><div className="account-tabs"><button className={!creating ? "active" : ""} onClick={() => { setMode("signin"); setStatus(""); }}>Sign in</button><button className={creating ? "active" : ""} onClick={() => { setMode("signup"); setStatus(""); }}>Create account</button></div><h2>{creating ? "Make your MEET account." : "Welcome back."}</h2><p>{creating ? "Keep your profile, opportunities, and decisions private and available on every device." : "Sign in to continue with your saved MEET profile."}</p>{creating && <label>Name<input autoComplete="name" placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} /></label>}<label>Email<input autoComplete="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input autoComplete={creating ? "new-password" : "current-password"} type="password" placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} /></label><button className="button full" onClick={() => void submit()} disabled={!email || !password || sending}>{sending ? "Working…" : creating ? "Create account" : "Sign in"}<Icon name={creating ? "arrow" : "check"} size={16} /></button>{status && <p className="signin-status">{status}</p>}<small>MEET uses Supabase Auth. Your private records stay protected by row-level security.</small></section></div>;
}

export function MeetApp() {
  const [stage, setStage] = useState<Stage>("landing");
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [tab, setTab] = useState<Tab>("discover");
  const [events, setEvents] = useState<Opportunity[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>(initialLedger);
  const [sourceMode, setSourceMode] = useState<"live" | "demo" | "empty" | "idle">("idle");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [actions, setActions] = useState<Record<string, EventAction>>({});
  const [filter, setFilter] = useState("all");
  const [format, setFormat] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [toast, setToast] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [digestFrequency, setDigestFrequency] = useState<"daily" | "weekly" | "on-demand">("weekly");
  const supabaseReady = supabaseBrowserConfigured();

  const applyAccountPayload = useCallback((payload: AccountProfilePayload) => {
    setProfile(payload.profile);
    window.localStorage.setItem("meet-profile", JSON.stringify(payload.profile));
    setDigestFrequency(payload.digestFrequency ?? "weekly");
    setAuthenticated(true);
    setStage(payload.onboardingCompleted ? "app" : "onboarding");
  }, []);

  const hydrateAuthenticatedAccount = useCallback(async (accessToken: string) => {
    const payload = await accountProfile(accessToken);
    applyAccountPayload(payload);
    const savedActions = await accountActions(accessToken).catch(() => null);
    if (savedActions) setActions(savedActions);
  }, [applyAccountPayload]);

  const persistAccountProfile = useCallback(async (next: UserProfile, options: { digestFrequency?: "daily" | "weekly" | "on-demand"; completeOnboarding?: boolean } = {}) => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return false;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    try {
      const payload = await accountProfile(session.access_token, { profile: next, digestFrequency: options.digestFrequency, completeOnboarding: options.completeOnboarding });
      applyAccountPayload(payload);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? `Saved locally; cloud sync needs attention: ${error.message}` : "Saved locally; cloud sync needs attention.");
      return false;
    }
  }, [applyAccountPayload]);

  useEffect(() => {
    const saved = window.localStorage.getItem("meet-profile");
    const savedActions = window.localStorage.getItem("meet-actions");
    const supabase = createSupabaseBrowserClient();
    let mounted = true;
    const restoreLocal = () => {
      if (saved) { try { setProfile(JSON.parse(saved) as UserProfile); setStage("app"); } catch { /* ignore malformed local state */ } }
    };
    const restore = async () => {
      if (savedActions) { try { if (mounted) setActions(JSON.parse(savedActions) as Record<string, EventAction>); } catch { /* ignore malformed local state */ } }
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try { await hydrateAuthenticatedAccount(session.access_token); return; }
          catch (error) { if (mounted) { setAuthenticated(true); setToast(error instanceof Error ? `Signed in, but cloud profile sync needs attention: ${error.message}` : "Signed in, but cloud profile sync needs attention."); } }
        }
      }
      if (mounted) restoreLocal();
    };
    void restore();
    const listener = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (!session) { setAuthenticated(false); return; }
      void hydrateAuthenticatedAccount(session.access_token).catch(() => setAuthenticated(true));
    });
    return () => { mounted = false; listener?.data.subscription.unsubscribe(); };
  }, [hydrateAuthenticatedAccount]);
  useEffect(() => { if (toast) { const id = window.setTimeout(() => setToast(""), 3500); return () => window.clearTimeout(id); } }, [toast]);
  const persistEventAction = async (event: Opportunity, action: EventAction) => {
    const supabase = createSupabaseBrowserClient();
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    if (!session || event.sourceType === "demo") return;
    try {
      const response = await fetch("/api/account/preferences", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ event: { id: event.id, url: event.url }, action }) });
      const result = await responseJson<{ persisted?: boolean; error?: string }>(response);
      if (!response.ok) setToast(result.error || "Your decision is saved locally; cloud sync needs attention.");
    } catch { setToast("Your decision is saved locally; cloud sync needs attention."); }
  };
  const updateAction = (event: Opportunity, action: EventAction) => { setActions((current) => { const next = { ...current, [event.id]: action }; window.localStorage.setItem("meet-actions", JSON.stringify(next)); return next; }); setToast(action === "going" ? `You’re going to ${event.title}.` : action === "saved" ? `${event.title} saved.` : "Preference updated."); void persistEventAction(event, action); };
  const finishOnboarding = (next: UserProfile) => { setProfile(next); window.localStorage.setItem("meet-profile", JSON.stringify(next)); setEvents([]); setSourceMode("idle"); setStage("app"); setToast("Finding opportunities around your selected home base…"); void persistAccountProfile(next, { completeOnboarding: true, digestFrequency }); void refresh(next); };
  const logOut = async () => {
    const supabase = createSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    window.localStorage.removeItem("meet-profile");
    window.localStorage.removeItem("meet-actions");
    setActions({}); setProfile(defaultProfile); setEvents([]); setSourceMode("idle"); setSelected(null); setAuthenticated(false); setStage("landing");
  };
  const refresh = async (profileToRefresh: UserProfile = profile) => { setRefreshing(true); setLedger((current) => [{ id: "refreshing", kind: "system", status: "running", title: "Refreshing MEET", detail: "Fast, bounded source checks are running for your selected area.", at: "now" }, ...current]); try { const supabase = createSupabaseBrowserClient(); const session = supabase ? (await supabase.auth.getSession()).data.session : null; const response = await fetch("/api/pipeline/refresh", { method: "POST", headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify({ profile: profileToRefresh }) }); const result = await responseJson<RefreshResult & { error?: string }>(response); if (!response.ok) throw new Error(result.error || "The pipeline could not refresh."); setEvents(result.events); setLedger(result.ledger); setSourceMode(result.mode); setToast(result.mode === "live" ? "Fresh opportunities are ready." : result.mode === "empty" ? "Live sources are connected, but no nearby events were found yet." : "No live source is configured — showing the labeled sample feed."); } catch (error) { setToast(error instanceof Error ? error.message : "Refresh failed."); setLedger((current) => [{ id: "error", kind: "system", status: "attention", title: "Refresh needs attention", detail: "The existing feed is still available.", at: "now" }, ...current.filter((item) => item.id !== "refreshing")]); } finally { setRefreshing(false); } };
  const categories = ["all", ...Array.from(new Set(events.map((event) => event.category)))];
  const filtered = useMemo(() => events.filter((event) => actions[event.id] !== "dismissed" && (filter === "all" || event.category === filter) && (format === "all" || event.format === format)), [events, actions, filter, format]);
  const top = filtered.filter((event) => (event.score?.final ?? 0) >= 6.3); const low = filtered.filter((event) => (event.score?.final ?? 0) < 6.3).slice(0, 2);
  const accountReady = async (accessToken: string) => { await hydrateAuthenticatedAccount(accessToken); setToast("Your MEET account is ready."); };
  const syncStatus = sourceMode === "live" ? "Live sources connected" : sourceMode === "empty" ? "Live sources connected · no nearby events yet" : sourceMode === "demo" ? "Sample mode — add sources to go live" : "Ready to refresh sources";
  const syncDot = sourceMode === "live" ? "live-dot" : sourceMode === "demo" ? "demo-dot" : "empty-dot";
  if (stage === "landing") return <><Landing onStart={() => setStage("onboarding")} onSignIn={() => setShowSignIn(true)} />{showSignIn && <SignInModal onClose={() => setShowSignIn(false)} onAuthenticated={accountReady} />}</>;
  if (stage === "onboarding") return <Onboarding profile={profile} onFinish={finishOnboarding} onBack={() => setStage("landing")} />;
  const nav: { key: Tab; label: string; icon: string }[] = [{ key: "discover", label: "Discover", icon: "compass" }, { key: "ledger", label: "Trust ledger", icon: "ledger" }, { key: "network", label: "Network", icon: "people" }, { key: "settings", label: "Settings", icon: "settings" }];
  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span><Icon name="spark" size={18} /></span>MEET</div><div className="nav-group">{nav.map((item) => <button className={tab === item.key ? "nav-item active" : "nav-item"} key={item.key} onClick={() => setTab(item.key)}><Icon name={item.icon} size={18} />{item.label}{item.key === "ledger" && <i className="nav-pulse" />}</button>)}</div><div className="sidebar-bottom"><button className={tab === "about" ? "nav-item active" : "nav-item"} onClick={() => setTab("about")}><Icon name="info" size={18} />Why MEET</button><button className="user-chip" onClick={() => authenticated ? setTab("settings") : setShowSignIn(true)}><span>{profile.name.slice(0, 1).toUpperCase()}</span><div><b>{profile.name}</b><small>{authenticated ? "Signed in" : supabaseReady ? "Local profile · sign in" : "Local profile"}</small></div></button><button className="nav-item logout-button" onClick={() => void logOut()}><Icon name="logout" size={18} />{authenticated ? "Log out" : "Clear profile"}</button></div></aside><section className="workspace"><header className="topbar"><div className="mobile-brand brand"><span><Icon name="spark" size={16} /></span>MEET</div><div className="sync-status"><span className={syncDot} />{syncStatus}</div><button className="refresh-button" onClick={() => void refresh()} disabled={refreshing}><Icon name="refresh" size={17} />{refreshing ? "Refreshing…" : "Refresh MEET"}</button></header>{tab === "discover" && <Discover profile={profile} categories={categories} filter={filter} setFilter={setFilter} format={format} setFormat={setFormat} top={top} low={low} actions={actions} onAction={updateAction} onSelect={setSelected} />}{tab === "ledger" && <Ledger ledger={ledger} />}{tab === "network" && <Network />}{tab === "settings" && <Settings key={`${profile.name}-${profile.email ?? ""}-${profile.location}-${digestFrequency}`} profile={profile} events={events} frequency={digestFrequency} onSave={async (next, frequency) => { setProfile(next); window.localStorage.setItem("meet-profile", JSON.stringify(next)); setDigestFrequency(frequency); const synced = await persistAccountProfile(next, { digestFrequency: frequency }); setToast(synced ? "Preferences saved to your MEET account." : "Preferences saved on this device. Sign in to sync them."); }} setToast={setToast} />}{tab === "about" && <About />}</section>{selected && <EventDetail event={selected} action={actions[selected.id]} onClose={() => setSelected(null)} onAction={(action) => updateAction(selected, action)} />}{showSignIn && <SignInModal onClose={() => setShowSignIn(false)} onAuthenticated={accountReady} />}{toast && <div className="toast"><Icon name="check" size={16} />{toast}</div>}</main>;
}

function Discover({ profile, categories, filter, setFilter, format, setFormat, top, low, actions, onAction, onSelect }: { profile: UserProfile; categories: string[]; filter: string; setFilter: (value: string) => void; format: string; setFormat: (value: string) => void; top: Opportunity[]; low: Opportunity[]; actions: Record<string, EventAction>; onAction: (event: Opportunity, action: EventAction) => void; onSelect: (event: Opportunity) => void }) {
  const going = Object.values(actions).filter((action) => action === "going").length;
  const ordered = [...top, ...low];
  return <div className="page discover-page"><header className="page-title"><div><span className="eyebrow">YOUR LOCAL DISCOVERY</span><h1>Good to see you, {profile.name}.</h1><p>Opportunities shaped by your story and your {profile.travelRadius}-mile travel area.</p></div><div className="tiny-stats"><span><b>{going}</b> going</span><span><b>{Object.values(actions).filter((action) => action === "saved").length}</b> saved</span></div></header><section className="insight-banner"><div className="insight-icon"><Icon name="pin" /></div><div><span className="eyebrow">YOUR DISCOVERY AREA</span><h2>{profile.location || "Your home base"} · {profile.travelRadius} miles</h2><p>MEET prioritizes practical in-person options and includes online events when they match your selected format.</p></div><button onClick={() => document.getElementById("nearby-feed")?.scrollIntoView({ behavior: "smooth" })}>Explore nearby <Icon name="arrow" size={16} /></button></section><div className="filter-row" id="nearby-feed"><div className="filter-tabs">{categories.map((category) => <button className={filter === category ? "selected" : ""} key={category} onClick={() => setFilter(category)}>{category === "all" ? "All opportunities" : category}</button>)}</div><select aria-label="Filter by format" value={format} onChange={(event) => setFormat(event.target.value)}><option value="all">All formats</option><option value="in-person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></div><section className="feed"><div className="section-heading"><div><span className="eyebrow">FOR YOUR NEXT STEP</span><h2>Opportunities worth a look.</h2></div><span>{ordered.length} opportunities</span></div>{ordered.length ? ordered.map((event) => <EventCard key={event.id} event={event} action={actions[event.id]} onAction={(action) => onAction(event, action)} onSelect={() => onSelect(event)} />) : <div className="empty-state">No matching opportunities in this view. Try a broader filter.</div>}</section></div>;
}

function Ledger({ ledger }: { ledger: LedgerEntry[] }) { const total = ledger.filter((entry) => entry.status === "complete").length; return <div className="page ledger-page"><header className="page-title"><div><span className="eyebrow">Auditable automation</span><h1>Trust ledger</h1><p>Every source, merge, score, and exception from your most recent refresh.</p></div><div className="run-card"><span>Last run</span><b>{total} steps complete</b><small>Parallel ingestion enabled</small></div></header><section className="ledger-explainer"><Icon name="ledger" size={22} /><p>MEET uses language models only when language reasoning earns its keep. Deduplication, distance, filters, weights, and low-score explanations are plain, inspectable code.</p></section><div className="ledger-list">{ledger.map((entry, index) => <article className="ledger-entry" key={entry.id}><div className={`ledger-status ${entry.status}`}><Icon name={entry.status === "complete" ? "check" : entry.status === "running" ? "refresh" : "info"} size={15} /></div><div className="ledger-line" /><div className="ledger-content"><div><span className="entry-kind">{entry.kind}</span><h2>{entry.title}</h2><p>{entry.detail}</p></div><aside><span>{entry.at}</span>{entry.duration && <b>{entry.duration}</b>}</aside></div>{index === ledger.length - 1 && <div className="ledger-end" />}</article>)}</div><section className="decision-table"><div className="section-heading"><div><span className="eyebrow">Architecture receipt</span><h2>What uses AI — and what doesn’t.</h2></div></div><div className="table-row header"><span>Decision</span><span>Method</span><span>Why</span></div><div className="table-row"><span>Profile & page extraction</span><span className="method ai">Groq, Llama 3.1 8B</span><span>Unstructured language needs interpretation.</span></div><div className="table-row"><span>Relevance</span><span className="method ai">Groq, Llama 3.1 8B</span><span>Semantic match against your profile.</span></div><div className="table-row"><span>Dedup, rank math & explanations</span><span className="method">Deterministic code</span><span>Fast, cheap, consistent, inspectable.</span></div></section></div>; }

function Network() { const [email, setEmail] = useState(""); const [requested, setRequested] = useState(false); const [requestNote, setRequestNote] = useState(""); const friends = [{ name: "Maya Chen", handle: "@mayacodes", note: "Going to Open Source for Education Sprint", initials: "MC" }, { name: "Jordan Bell", handle: "@jordansbuilds", note: "Going to AI Build Night + 1 more", initials: "JB" }, { name: "Priya Shah", handle: "@priyashah", note: "Going to Build Week", initials: "PS" }]; const sendRequest = async () => { if (!email) return; const supabase = createSupabaseBrowserClient(); if (!supabase) { setRequestNote("Connect Supabase and sign in to send a real request."); return; } const { error } = await supabase.rpc("request_connection_by_identifier", { identifier: email }); if (error) { setRequestNote(error.message); return; } setRequested(true); setRequestNote("Connection request sent."); setEmail(""); }; return <div className="page network-page"><header className="page-title"><div><span className="eyebrow">Your small, useful network</span><h1>Go where your people are.</h1><p>Connections are private and only power attendance context — no feed, no noise.</p></div></header><section className="network-add"><div><span className="eyebrow">Add a connection</span><h2>Know someone who should be in the room?</h2></div><div className="add-form"><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email or username" /><button className="button" onClick={sendRequest}>{requested ? "Request sent" : "Send request"}</button></div></section>{requestNote && <p className="network-note">{requestNote}</p>}<section className="friends-list"><div className="section-heading"><div><span className="eyebrow">Accepted connections</span><h2>3 people in your network</h2></div></div>{friends.map((friend, index) => <article className="friend-card" key={friend.name}><span className={`friend-avatar f${index}`}>{friend.initials}</span><div><h3>{friend.name} <small>{friend.handle}</small></h3><p><span className="going-dot" />{friend.note}</p></div><button className="text-button">Remove</button></article>)}</section><section className="network-privacy"><Icon name="info" /><div><b>Attendance is visible only to accepted connections.</b><p>This is enforced in Supabase with Row Level Security; MEET never exposes a public attendance directory.</p></div></section></div>; }

function Settings({ profile, events, frequency, onSave, setToast }: { profile: UserProfile; events: Opportunity[]; frequency: "daily" | "weekly" | "on-demand"; onSave: (profile: UserProfile, frequency: "daily" | "weekly" | "on-demand") => Promise<void>; setToast: (value: string) => void }) {
  const [draft, setDraft] = useState(profile); const [locationQuery, setLocationQuery] = useState(profile.location); const [draftFrequency, setDraftFrequency] = useState(frequency); const [saving, setSaving] = useState(false);
  const change = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setHome = (choice: LocationChoice) => { setDraft((current) => ({ ...current, location: choice.label, latitude: choice.latitude, longitude: choice.longitude })); setLocationQuery(choice.label); };
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setToast("This browser does not support location access. Search for a city, ZIP code, or address instead."); return; }
    setToast("Finding your current location…");
    navigator.geolocation.getCurrentPosition(async (position) => {
      const latitude = position.coords.latitude; const longitude = position.coords.longitude;
      try {
        const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitude, longitude }) });
        const result = await responseJson<{ label?: string }>(response);
        const label = response.ok && result.label ? result.label : "Current location";
        setDraft((current) => ({ ...current, latitude, longitude, location: label })); setLocationQuery(label);
        setToast("Your current location now centers the discovery map.");
      } catch {
        setDraft((current) => ({ ...current, latitude, longitude, location: "Current location" })); setLocationQuery("Current location");
        setToast("Your current location now centers the discovery map.");
      }
    }, () => setToast("Location access was not granted. Search for a city, ZIP code, or address instead."), { enableHighAccuracy: false, timeout: 8000 });
  };
  const save = async () => { setSaving(true); try { await onSave(draft, draftFrequency); } finally { setSaving(false); } };
  const sendDigest = async () => {
    if (!draft.email) { setToast("Add an email address before sending a test digest."); return; }
    try {
      const response = await fetch("/api/digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: draft.email, name: draft.name, events }) });
      const result = await responseJson<{ error?: string }>(response);
      setToast(response.ok ? "Test digest sent." : result.error || "Could not send digest.");
    } catch { setToast("Could not send the test digest."); }
  };
  return <div className="page settings-page"><header className="page-title"><div><span className="eyebrow">YOUR PREFERENCES</span><h1>Settings</h1><p>Tell MEET what matters; it handles the ordering in the background.</p></div></header><section className="settings-card"><div><span className="eyebrow">DIGEST DELIVERY</span><h2>Let the signal come to you.</h2><p>Choose when you want a concise email digest.</p></div><div className="settings-fields"><label>Email for digest<input type="email" value={draft.email ?? ""} placeholder="you@example.com" onChange={(event) => change("email", event.target.value)} /></label><label>Frequency<select value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value as "daily" | "weekly" | "on-demand")}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="on-demand">On demand</option></select></label><button className="text-button send-test" onClick={() => void sendDigest()}><Icon name="mail" size={15} />Send a test digest</button></div></section><section className="settings-card location-settings"><div><span className="eyebrow">DISCOVERY AREA</span><h2>Keep the feed practical.</h2><p>Search for a real place or use your current location to update the live map and distance calculations.</p></div><div className="settings-fields two"><label>Home base<LocationAutocomplete value={locationQuery} onChange={setLocationQuery} onSelect={setHome} onUseCurrent={useCurrentLocation} /></label><label>Travel area<select value={draft.travelRadius} onChange={(event) => change("travelRadius", Number(event.target.value))}>{[3, 5, 10, 15, 25, 40, 60].map((miles) => <option value={miles} key={miles}>{miles} miles</option>)}</select></label><label>Format<select value={draft.formatPreference} onChange={(event) => change("formatPreference", event.target.value as UserProfile["formatPreference"])}><option value="both">In person + online</option><option value="in-person">In person only</option><option value="online">Online only</option></select></label></div><LocationRadiusMap latitude={draft.latitude} longitude={draft.longitude} location={draft.location} radius={draft.travelRadius} /></section><section className="settings-card profile-reminder"><div><span className="eyebrow">HOW RESULTS ARE ORDERED</span><h2>Your words do the work.</h2><p>Goals, skills, interests, schedule, format, and distance guide the feed. There are no ranking sliders to maintain.</p></div><button className="text-button" onClick={() => setToast("Update your goals and interests by restarting onboarding from the MEET home page.")}>How matching works <Icon name="arrow" size={15} /></button></section><button className="button save-settings" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save changes"} <Icon name="check" size={16} /></button></div>;
}

function About() { return <div className="page about-page"><header className="about-hero"><span className="eyebrow">Why MEET</span><h1>Opportunity shouldn’t be a rumor you have to be lucky enough to overhear.</h1><p>MEET started with a familiar kind of miss: learning about the exact right hackathon six days too late, by overhearing a Discord conversation. Not because of a lack of ability or effort — because there was no system built to reach the right person early enough.</p></header><section className="about-grid"><article><span>01</span><h2>Find</h2><p>We gather from APIs, structured feeds, and a small set of permission-safe sources in parallel.</p></article><article><span>02</span><h2>Reason</h2><p>We use a small, fast Groq model only where language understanding matters — profile, extraction, relevance.</p></article><article><span>03</span><h2>Show the work</h2><p>Every match, merge, and low score comes with the evidence needed to question it.</p></article></section><section className="about-principle"><Icon name="spark" size={28} /><div><span className="eyebrow">The principle</span><h2>Foresight should be infrastructure.</h2><p>There is plenty of noise. The useful part is a system that notices the few rooms where your next collaborator, skill, or chance might be waiting — and tells you why it thinks so.</p></div></section></div>; }
