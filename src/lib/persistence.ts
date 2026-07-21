import { createSupabaseAdminClient } from "./supabase";
import { DiscoveryDiagnostics, LedgerEntry, Opportunity, UserProfile } from "./types";
import { toProvenanceRecord } from "./web-discovery";

const durationMilliseconds = (duration?: string) => {
  const seconds = Number(duration?.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
};
const sourceDomain = (event: Opportunity) => event.provenance?.sourceDomain ?? (() => { try { return new URL(event.url).hostname; } catch { return null; } })();

export async function authenticatedUserId(authorization: string | null) {
  const token = authorization?.replace(/^Bearer\s+/i, ""); const admin = createSupabaseAdminClient();
  if (!token || !admin) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

export async function persistRefresh(userId: string, profile: UserProfile, events: Opportunity[], ledger: LedgerEntry[], sources: unknown, discovery?: DiscoveryDiagnostics) {
  const admin = createSupabaseAdminClient(); if (!admin) return { persisted: false, error: "Supabase service credentials are not configured." };
  try {
    const { data: run, error: runError } = await admin.from("refresh_runs").insert({ user_id: userId, status: "complete", source_summary: sources, completed_at: new Date().toISOString() }).select("id").single();
    if (runError || !run) throw runError ?? new Error("Could not create refresh run.");
    const realEvents = events.filter((event) => event.sourceType !== "demo");
    const eventRows = realEvents.map((event) => {
      const provenance = toProvenanceRecord(event);
      return {
        external_id: event.externalId ?? event.id,
        canonical_url: `${event.url}#meet-${event.id}`,
        source: event.source,
        source_type: event.sourceType,
        title: event.title,
        description: event.description,
        starts_at: event.startsAt,
        ends_at: event.endsAt ?? null,
        timezone: event.timezone ?? null,
        event_format: event.format,
        venue: event.venue ?? null,
        address: event.address ?? null,
        latitude: event.latitude ?? null,
        longitude: event.longitude ?? null,
        category: event.category,
        tags: event.tags,
        scale_score: event.score?.caliber ?? null,
        scale_reasoning: event.caliberReason ?? null,
        source_domain: provenance?.source_domain ?? sourceDomain(event),
        discovery_query: provenance?.discovery_query ?? null,
        extraction_method: provenance?.extraction_method ?? null,
        extraction_confidence: provenance?.extraction_confidence ?? null,
        evidence_snippets: provenance?.evidence_snippets ?? [],
        robots_decision: provenance?.robots_decision ?? null,
        registration_url: provenance?.registration_url ?? null,
      };
    });
    const ids = new Map<string, string>();
    if (eventRows.length) {
      const { data: stored, error } = await admin.from("events").upsert(eventRows, { onConflict: "canonical_url" }).select("id, canonical_url");
      if (error) throw error;
      stored?.forEach((storedEvent) => ids.set(storedEvent.canonical_url, storedEvent.id));
    }
    const scoreRows = realEvents.flatMap((event) => {
      const score = event.score; const id = ids.get(`${event.url}#meet-${event.id}`); if (!score || !id) return [];
      return [{ user_id: userId, event_id: id, relevance_score: score.relevance, distance_score: score.distance, format_score: score.format, timing_score: score.timing, caliber_score: score.caliber, final_score: score.final, relevance_reasoning: score.reasons.relevance, low_score_explanation: score.lowScoreExplanation, weights: profile.weights, computed_at: new Date().toISOString() }];
    });
    if (scoreRows.length) { const { error } = await admin.from("event_scores").upsert(scoreRows, { onConflict: "user_id,event_id" }); if (error) throw error; }
    const logs = ledger.map((entry) => ({ run_id: run.id, kind: entry.kind, status: entry.status, title: entry.title, detail: entry.detail, duration_ms: durationMilliseconds(entry.duration) }));
    if (logs.length) { const { error } = await admin.from("pipeline_logs").insert(logs); if (error) throw error; }
    if (discovery) await persistDiscoveryDiagnostics(admin, run.id, userId, profile, discovery);
    return { persisted: true, runId: run.id };
  } catch (error) { return { persisted: false, error: error instanceof Error ? error.message : "Could not persist this refresh." }; }
}

async function persistDiscoveryDiagnostics(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, refreshRunId: string, userId: string, profile: UserProfile, diagnostics: DiscoveryDiagnostics) {
  const { data: discoveryRun, error } = await admin.from("web_discovery_runs").insert({ refresh_run_id: refreshRunId, user_id: userId, status: "complete", configured_region: profile.location, query_count: diagnostics.queries.length, candidate_count: diagnostics.candidates.length, fetched_count: diagnostics.fetched, structured_extraction_count: diagnostics.structuredExtractions, llm_extraction_count: diagnostics.llmExtractions, completed_at: new Date().toISOString() }).select("id").single();
  if (error || !discoveryRun) throw error ?? new Error("Could not create web discovery run.");
  if (diagnostics.queries.length) { const { error: queryError } = await admin.from("discovery_queries").insert(diagnostics.queries.map((query, position) => ({ web_discovery_run_id: discoveryRun.id, query: query.query, query_origin: query.origin, position }))); if (queryError) throw queryError; }
  if (!diagnostics.candidates.length) return;
  const candidateRows = diagnostics.candidates.map((candidate) => ({ web_discovery_run_id: discoveryRun.id, discovery_query: candidate.query, original_url: candidate.url, normalized_url: candidate.normalizedUrl, canonical_url: candidate.normalizedUrl, source_domain: candidate.domain, title: candidate.title ?? null, published_at: candidate.publishedDate && !Number.isNaN(Date.parse(candidate.publishedDate)) ? new Date(candidate.publishedDate).toISOString() : null, decision: candidate.decision, reason: candidate.reason ?? null }));
  const { data: stored, error: candidateError } = await admin.from("discovery_candidates").insert(candidateRows).select("id, normalized_url, decision"); if (candidateError) throw candidateError;
  const attemptRows = (stored ?? []).flatMap((candidate) => candidate.decision === "robots-disallowed" ? [{ discovery_candidate_id: candidate.id, robots_decision: "disallowed", outcome: "skipped", error_detail: "robots.txt disallowed this path." }] : candidate.decision === "fetched" ? [{ discovery_candidate_id: candidate.id, robots_decision: "allowed", outcome: "fetched" }] : candidate.decision === "error" ? [{ discovery_candidate_id: candidate.id, robots_decision: "allowed", outcome: "failed", error_detail: "Page fetch failed." }] : []);
  if (attemptRows.length) { const { error: attemptsError } = await admin.from("crawl_attempts").insert(attemptRows); if (attemptsError) throw attemptsError; }
  const domains = [...new Set(diagnostics.candidates.map((candidate) => candidate.domain).filter((domain) => domain !== "invalid"))];
  if (domains.length) { const { error: domainError } = await admin.from("source_domain_metadata").upsert(domains.map((domain) => ({ source_domain: domain, last_seen_at: new Date().toISOString() })), { onConflict: "source_domain" }); if (domainError) throw domainError; }
}

export function profileFromDatabase(row: Record<string, unknown>): UserProfile {
  const weights = row.weights as Partial<UserProfile["weights"]> | null;
  return { name: typeof row.full_name === "string" ? row.full_name : "MEET member", skills: Array.isArray(row.skills) ? row.skills.filter((item): item is string => typeof item === "string") : [], interests: Array.isArray(row.interests) ? row.interests.filter((item): item is string => typeof item === "string") : [], careerStage: typeof row.career_stage === "string" ? row.career_stage : "Professional", goals: typeof row.goals === "string" ? row.goals : "Find relevant professional opportunities.", location: typeof row.location_label === "string" ? row.location_label : "", latitude: Number(row.latitude) || 0, longitude: Number(row.longitude) || 0, travelRadius: Number(row.travel_radius_miles) || 15, formatPreference: row.format_preference === "online" || row.format_preference === "in-person" ? row.format_preference : "both", availability: row.availability === "weekdays" || row.availability === "evenings" || row.availability === "weekends" ? row.availability : "flexible", weights: { relevance: Number(weights?.relevance) || 38, distance: Number(weights?.distance) || 20, format: Number(weights?.format) || 14, timing: Number(weights?.timing) || 13, caliber: Number(weights?.caliber) || 15 } };
}
