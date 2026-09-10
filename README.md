# Hermes

JWB's internal buyer-question answering app. A team member logs in, picks a
business, pastes a buyer's questions, and gets a reply in Joe's voice drawn only
from that business's Google Drive documents, with sources, a verification check,
and internal notes for the team member.

Read `Hermes_Handoff.md` first. `Hermes_V2_Plan.md` has the reasoning behind the
current design and the remaining phases. `Hermes_Brain.md` is the system prompt
and is loaded from disk at runtime, never copied into code.

## Stack

- Next.js 16 (App Router, TypeScript) on Render, auto-deployed from `main`
- Anthropic Claude API (`@anthropic-ai/sdk`), `claude-sonnet-5`, adaptive thinking
- Airtable for the listing registry and the Q&A log
- Google Drive API v3 via a read-only service account
- Tailwind CSS, shared-password auth with a signed session cookie

## How it fits together

- `src/lib/config.ts` — every environment variable in one place
- `src/lib/drive.ts` — Drive auth, parallel folder walk, text extraction
  (every spreadsheet tab), exclusions, coverage, five-minute cache
- `src/lib/brain.ts` — loads `Hermes_Brain.md`, splits system prompt from the
  context template, fills the five placeholders
- `src/lib/anthropic.ts` — the streamed answer call (documents as citable
  blocks, one-hour prompt cache) and the verify call
- `src/lib/airtable.ts` — registry, recent answers, Q&A log with fallback
- `src/lib/session.ts` + `src/proxy.ts` — login cookie and route protection
- `src/app/api/answer/route.ts` — the answer endpoint; streams newline-delimited
  JSON events: `coverage`, `text`, `answer_end`, `flags`, `done`
- `src/app/page.tsx` — main screen; `login/` and `add-business/` — the other two

## Running locally

1. Copy `.env.example` to `.env.local` and fill in every value.
2. `npm install`
3. `npm run build` then `npm start`, open http://localhost:3000. (`npm run dev`
   works but is very slow on low-memory machines.)

## Environment variables

See `.env.example`. All secrets are server-side only. Values set in the Render
dashboard override `render.yaml`.

## Maintenance

Operational rules for the team (folders, the Legals rule, unreadable formats,
Airtable columns) are in `Hermes_Handoff.md` section 7. Code changes go through
Claude Code; the team never edits the code by hand.
