import Groq from "groq-sdk";
import { EventFormat, Opportunity, UserProfile } from "./types";

const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

function client() {
  if (!process.env.GROQ_API_KEY) return null;
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function parseJson<T>(content: string | null | undefined): T | null {
  if (!content) return null;
  try {
    return JSON.parse(content.replace(/^```json\s*|\s*```$/g, "").trim()) as T;
  } catch {
    return null;
  }
}

async function jsonCompletion<T>(system: string, prompt: string): Promise<T | null> {
  const groq = client();
  if (!groq) return null;
  const response = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\nReturn only valid JSON. Do not invent facts.` },
      { role: "user", content: prompt },
    ],
  }, { signal: AbortSignal.timeout(8000) });
  return parseJson<T>(response.choices[0]?.message.content);
}

export async function parseProfileWithGroq(text: string) {
  return jsonCompletion<{
    skills: string[];
    interests: string[];
    careerStage: string;
    goals: string;
  }>(
    "Extract an opportunity-discovery profile from a resume or LinkedIn export. Keep arrays concise (maximum 10 items each).",
    `Document:\n${text.slice(0, 18000)}\n\nSchema: {"skills": string[], "interests": string[], "careerStage": string, "goals": string}`,
  );
}

export type GroqExtractedEvent = {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string | null;
  timezone?: string | null;
  sourceUrl?: string;
  registrationUrl?: string | null;
  organizer?: string | null;
  format?: EventFormat;
  venue?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  category?: string | null;
  tags?: string[];
  extractionConfidence?: number;
  evidence?: string[];
};

export async function extractEventsWithGroq(page: { url: string; title: string; text: string }) {
  const result = await jsonCompletion<{ events: GroqExtractedEvent[] }>(
    "Extract only concrete future events from this public, permitted page. Every returned field must be explicitly supported by page text. Source URL must be the page URL. Reject anything without a title, a future date, and short supporting evidence snippets. Do not infer a date, location, organizer, URL, format, or confidence.",
    `URL: ${page.url}\nPage title: ${page.title}\nCleaned page text:\n${page.text.slice(0, 24000)}\n\nSchema: {"events":[{"title":string,"description":string,"startsAt":string,"endsAt":string|null,"timezone":string|null,"sourceUrl":string,"registrationUrl":string|null,"organizer":string|null,"format":"online"|"in-person"|"hybrid","venue":string|null,"address":string|null,"latitude":number|null,"longitude":number|null,"category":string|null,"tags":string[],"extractionConfidence":number,"evidence":string[]}]}`,
  );
  return result?.events ?? [];
}

export async function getRelevanceScores(events: Opportunity[], profile: UserProfile) {
  const result = await jsonCompletion<{ scores: { id: string; score: number; reason?: string }[] }>(
    "Judge semantic relevance only, on a 0–10 scale. Use the profile's stated goals, interests, and skills. Do not account for time, format, distance, popularity, or date. A score of 10 means unusually direct alignment.",
    `Profile:\n${JSON.stringify({ skills: profile.skills, interests: profile.interests, goals: profile.goals, careerStage: profile.careerStage })}\n\nEvents:\n${JSON.stringify(events.map(({ id, title, description, tags, category }) => ({ id, title, description, tags, category })))}\n\nSchema: {"scores":[{"id":string,"score":number,"reason":string}]}`,
  );
  const valid = (result?.scores ?? []).filter((item) => typeof item.id === "string" && Number.isFinite(item.score));
  return {
    scores: Object.fromEntries(valid.map((item) => [item.id, Math.max(0, Math.min(10, item.score))])),
    reasons: Object.fromEntries(valid.map((item) => [item.id, item.reason?.slice(0, 240) || "Semantic overlap between your profile and the event content."])),
  };
}

export async function refineDiscoveryQueriesWithGroq(profile: UserProfile, deterministicQueries: string[]) {
  const result = await jsonCompletion<{ queries: string[] }>(
    "Diversify a bounded set of professional opportunity-discovery web-search queries. Keep them specific, public-web-safe, and focused on upcoming events. Return at most six queries. Do not include people, social profiles, news, ticket checkout, login, or private sources.",
    `Profile: ${JSON.stringify({ location: profile.location, travelRadius: profile.travelRadius, formatPreference: profile.formatPreference, skills: profile.skills, interests: profile.interests, goals: profile.goals, careerStage: profile.careerStage })}\nDeterministic starting queries: ${JSON.stringify(deterministicQueries)}\nSchema: {"queries": string[]}`,
  );
  return (result?.queries ?? []).map((query) => query.replace(/\s+/g, " ").trim()).filter((query) => query.length >= 8 && query.length <= 180).slice(0, 6);
}

export const groqConfigured = () => Boolean(process.env.GROQ_API_KEY);
export const groqModel = MODEL;
