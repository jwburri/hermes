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

- **Phase C (10 Sep 2026).** Files can be attached to a question (up to five, 10 MB each: images, PDFs, spreadsheets, Word, text) and are read for that answer only, never stored. PNG, JPG, GIF and WEBP files in Drive, and PDFs that are only scans or screenshots, are now read visually; PDFs with real text still go through text extraction. Referred questions are pulled out of every answer and written to the Hermes Referred Questions table; a Referred questions screen records the seller's reply; resolved replies come back into every later answer as a document called "Confirmed answers from the seller".

- **Phase D (10 Sep 2026).** A regression runner (`scripts/regress.ts`) replays sixteen real buyer questions from the log across the active listings, runs two of them twice for consistency, and writes a Markdown report; a `dryRun` flag keeps it out of the log and the referred table. A "Re-read the documents from Drive first" tick on the form bypasses the five-minute cache. Login now uses a constant-time password compare and blocks an IP for fifteen minutes after five failed attempts. Hermes refuses to answer when it could read no documents at all, instead of answering from prior answers.

V2 is complete. What remains is Aiman's review and, after it, the graded question set (section 8).

## 4. How an answer is produced

1. The team member picks a business. Its row in Hermes Listings holds the Drive folder link.
2. `src/lib/drive.ts` walks that folder and its subfolders (three levels), fetching files in parallel, and turns each into a document: Google Docs and Slides as plain text, Google Sheets and Excel as one CSV block per tab with the tab name, PDFs via pdf-parse, Word via mammoth, plain text and Markdown as is. A PDF with little or no extractable text (a scan or screenshots) is sent as the PDF itself so the model reads the pages; PNG, JPG, GIF and WEBP files are sent as images with a label line naming the file. Drive comments on each file are appended (for a PDF or image, as a separate "(comments)" document). Files and folders matching the exclusion patterns are skipped and recorded, as are PDFs over 10 MB or 600 pages and images over 5 MB ("too large to read"). The result is cached in memory for five minutes per folder.
2a. `src/lib/airtable.ts` loads the Resolved rows of Hermes Referred Questions for the business. If there are any they become one more document, "Confirmed answers from the seller", listed in the coverage panel like a file.
3. `src/lib/brain.ts` splits `Hermes_Brain.md` into the system prompt and the context template and fills the placeholders.
4. `src/lib/anthropic.ts` builds the request: the system prompt (cached, 1h), the template text before the documents, one `document` block per file with citations enabled (images as a label plus an image block), the coverage block (cached, 1h), then the uncached tail: prior answers, the buyer's questions, and any files attached to this question (parsed by `src/lib/attachments.ts` into the same document shapes). Adaptive thinking, effort from `ANTHROPIC_EFFORT`, `max_tokens` 32,000, streamed.
5. The reply is buyer-facing text, a line `---NOTES FOR YOU---`, then internal notes. The server streams the text as it arrives, then splits it.
6. A second call, "verify mode", sends the same cached prefix (and the same attachments) with the draft answer and asks for JSON listing unsupported claims and uncorrected wrong premises. It never throws; if it fails the UI says the check did not run.
7. `src/lib/referred.ts` finds every numbered question whose answer contains the seller-referral line.
8. The client receives newline-delimited JSON events in this order: `coverage` (files read and skipped, attachments read and ignored), `text` deltas, `answer_end` (stop reason, sources), `flags` (verification result), `referred` (the questions referred to the seller), `done` (token usage, model).
9. `src/lib/airtable.ts` logs the row: business, questions (with an "[Attached: …]" line when files were read), the buyer-facing answer, and (once the columns exist, see section 7) model, effort, files read, files skipped, truncated, stop reason, token counts, notes and flagged claims. If the extra columns are missing it retries with the four original fields, so logging never breaks an answer. It then writes each referred question as an Open row in Hermes Referred Questions, skipping any whose wording already exists for that business. Both writes are best-effort and never break an answer.

Cost with a warm cache is roughly $0.12 per question (two calls reading about 200K cached tokens each for Gronanda now that its screenshots and scanned PDFs are read, plus output). The first question on a business within an hour costs about $0.50 because it writes the cache. Saving a seller's answer changes the cached prefix, so the next question on that business rewrites the cache once. At current volume that is well under $20 a month.

Timing with a warm cache: about 30 seconds for a small listing, about 60 seconds for Gronanda (49 documents). The verification call is 4 to 20 seconds of that.

## 5. Code map

All under `hermes-app/`.

- `src/lib/config.ts` — every environment variable, read lazily. Non-numeric values fall back to defaults.
- `src/lib/drive.ts` — Drive auth, folder walk, extraction (text, native PDF, image), size caps, exclusions, coverage rendering, the five-minute cache. `EXCLUDE_PATTERNS` (files and folders) and `DEAL_FILE_PATTERNS` (file names only) are at the top, the size caps and the scanned-PDF threshold just below them.
- `src/lib/attachments.ts` — turns a file uploaded with a question into the same document shape. `ATTACHMENT_LIMITS` (5 files, 10 MB each) is enforced by the route and mirrored in the page.
- `src/lib/referred.ts` — pure helpers: find referred questions in an answer, normalise wording for dedupe, render confirmed seller answers. `scripts/check-referred.ts` is its self-check (`node scripts/check-referred.ts`).
- `scripts/regress.ts`, `scripts/regress-lib.ts`, `scripts/regress-set.json`, `scripts/fixtures/` — the regression runner, its pure parts (`scripts/check-regress.ts` checks them), the cases and the screenshot fixture.
- `src/lib/brain.ts` — loads and splits `Hermes_Brain.md`; fills placeholders with `replaceAll` and a function so `$` in documents is never interpreted.
- `src/lib/anthropic.ts` — the answer stream and the verify call, sharing one prompt object so the cache hits. Runs Haiku plainly (no thinking) if an old model name is ever configured.
- `src/lib/airtable.ts` — registry read and write, archive, `recentAnswers`, `logSubmission` with fallback, and the referred-questions table (`openReferred`, `resolveReferred`, `confirmedAnswers`, `addReferred`).
- `src/lib/session.ts` and `src/proxy.ts` — signed session cookie and route protection. The proxy is the only auth gate; keep Next.js current.
- `src/app/api/answer/route.ts` — the answer endpoint and event stream. Accepts JSON (`{businessId, questions}`) or multipart form data (`businessId`, `questions`, repeated `files`), plus the optional `dryRun` and `refresh` flags.
- `src/app/api/login/route.ts` — password check (constant-time) and the per-IP failed-attempt limit (in memory, per process).
- `src/app/page.tsx` — the main screen: attach files, answer, Notes for you, Check before sending, Referred to the seller, Sources, Documents Hermes read.
- `src/app/referred/page.tsx` and `src/app/api/referred` — the Referred questions screen (list Open rows, save the seller's answer).
- `src/app/login`, `src/app/add-business`, `src/app/api/businesses` — login, registry management.
- `render.yaml` — Render blueprint. Note that values set in the Render dashboard override it.
- `next.config.ts` — `serverExternalPackages` for pdf-parse (its worker breaks when bundled), noindex headers.

## 6. Running, deploying, rolling back

**Deploy:** push to `main`. Render builds and deploys in five to eight minutes. Watch the Render dashboard for "Your service is live".

**Roll back:** `git revert <commit>` and push. Render deploys the revert.

**Regression run (before any brain or model change):** with a server running (local or `HERMES_BASE=https://hermes.justwebsitebrokerage.com`), from `hermes-app`:

```bash
node scripts/regress.ts
```

Options: `--only Gronanda`, `--case 9`. It logs in with the password from `.env.local`, sends every case with `dryRun` so nothing is written to Airtable, and writes `scripts/regress-out/<date>.md` (git-ignored) with a summary table and every answer, its notes, its flags and the referred questions. Exit code 1 if any answer was cut off, errored, or the check did not run. The cases live in `scripts/regress-set.json`; add to them as new question types appear. Cost is about $2 to $3 a run.

**Run locally:** load Node via nvm (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`), then in `hermes-app`: `npm install`, `npm run build`, `npm start`, open http://localhost:3000. On Joe's 8 GB Mac `npm run dev` is unusably slow (tens of minutes per request); build and start instead. A Claude Code launch entry named `hermes-start` does this.

**Test without the browser:** log in via the API with a cookie jar, then post a question. Do not put the password on the command line; read it from `.env.local` in a script.

```bash
curl -s -c cookies.txt -H 'content-type: application/json' --data @login.json http://localhost:3000/api/login
curl -s -b cookies.txt http://localhost:3000/api/businesses
curl -s -N -b cookies.txt -H 'content-type: application/json' --data '{"businessId":"rec...","questions":"..."}' http://localhost:3000/api/answer
curl -s -N -b cookies.txt -F businessId=rec... -F 'questions=...' -F files=@screenshot.png http://localhost:3000/api/answer
```

The answer endpoint streams newline-delimited JSON; the last line is the `done` event.

**Change the model, effort or output cap:** Render dashboard, hermes service, Environment: `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` (low, medium, high, xhigh, max), `ANTHROPIC_MAX_TOKENS`. Save triggers a redeploy. Only Sonnet 5 is approved for Hermes (Joe's decision on cost).

**Change how Hermes answers:** edit `Hermes_Brain.md` in the repo and push. It is cached per process, so the change lands on deploy. Keep the five placeholders (`{{BUSINESS_NAME}}`, `{{KNOWLEDGE_BASE}}`, `{{COVERAGE}}`, `{{PRIOR_ANSWERS}}`, `{{BUYER_QUESTIONS}}`) in that order and keep the `---NOTES FOR YOU---` convention; the code depends on both. There is a copy of the brain in `Projects/Hermes` for reference; the one in the repo is the live one.

## 7. Operating rules for the team

- **Register the deal folder, keep legal documents in a `Legals` folder inside it.** Hermes never opens a folder named Legal or Legals. As a second net it skips any file whose name contains LOI, APA, letter of intent, negotiation, term sheet or heads of terms, plus the older patterns (broker, commission, engagement letter, call summary, asset purchase agreement, outreach). Gronanda is set up this way; the other listings still need their Legals folder created and loose legal documents moved in. Full rules in `Hermes_Listing_Folder_Spec.md`.
- **Check the "Documents Hermes read" panel** the first time a listing is used, and whenever an answer looks thin. A file that is not in the list was not read, and the reason is shown.
- **Formats Hermes cannot read:** Apple Numbers files (export them to Google Sheets or Excel), HEIC or TIFF images, PDFs over 10 MB or 600 pages, images over 5 MB. PNG, JPG, GIF and WEBP images and scanned or screenshot PDFs are read since Phase C.
- **Attach files to a question when the buyer sent something.** A screenshot of the buyer's email, a PDF or spreadsheet they sent, a photo. Hermes reads them as part of the buyer's message and checks any figures in them against the documents. They are used for that answer only and are not stored anywhere. Up to five files, 10 MB each.
- **Work the Referred questions screen.** Every question Hermes referred to the seller appears there as an Open item. When the seller replies, paste the reply and save. From then on Hermes answers that question from the seller's reply, for every buyer, and cites "Confirmed answers from the seller". A question asked again in different words creates another Open item; resolve either. The fallback is filling Seller Answer and setting Status to Resolved in Airtable directly.
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

1. After Aiman's review: the graded set (10 to 15 questions with known-correct answers) added to `scripts/regress-set.json` with expected figures, so the runner can score as well as check.
2. Before any buyer-facing access (Phase 2 of the original spec): the registered folder must become an allowlist folder, not the deal folder, and the coverage and sources data must be stripped from responses to buyers.

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
- **A saved seller answer, or any change to a listing's files, rewrites the prompt cache once.** Expected; the next question after it is the slow, cache-writing one.
- **Size caps are checked against Drive's declared size before download**, so a huge file is never pulled into memory on Render's 512 MB instance. Google-native files report no size, but those are exported as text and bounded by the text caps.
- **A loose service-account key file** sits at `Projects/Hermes/hermes-499709-*.json`. Its contents are already in `.env.local` and Render. Delete the file.
- **Drive returns an empty list, not an error, for a folder the service account cannot see.** On 10 Sep the service account (`hermes-reader@hermes-499709.iam.gserviceaccount.com`) lost its membership of the shared drive and Hermes read zero documents for every listing without any error. The app now refuses to answer in that case ("could not read any documents"). If that message appears for every business, re-add the service account as a Viewer on the shared drive. The five-minute cache never keeps an empty read, so the next question retries.
- **The workspace sits in an iCloud-synced Desktop folder.** iCloud creates `name 2` duplicate files on conflicts and has put them inside `.git` (breaking fetch with "bad object"), `.next` (breaking the type check) and `node_modules`. Delete them (`find . -name '* [0-9]' -o -name '* [0-9].*'`) or move the code out of iCloud sync (a folder named `*.nosync` is skipped).
- **Render env vars are the live values.** `ANTHROPIC_MAX_TOKENS` was still 3,500 in the dashboard after Phases A to C; hard questions hit it during thinking and came back empty. Set to 32,000 on 10 Sep.

## 10. Which documents are current

- `Hermes_Handoff.md` (this file): current state and operations. Start here.
- `Hermes_V2_Plan.md`: the analysis of Aiman's feedback, root causes, decisions, phases, and what is shipped versus pending. Current.
- `Hermes_Listing_Folder_Spec.md`: folder rules. Current.
- `Hermes_Brain.md`: the live system prompt (the copy in the repo is the one that runs). Current.
- `Hermes_Build_Spec.md`: the original Phase 1a specification. Still right on the product shape, the registry, the log and Phase 2 intent. Superseded on the model (now Sonnet 5), hosting (Render, not Vercel), ingestion, caching, the answer stream format, the log fields and the folder rules. Where it disagrees with this file or the V2 plan, those win.
- `Hermes_START_HERE.md`: the original first-build guide. Historical.
- `Hermes_Design_Spec.md`: branding. Current.
