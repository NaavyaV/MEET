import { defaultProfile, makeDemoEvents } from "./demo-data";
import { scoreOpportunities } from "./engine";
import { getRelevanceScores, groqConfigured, groqModel } from "./groq";
import { ingestOpportunities } from "./ingestion";
import { persistRefresh } from "./persistence";
import { LedgerEntry, RefreshResult, UserProfile } from "./types";

export async function runRefreshPipeline(profile: UserProfile = defaultProfile, userId?: string): Promise<RefreshResult> {
  const ingestion = await ingestOpportunities(profile);
  if (!ingestion.events.length) {
    const ledger: LedgerEntry[] = [...ingestion.ledger, { id: "demo", kind: "system", status: "attention", title: "Showing the sample feed", detail: "No live sources returned events. Demo opportunities are clearly separated from your configured sources.", at: "just now" }];
    if (userId) { const saved = await persistRefresh(userId, profile, [], ledger, ingestion.sources, ingestion.discovery); if (!saved.persisted) ledger.push({ id: "persist-warning", kind: "system", status: "attention", title: "Database sync needs attention", detail: saved.error ?? "Refresh completed but could not be persisted.", at: "just now" }); }
    return { mode: "demo", events: makeDemoEvents(profile).map((event) => ({ ...event, relevanceMethod: "fallback" as const })), sources: ingestion.sources, ledger };
  }
  let relevanceScores: Record<string, number> = {}; let relevanceReasons: Record<string, string> = {}; const ledger: LedgerEntry[] = [...ingestion.ledger];
  if (groqConfigured()) {
    try { const relevance = await getRelevanceScores(ingestion.events, profile); relevanceScores = relevance.scores; relevanceReasons = relevance.reasons; }
    catch (error) { ledger.push({ id: "relevance-fallback", kind: "score", status: "attention", title: "Groq relevance unavailable", detail: `${error instanceof Error ? error.message : "Reasoning request failed."} A deterministic relevance fallback was used for this run.`, at: "just now" }); }
  }
  const usedLlm = groqConfigured() && Object.keys(relevanceScores).length > 0;
  const events = scoreOpportunities(ingestion.events, profile, relevanceScores, relevanceReasons).map((event) => ({ ...event, relevanceMethod: usedLlm ? "llm" as const : "fallback" as const }));
  ledger.push({ id: "scoring", kind: "score", status: "complete", title: "Score engine completed", detail: `${events.length} events ranked. Relevance ${usedLlm ? `was reasoned by ${groqModel}` : "used a transparent keyword fallback"}; distance, format, timing, weights, and explanations were computed in code.`, at: "just now" });
  if (userId) { const saved = await persistRefresh(userId, profile, events, ledger, ingestion.sources, ingestion.discovery); if (!saved.persisted) ledger.push({ id: "persist-warning", kind: "system", status: "attention", title: "Database sync needs attention", detail: saved.error ?? "Refresh completed but could not be persisted.", at: "just now" }); }
  return { mode: "live", events, sources: ingestion.sources, ledger };
}
