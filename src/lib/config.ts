/**
 * Central configuration for Hermes, read from environment variables.
 *
 * Every secret lives server-side only. Nothing here is exposed to the browser
 * (no NEXT_PUBLIC_ vars). The model and the thinking effort are single config
 * values so they can be tuned without code changes (Build Spec §8, §14).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

/** parseInt that falls back instead of returning NaN on a non-numeric value. */
function optionalInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  anthropic: {
    apiKey: () => required("ANTHROPIC_API_KEY"),
    // Default model is Sonnet 5 (Build Spec §8). Single config value.
    model: () => optional("ANTHROPIC_MODEL", "claude-sonnet-5"),
    // Thinking depth / overall token spend. low | medium | high | xhigh | max.
    effort: () => optional("ANTHROPIC_EFFORT", "high"),
    // Max output tokens. Adaptive thinking shares this budget with the answer.
    maxTokens: () => optionalInt("ANTHROPIC_MAX_TOKENS", 32000),
  },
  airtable: {
    apiKey: () => required("AIRTABLE_API_KEY"),
    baseId: () => required("AIRTABLE_BASE_ID"),
    listingsTable: () => optional("AIRTABLE_LISTINGS_TABLE", "Hermes Listings"),
    logTable: () => optional("AIRTABLE_LOG_TABLE", "Hermes Q&A Log"),
    referredTable: () =>
      optional("AIRTABLE_REFERRED_TABLE", "Hermes Referred Questions"),
  },
  google: {
    serviceAccountJson: () => required("GOOGLE_SERVICE_ACCOUNT_JSON"),
  },
  auth: {
    teamPassword: () => required("TEAM_PASSWORD"),
    sessionSecret: () => required("SESSION_SECRET"),
  },
};

export const SESSION_COOKIE = "hermes_session";
