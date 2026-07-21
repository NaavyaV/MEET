export type EventFormat = "in-person" | "online" | "hybrid";
export type EventAction = "saved" | "dismissed" | "going" | "interested";
export type EventSourceType = "api" | "rss" | "curated-crawler" | "web-discovery" | "demo";
export type ExtractionMethod = "structured" | "llm" | "api" | "rss" | "demo";

export type EventProvenance = {
  discoveryQuery?: string;
  sourceDomain: string;
  sourceUrl: string;
  registrationUrl?: string;
  extractionMethod: ExtractionMethod;
  extractionConfidence?: number;
  evidence: string[];
  robotsDecision?: "allowed" | "disallowed" | "unavailable";
};

export type ScoreFactor = "relevance" | "distance" | "format" | "timing" | "caliber";

export type ScoreBreakdown = {
  relevance: number;
  distance: number;
  format: number;
  timing: number;
  caliber: number;
  final: number;
  reasons: Record<ScoreFactor, string>;
  lowScoreExplanation: string;
};

export type Opportunity = {
  id: string;
  externalId?: string;
  title: string;
  source: string;
  sourceType?: EventSourceType;
  url: string;
  description: string;
  startsAt: string;
  endsAt?: string;
  timezone?: string;
  format: EventFormat;
  venue?: string;
  address?: string;
  distanceMiles?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  category: string;
  tags: string[];
  caliberReason?: string;
  score?: ScoreBreakdown;
  friendNames?: string[];
  image?: string;
  relevanceMethod?: "llm" | "fallback";
  provenance?: EventProvenance;
};

export type UserProfile = {
  name: string;
  email?: string;
  skills: string[];
  interests: string[];
  careerStage: string;
  goals: string;
  location: string;
  latitude: number;
  longitude: number;
  travelRadius: number;
  formatPreference: "in-person" | "online" | "both";
  availability: "weekdays" | "evenings" | "weekends" | "flexible";
  weights: {
    relevance: number;
    distance: number;
    format: number;
    timing: number;
    caliber: number;
  };
};

export type LedgerEntry = {
  id: string;
  kind: "source" | "dedup" | "score" | "system";
  status: "complete" | "running" | "skipped" | "attention";
  title: string;
  detail: string;
  at: string;
  duration?: string;
};

export type RefreshResult = {
  events: Opportunity[];
  ledger: LedgerEntry[];
  mode: "live" | "demo" | "empty";
  sources: { name: string; count: number; status: "complete" | "skipped" | "attention" }[];
};

export type DiscoveryCandidate = {
  url: string;
  normalizedUrl: string;
  domain: string;
  title?: string;
  publishedDate?: string;
  highlights?: string[];
  query: string;
  decision: "selected" | "skipped" | "robots-disallowed" | "fetched" | "rejected" | "error";
  reason?: string;
};

export type DiscoveryDiagnostics = {
  enabled: boolean;
  queries: { query: string; origin: "deterministic" | "llm-refined" }[];
  candidates: DiscoveryCandidate[];
  fetched: number;
  structuredExtractions: number;
  llmExtractions: number;
  rejectedEvents: string[];
};
