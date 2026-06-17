# Hermes

JWB's buyer-question answering app (Phase 1a). A team member logs in, picks a
business, pastes a buyer's questions, and gets formatted answers in Joe's voice,
drawn from that business's buyer-safe Google Drive folder.

Built to the spec in `Hermes_Build_Spec.md`. The system prompt lives in
`Hermes_Brain.md` and is loaded at runtime — never copied into code.

## Stack

- Next.js 16 (App Router, TypeScript) on Vercel
- Anthropic Claude API (`@anthropic-ai/sdk`), Haiku 4.5 by default
- Airtable for the listing registry and the Q&A log
- Google Drive API v3 via a read-only service account
- Tailwind CSS, shared-password auth with a signed session cookie

## How it fits together

- `src/lib/config.ts` — all environment config in one place
- `src/lib/brain.ts` — loads `Hermes_Brain.md`, splits the system prompt from the
  context template, fills the three placeholders
- `src/lib/airtable.ts` — registry read/write and the Q&A log
- `src/lib/drive.ts` — service-account auth, folder listing, text extraction
- `src/lib/anthropic.ts` — the streaming Claude call
- `src/lib/session.ts` + `src/proxy.ts` — login cookie and route protection
- `src/app/api/answer/route.ts` — the single reusable answer endpoint (Build
  Spec §3); the UI is just a caller, so Phase 2 buyer links reuse it
- `src/app/page.tsx` — main screen; `login/` and `add-business/` — the other two

## Running locally

1. Copy `.env.example` to `.env.local` and fill in every value (see Build Spec
   §14). A `SESSION_SECRET` is generated for you on first setup.
2. `npm install`
3. `npm run dev` and open http://localhost:3000

## Environment variables

See `.env.example`. All secrets are server-side only; nothing is exposed to the
browser.

## Maintenance

Operational tasks (add a business, capture a seller answer, change the password,
tune the model) are in Build Spec §13. All code changes go through Claude Code —
the team never edits this code by hand.
