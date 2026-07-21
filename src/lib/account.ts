import type { User } from "@supabase/supabase-js";
import { UserProfile } from "./types";

export const PROFILE_SELECT = "id, username, full_name, avatar_url, skills, interests, career_stage, goals, location_label, latitude, longitude, travel_radius_miles, format_preference, availability, weights, digest_frequency, digest_email, onboarding_completed, updated_at, created_at";

export type DigestFrequency = "daily" | "weekly" | "on-demand";

export type AccountIdentity = {
  id: string;
  email: string | null;
  name: string;
};

export type AccountProfileResponse = {
  user: AccountIdentity;
  profile: UserProfile;
  digestFrequency: DigestFrequency;
  onboardingCompleted: boolean;
  updatedAt: string | null;
};

const defaultWeights: UserProfile["weights"] = {
  relevance: 38,
  distance: 20,
  format: 14,
  timing: 13,
  caliber: 15,
};

const defaultProfile: Omit<UserProfile, "name" | "email"> = {
  skills: [],
  interests: [],
  careerStage: "Student / early career",
  goals: "",
  location: "Chicago, Illinois",
  latitude: 41.8781,
  longitude: -87.6298,
  travelRadius: 15,
  formatPreference: "both",
  availability: "flexible",
  weights: defaultWeights,
};

const text = (value: unknown, maxLength: number) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
const longText = (value: unknown, maxLength: number) => typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const numberValue = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;

function stringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function weightsFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultWeights;
  const candidate = value as Partial<UserProfile["weights"]>;
  const parsed = {
    relevance: numberValue(candidate.relevance),
    distance: numberValue(candidate.distance),
    format: numberValue(candidate.format),
    timing: numberValue(candidate.timing),
    caliber: numberValue(candidate.caliber),
  };
  const values = Object.values(parsed);
  return values.every((item) => Number.isFinite(item) && item >= 0 && item <= 100) && Math.abs(values.reduce((sum, item) => sum + item, 0) - 100) < 0.01 ? parsed : defaultWeights;
}

function profileValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function identityFromUser(user: User): AccountIdentity {
  const metadataName = text(user.user_metadata?.full_name, 120) || text(user.user_metadata?.name, 120);
  const email = user.email ?? null;
  return {
    id: user.id,
    email,
    name: metadataName || (email ? email.split("@")[0] : "MEET member"),
  };
}

/**
 * Converts the public profile payload into a bounded database-safe shape.
 * We intentionally store extracted fields only, never a raw resume.
 */
export function sanitizeProfileInput(input: unknown, fallbackName: string) {
  const value = profileValue(input);
  const name = text(value.name, 120) || fallbackName;
  const email = text(value.email, 254).toLowerCase();
  const careerStage = text(value.careerStage, 100) || defaultProfile.careerStage;
  const goals = longText(value.goals, 2_000);
  const location = text(value.location, 240) || defaultProfile.location;
  const latitude = numberValue(value.latitude);
  const longitude = numberValue(value.longitude);
  const travelRadius = numberValue(value.travelRadius);
  const formatPreference = value.formatPreference === "in-person" || value.formatPreference === "online" || value.formatPreference === "both" ? value.formatPreference : defaultProfile.formatPreference;
  const availability = value.availability === "weekdays" || value.availability === "evenings" || value.availability === "weekends" || value.availability === "flexible" ? value.availability : defaultProfile.availability;

  const errors: string[] = [];
  if (!name) errors.push("Your name is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Enter a valid digest email address.");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.push("Choose a valid map location.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.push("Choose a valid map location.");
  if (!Number.isFinite(travelRadius) || travelRadius < 0 || travelRadius > 500) errors.push("Travel distance must be between 0 and 500 miles.");

  if (errors.length) return { errors, profile: null, digestEmail: null } as const;
  return {
    errors: [] as string[],
    digestEmail: email || null,
    profile: {
      name,
      skills: stringList(value.skills, 50, 100),
      interests: stringList(value.interests, 50, 100),
      careerStage,
      goals,
      location,
      latitude,
      longitude,
      travelRadius: Math.round(travelRadius),
      formatPreference,
      availability,
      weights: weightsFrom(value.weights),
    },
  } as const;
}

export function profileToDatabaseRow(profile: UserProfile, digestEmail: string | null) {
  return {
    full_name: profile.name,
    skills: profile.skills,
    interests: profile.interests,
    career_stage: profile.careerStage,
    goals: profile.goals,
    location_label: profile.location,
    latitude: profile.latitude,
    longitude: profile.longitude,
    travel_radius_miles: profile.travelRadius,
    format_preference: profile.formatPreference,
    availability: profile.availability,
    weights: profile.weights,
    digest_email: digestEmail,
  };
}

export function profileFromDatabaseRow(row: Record<string, unknown>, identity: AccountIdentity): AccountProfileResponse {
  const fullName = text(row.full_name, 120) || identity.name;
  const databaseEmail = text(row.digest_email, 254).toLowerCase();
  const profile: UserProfile = {
    name: fullName,
    email: databaseEmail || identity.email || undefined,
    skills: stringList(row.skills, 50, 100),
    interests: stringList(row.interests, 50, 100),
    careerStage: text(row.career_stage, 100) || defaultProfile.careerStage,
    goals: longText(row.goals, 2_000),
    location: text(row.location_label, 240) || defaultProfile.location,
    latitude: Number.isFinite(numberValue(row.latitude)) ? numberValue(row.latitude) : defaultProfile.latitude,
    longitude: Number.isFinite(numberValue(row.longitude)) ? numberValue(row.longitude) : defaultProfile.longitude,
    travelRadius: Number.isFinite(numberValue(row.travel_radius_miles)) ? numberValue(row.travel_radius_miles) : defaultProfile.travelRadius,
    formatPreference: row.format_preference === "in-person" || row.format_preference === "online" || row.format_preference === "both" ? row.format_preference : defaultProfile.formatPreference,
    availability: row.availability === "weekdays" || row.availability === "evenings" || row.availability === "weekends" || row.availability === "flexible" ? row.availability : defaultProfile.availability,
    weights: weightsFrom(row.weights),
  };
  const digestFrequency: DigestFrequency = row.digest_frequency === "daily" || row.digest_frequency === "weekly" || row.digest_frequency === "on-demand" ? row.digest_frequency : "weekly";
  return {
    user: identity,
    profile,
    digestFrequency,
    onboardingCompleted: row.onboarding_completed === true,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export function digestFrequencyFrom(value: unknown): DigestFrequency | null {
  return value === "daily" || value === "weekly" || value === "on-demand" ? value : null;
}
