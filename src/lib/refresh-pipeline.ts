import { defaultProfile, makeDemoEvents } from "./demo-data";
import { scoreOpportunities } from "./engine";
import { getRelevanceScores, groqConfigured, groqModel } from "./groq";
import { ingestOpportunities } from "./ingestion";
import { persistRefresh } from "./persistence";
import { LedgerEntry, RefreshResult, UserProfile } from "./types";

export async function runRefreshPipeline(profile: UserProfile = defaultProfile, userId?: string): Promise<RefreshResult> {
  const ingestion = await ingestOpportunities(profile);
  if (!ingestion.events.length) {
    const hasConfiguredLiveSource = ingestion.sources.some((source) => source.status !== "skipped");
    const ledger: LedgerEntry[] = [...ingestion.ledger];
    if (userId) { const saved = await persistRefresh(userId, profile, [], ledger, ingestion.sources, ingestion.discovery); if (!saved.persisted) ledger.push({ id: "persist-warning", kind: "system", status: "attention", title: "Database sync needs attention", detail: saved.error ?? "Refresh completed but could not be persisted.", at: "just now" }); }
    if (hasConfiguredLiveSource) {
      ledger.push({ id: "empty-live", kind: "system", status: "attention", title: "No live opportunities found", detail: "Configured sources completed without a usable event. No sample cards were mixed into this refresh.", at: "just now" });
      return { mode: "empty", events: [], sources: ingestion.sources, ledger };
    }
    ledger.push({ id: "demo", kind: "system", status: "attention", title: "Showing the sample feed", detail: "No live source is configured. Demo opportunities are clearly separated from future live sources.", at: "just now" });
    return { mode: "demo", events: makeDemoEvents(profile).map((event) => ({ ...event, relevanceMethod: "fallback" as const })), sources: ingestion.sources, ledger };
  }
  let relevanceScores: Record<string, number> = {}; let relevanceReasons: Record<string, string> = {}; const ledger: LedgerEntry[] = [...ingestion.ledger];
  if (groqConfigured()) {
    try {
      // Keep the semantic call quick even when several official calendars are
      // connected. All cards still get deterministic scoring; Groq refines the
      // highest-potential 48 candidates only.
      const relevanceCandidates = scoreOpportunities(ingestion.events, profile).slice(0, 48);
      const relevance = await getRelevanceScores(relevanceCandidates, profile); relevanceScores = relevance.scores; relevanceReasons = relevance.reasons;
    }
    catch (error) { ledger.push({ id: "relevance-fallback", kind: "score", status: "attention", title: "Groq relevance unavailable", detail: `${error instanceof Error ? error.message : "Reasoning request failed."} A deterministic relevance fallback was used for this run.`, at: "just now" }); }
  }
  const usedLlm = groqConfigured() && Object.keys(relevanceScores).length > 0;
  const events = scoreOpportunities(ingestion.events, profile, relevanceScores, relevanceReasons).map((event) => ({ ...event, relevanceMethod: usedLlm ? "llm" as const : "fallback" as const }));
  ledger.push({ id: "scoring", kind: "score", status: "complete", title: "Score engine completed", detail: `${events.length} events ranked. Relevance ${usedLlm ? `was reasoned by ${groqModel} for the strongest 48 candidates` : "used a transparent keyword fallback"}; distance, format, timing, weights, and explanations were computed in code.`, at: "just now" });
  if (userId) { const saved = await persistRefresh(userId, profile, events, ledger, ingestion.sources, ingestion.discovery); if (!saved.persisted) ledger.push({ id: "persist-warning", kind: "system", status: "attention", title: "Database sync needs attention", detail: saved.error ?? "Refresh completed but could not be persisted.", at: "just now" }); }
  return { mode: "live", events, sources: ingestion.sources, ledger };
}
