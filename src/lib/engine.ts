import { Opportunity, ScoreFactor, ScoreBreakdown, UserProfile } from "./types";

const scoreWords = (input: string, terms: string[]) => {
  const words = new Set(input.toLowerCase().match(/[a-z0-9+#.-]+/g) ?? []);
  if (!terms.length) return 5;
  const hits = terms.filter((term) => words.has(term.toLowerCase()) || input.toLowerCase().includes(term.toLowerCase())).length;
  return Math.min(10, 2.5 + (hits / terms.length) * 7.5);
};

export function relevanceFallback(event: Opportunity, profile: UserProfile) {
  return scoreWords(`${event.title} ${event.description} ${event.tags.join(" ")}`, [...profile.skills, ...profile.interests, ...profile.goals.split(/\W+/)]);
}

/** Physical events must have a verified distance inside the chosen area. */
export function isEligibleForProfile(event: Pick<Opportunity, "format" | "distanceMiles">, profile: UserProfile) {
  if (event.format === "online") return profile.formatPreference !== "in-person";
  if (profile.formatPreference === "online") return false;
  return Number.isFinite(event.distanceMiles) && (event.distanceMiles as number) <= profile.travelRadius;
}

export function buildLowScoreExplanation(event: Opportunity, scores: Pick<ScoreBreakdown, ScoreFactor>, profile: UserProfile) {
  const factor = scores.relevance <= scores.distance ? "relevance" : "distance";
  if (factor === "distance") {
    return event.format === "online"
      ? "Relevance is the main constraint: this online opportunity overlaps less with your stated goals and interests."
      : `Location is the main constraint: this is ${event.distanceMiles?.toFixed(1)} miles away within your ${profile.travelRadius}-mile travel area.`;
  }
  return "Relevance is the main constraint: its topics overlap less with your stated skills, interests, and current goal.";
}

export function scoreOpportunity(event: Opportunity, profile: UserProfile, relevance?: number, relevanceReason?: string): Opportunity {
  const distance = event.format === "online" ? 10 : event.distanceMiles == null ? 0 : Math.max(0, 10 * (1 - Math.max(0, event.distanceMiles - 1) / Math.max(1, profile.travelRadius)));
  const format = profile.formatPreference === "both" || event.format === "hybrid" || event.format === profile.formatPreference ? 10 : 2.5;
  const start = new Date(event.startsAt);
  const hour = start.getHours();
  const weekday = start.getDay();
  const timing = profile.availability === "flexible" ? 10
    : profile.availability === "weekends" ? (weekday === 0 || weekday === 6 ? 10 : 4)
    : profile.availability === "evenings" ? (hour >= 17 ? 10 : hour >= 15 ? 6 : 3)
    : weekday > 0 && weekday < 6 ? 10 : 5;
  const caliber = /hackathon|demo day|office hours|mentor|maintainer|showcase|sprint/i.test(`${event.title} ${event.description}`) ? 8.8 : /workshop|build|hands-on/i.test(`${event.title} ${event.description}`) ? 7.4 : 5.8;
  const subScores = {
    relevance: Math.round((relevance ?? relevanceFallback(event, profile)) * 10) / 10,
    distance: Math.round(distance * 10) / 10,
    format: Math.round(format * 10) / 10,
    timing: Math.round(timing * 10) / 10,
    caliber,
  };
  // Format and timing remain stored as descriptive metadata, but cannot move
  // one nearby event above another in the feed.
  const final = subScores.relevance * 0.7 + subScores.distance * 0.3;
  return {
    ...event,
    score: {
      ...subScores,
      final: Math.round(final * 10) / 10,
      reasons: {
        relevance: relevanceReason ?? "Semantic overlap between your profile and the event content.",
        distance: event.format === "online" ? "Online event; no travel is required." : `${event.distanceMiles?.toFixed(1) ?? "Verified"} miles within your ${profile.travelRadius}-mile radius.`,
        format: `${event.format} event compared with your ${profile.formatPreference} preference.`,
        timing: `${start.toLocaleDateString("en-US", { weekday: "long" })} at ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}, evaluated against your ${profile.availability} availability.`,
        caliber: event.caliberReason ?? "Caliber is inferred once from format and organizer signals, then cached.",
      },
      lowScoreExplanation: buildLowScoreExplanation(event, subScores, profile),
    },
  };
}

export const scoreOpportunities = (events: Opportunity[], profile: UserProfile, relevanceScores: Record<string, number> = {}, relevanceReasons: Record<string, string> = {}) => events
  .map((event) => scoreOpportunity(event, profile, relevanceScores[event.id], relevanceReasons[event.id]))
  .sort((a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0));

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);

export function titleSimilarity(left: string, right: string) {
  const a = new Set(normalize(left));
  const b = new Set(normalize(right));
  const overlap = [...a].filter((token) => b.has(token)).length;
  return a.size || b.size ? overlap / Math.max(a.size, b.size) : 0;
}

function coordinateDistanceMiles(left: Opportunity, right: Opportunity) {
  if (left.latitude == null || left.longitude == null || right.latitude == null || right.longitude == null) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(right.latitude - left.latitude); const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function deduplicate(events: Opportunity[]) {
  const unique: Opportunity[] = [];
  const decisions: string[] = [];
  for (const event of events) {
    const date = event.startsAt.slice(0, 10);
    const existing = unique.find((candidate) => {
      const distance = coordinateDistanceMiles(candidate, event);
      return candidate.startsAt.slice(0, 10) === date && titleSimilarity(candidate.title, event.title) >= 0.82 && (distance == null || distance <= 1);
    });
    if (existing) {
      const match = Math.round(titleSimilarity(existing.title, event.title) * 100);
      const distance = coordinateDistanceMiles(existing, event);
      decisions.push(`${match}% title match, same date${distance == null ? "" : `, ${distance.toFixed(1)} mi apart`} — merged “${event.title}” into “${existing.title}”.`);
      continue;
    }
    unique.push(event);
  }
  return { events: unique, decisions };
}
