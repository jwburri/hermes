# Hermes Handoff

Written 2026-09-10. This is the one document to read first if you are taking over Hermes. It says what Hermes is, what state it is in, how it works, how to run and deploy it, what is still to do, and the traps that have already cost time. The other documents in this folder are referenced where they still matter.

## 1. What Hermes is

Hermes is an internal web app for Just Website Brokerage (JWB). A team member logs in, picks a business that is for sale, pastes a buyer's questions (or a whole buyer email thread), and gets back a reply in Joe's voice drawn only from that business's documents in Google Drive. The team member reads it, edits if needed, and sends it to the buyer. Buyers never touch Hermes directly.

The non-negotiable requirement is accuracy. Every figure must come from the documents, wrong figures in the buyer's own question must be corrected, and anything the documents do not contain is referred to the seller with a fixed line rather than guessed.

Primary user: Aiman (aimannajmy@gmail.com). Owner: Joe Burrill.

## 2. Where everything lives

| Thing | Where |
|---|---|
| Live app | https://hermes.justwebsitebrokerage.com (also hermes-0dsx.onrender.com) |
| Hosting | Render, web service "hermes", free tier, auto-deploys on every push to `main` |
| Source | github.com/jwburri/hermes, branch `main`. Local clone: `Projects/Hermes/hermes-app` |
| Model | Anthropic Claude, `claude-sonnet-5`, adaptive thinking, effort `high` |
| Registry and log | Airtable base `appGfWlzDet6nKH16`: tables Hermes Listings, Hermes Q&A Log, Hermes Referred Questions (unused so far) |
| Documents | Google Drive, read through a read-only service account that has access to the JWB shared drive |
| System prompt | `Hermes_Brain.md` in the repo root, read from disk at runtime. Never copied into code |
| Specs | This folder: `Hermes_V2_Plan.md` (why V2 was built and what is left), `Hermes_Listing_Folder_Spec.md` (how listing folders must be organised), `Hermes_Build_Spec.md` (the original Phase 1a spec, superseded in parts, see section 10), `Hermes_Design_Spec.md` (branding) |
| Secrets | `hermes-app/.env.local` on Joe's Mac (git-ignored) and the Render dashboard Environment tab. Never in the repo |

Team login: one shared password (`TEAM_PASSWORD`). Joe has it.

## 3. Current state (2026-09-10)

Shipped and verified in production:

- **Phase 1a (June 2026).** Login, business registry, Drive ingestion, streamed answer, Q&A log, branding, archive control.
- **Phase A (8 Sep 2026).** Sonnet 5. Every tab of a spreadsheet is read (the old CSV export only returned the first tab, which was the root of "Hermes can't read spreadsheets"). Deterministic document order. One-hour prompt caching. Legals-folder and deal-document exclusions. A "Documents Hermes read" panel under every answer. Provenance logging. Parallel Drive reads and a five-minute document cache. Stop reason checked.
- **Dependencies (9 Sep 2026).** Next.js 16.3.4, `xlsx` from the SheetJS registry, zero `npm audit` advisories.
- **Phase B (10 Sep 2026).** Documents sent as citable blocks; a Sources panel shows where each claim came from. A second "verify" call re-reads the draft against the documents and lists unsupported claims and wrong buyer premises in an amber "Check before sending" panel. A "Notes for you" block after the buyer-facing answer for the team member only (corrections made, document conflicts, trends, referred questions). The last eight logged answers for the business are fed back in for consistency. Brain rewritten with the premise-check, period-label, discrepancy, other-buyers and pasted-thread rules.

Not built yet: Phase C (attach files and images to a question, read image-only PDFs and PNGs from Drive, the referred-questions and seller-answer loop) and the rest of Phase D (regression script, login rate limiting, constant-time password compare). Scope for each is in `Hermes_V2_Plan.md` section 4.

## 4. How an answer is produced

1. The team member picks a business. Its row in Hermes Listings holds the Drive folder link.
2. `src/lib/drive.ts` walks that folder and its subfolders (three levels), fetching files in parallel, and extracts text: Google Docs and Slides as plain text, Google Sheets and Excel as one CSV block per tab with the tab name, PDFs via pdf-parse, Word via mammoth, plain text and Markdown as is. Drive comments on each file are appended. Files and folders matching the exclusion patterns are skipped and recorded. The result is cached in memory for five minutes per folder.
3. `src/lib/brain.ts` splits `Hermes_Brain.md` into the system prompt and the context template and fills the placeholders.
4. `src/lib/anthropic.ts` builds the request: the system prompt (cached, 1h), the template text before the documents, one `document` block per file with citations enabled, the coverage block (cached, 1h), then the uncached tail: prior answers and the buyer's questions. Adaptive thinking, effort from `ANTHROPIC_EFFORT`, `max_tokens` 32,000, streamed.
5. The reply is buyer-facing text, a line `---NOTES FOR YOU---`, then internal notes. The server streams the text as it arrives, then splits it.
6. A second call, "verify mode", sends the same cached prefix with the draft answer and asks for JSON listing unsupported claims and uncorrected wrong premises. It never throws; if it fails the UI says the check did not run.
7. The client receives newline-delimited JSON events in this order: `coverage` (files read and skipped), `text` deltas, `answer_end` (stop reason, sources), `flags` (verification result), `done` (token usage, model).
8. `src/lib/airtable.ts` logs the row: business, questions, the buyer-facing answer, and (once the columns exist, see section 7) model, effort, files read, files skipped, truncated, stop reason, token counts, notes and flagged claims. If the extra columns are missing it retries with the four original fields, so logging never breaks an answer.

Cost with a warm cache is roughly $0.12 per question (two calls reading about 175K cached tokens each for a large listing, plus output). The first question on a business within an hour costs about $0.45 because it writes the cache. At current volume that is well under $20 a month.

Timing with a warm cache: about 30 seconds for a small listing, about 60 seconds for Gronanda (49 documents). The verification call is 4 to 20 seconds of that.

## 5. Code map

All under `hermes-app/`.

- `src/lib/config.ts` — every environment variable, read lazily. Non-numeric values fall back to defaults.
- `src/lib/drive.ts` — Drive auth, folder walk, extraction, exclusions, coverage rendering, the five-minute cache. `EXCLUDE_PATTERNS` (files and folders) and `DEAL_FILE_PATTERNS` (file names only) are at the top.
- `src/lib/brain.ts` — loads and splits `Hermes_Brain.md`; fills placeholders with `replaceAll` and a function so `$` in documents is never interpreted.
- `src/lib/anthropic.ts` — the answer stream and the verify call, sharing one prompt object so the cache hits. Runs Haiku plainly (no thinking) if an old model name is ever configured.
- `src/lib/airtable.ts` — registry read and write, archive, `recentAnswers`, `logSubmission` with fallback.
- `src/lib/session.ts` and `src/proxy.ts` — signed session cookie and route protection. The proxy is the only auth gate; keep Next.js current.
- `src/app/api/answer/route.ts` — the answer endpoint and event stream.
- `src/app/page.tsx` — the main screen: answer, Notes for you, Check before sending, Sources, Documents Hermes read.
- `src/app/login`, `src/app/add-business`, `src/app/api/businesses` — login, registry management.
- `render.yaml` — Render blueprint. Note that values set in the Render dashboard override it.
- `next.config.ts` — `serverExternalPackages` for pdf-parse (its worker breaks when bundled), noindex headers.

## 6. Running, deploying, rolling back

**Deploy:** push to `main`. Render builds and deploys in five to eight minutes. Watch the Render dashboard for "Your service is live".

**Roll back:** `git revert <commit>` and push. Render deploys the revert.

**Run locally:** load Node via nvm (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`), then in `hermes-app`: `npm install`, `npm run build`, `npm start`, open http://localhost:3000. On Joe's 8 GB Mac `npm run dev` is unusably slow (tens of minutes per request); build and start instead. A Claude Code launch entry named `hermes-start` does this.

**Test without the browser:** log in via the API with a cookie jar, then post a question. Do not put the password on the command line; read it from `.env.local` in a script.

```bash
curl -s -c cookies.txt -H 'content-type: application/json' --data @login.json http://localhost:3000/api/login
curl -s -b cookies.txt http://localhost:3000/api/businesses
curl -s -N -b cookies.txt -H 'content-type: application/json' --data '{"businessId":"rec...","questions":"..."}' http://localhost:3000/api/answer
```

The answer endpoint streams newline-delimited JSON; the last line is the `done` event.

**Change the model, effort or output cap:** Render dashboard, hermes service, Environment: `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` (low, medium, high, xhigh, max), `ANTHROPIC_MAX_TOKENS`. Save triggers a redeploy. Only Sonnet 5 is approved for Hermes (Joe's decision on cost).

**Change how Hermes answers:** edit `Hermes_Brain.md` in the repo and push. It is cached per process, so the change lands on deploy. Keep the five placeholders (`{{BUSINESS_NAME}}`, `{{KNOWLEDGE_BASE}}`, `{{COVERAGE}}`, `{{PRIOR_ANSWERS}}`, `{{BUYER_QUESTIONS}}`) in that order and keep the `---NOTES FOR YOU---` convention; the code depends on both. There is a copy of the brain in `Projects/Hermes` for reference; the one in the repo is the live one.

## 7. Operating rules for the team

- **Register the deal folder, keep legal documents in a `Legals` folder inside it.** Hermes never opens a folder named Legal or Legals. As a second net it skips any file whose name contains LOI, APA, letter of intent, negotiation, term sheet or heads of terms, plus the older patterns (broker, commission, engagement letter, call summary, asset purchase agreement, outreach). Gronanda is set up this way; the other listings still need their Legals folder created and loose legal documents moved in. Full rules in `Hermes_Listing_Folder_Spec.md`.
- **Check the "Documents Hermes read" panel** the first time a listing is used, and whenever an answer looks thin. A file that is not in the list was not read, and the reason is shown.
- **Formats Hermes cannot read:** Apple Numbers files, PNG and JPG images, and PDFs that are only screenshots. Export Numbers to Google Sheets or Excel. Image support is Phase C.
- **The live P&L Google Sheet is the source of truth.** Analysis documents are not maintained and can drift; the verification pass will flag conflicts when they do.
- **Read the Notes and the Check panel before sending.** Notes hold corrections and conflicts; the Check panel lists claims the checker could not support. Neither is for the buyer. "Copy answers" copies only the buyer-facing text.
- **Add the eleven provenance columns to Hermes Q&A Log** (still outstanding): Model, Effort, Stop Reason (single line text); Files Read, Files Skipped, Hermes Notes, Flagged Claims (long text); Truncated (checkbox); Input Tokens, Cache Read Tokens, Output Tokens (number). Either add them by hand or give the Airtable token the `schema.bases:write` scope and have Claude Code create them. Until then only the four original fields are logged.

## 8. Known gaps and next work

Team:

1. Airtable columns (above).
2. Legals folders for every listing other than Gronanda; move Gronanda's four loose legal documents (two APA drafts, LOI v2, the counter-LOI) into its Legals folder.
3. Export Numbers files and screenshots that carry numbers the team cares about.
4. Aiman's review of V2, then a graded set of 10 to 15 questions with known-correct answers for the regression script.

Engineering, in order:

1. Phase C: attachments on the question form (images, PDFs, spreadsheets sent as native blocks for that answer only); native PDF and image ingestion from Drive; the referred-questions and seller-answer loop into the Hermes Referred Questions table.
2. Phase D remainder: regression script over the logged questions; login rate limiting and a constant-time password compare on `/api/login`.
3. Before any buyer-facing access (Phase 2 of the original spec): the registered folder must become an allowlist folder, not the deal folder, and the coverage and sources data must be stripped from responses to buyers.

## 9. Traps already found

- **Render dashboard values override `render.yaml`.** The Phase A deploy failed for every question because `ANTHROPIC_MODEL` was still Haiku in the dashboard. The code now tolerates a Haiku value, but check the dashboard whenever `render.yaml` changes.
- **GitHub fine-grained tokens for one account share the same prefix.** An expired token in the macOS keychain shadowed the new one and caused a 403 on push. Erase the github.com entries (`git credential-osxkeychain erase`) before storing a new token. The current token expires 7 Dec 2026.
- **`\b` in a JavaScript regex does not match next to an underscore**, so `Gronanda_LOI_v2` passed a `\bLOI\b` check. The deal-document patterns use letter-based lookarounds instead.
- **Folder names can legitimately contain LOI.** "LOI Dataroom" holds the public data room. The deal-document patterns therefore apply to file names only; the Legals rule and the older patterns apply to both.
- **The Drive CSV export of a Google Sheet is the first tab only.** Export as xlsx and read every tab.
- **pdf-parse loads a worker by file path.** Bundling breaks it; it is listed in `serverExternalPackages`.
- **`xlsx` on npm is frozen at an old version with unfixable advisories.** It is installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- **Error text must never enter the cached prompt prefix.** A varying error message in the coverage block invalidated the whole cache. Skip reasons are fixed strings; details go to the server log.
- **Confidential file names must not reach the model.** The coverage block sent to the model omits excluded files; the UI still shows them because the team needs to see them.
- **Airtable's API key cannot create fields** without the schema write scope.
- **A loose service-account key file** sits at `Projects/Hermes/hermes-499709-*.json`. Its contents are already in `.env.local` and Render. Delete the file.

## 10. Which documents are current

- `Hermes_Handoff.md` (this file): current state and operations. Start here.
- `Hermes_V2_Plan.md`: the analysis of Aiman's feedback, root causes, decisions, phases, and what is shipped versus pending. Current.
- `Hermes_Listing_Folder_Spec.md`: folder rules. Current.
- `Hermes_Brain.md`: the live system prompt (the copy in the repo is the one that runs). Current.
- `Hermes_Build_Spec.md`: the original Phase 1a specification. Still right on the product shape, the registry, the log and Phase 2 intent. Superseded on the model (now Sonnet 5), hosting (Render, not Vercel), ingestion, caching, the answer stream format, the log fields and the folder rules. Where it disagrees with this file or the V2 plan, those win.
- `Hermes_START_HERE.md`: the original first-build guide. Historical.
- `Hermes_Design_Spec.md`: branding. Current.
