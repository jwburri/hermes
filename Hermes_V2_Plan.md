# Hermes V2 Plan

Prepared 2026-09-08 from Aiman's feedback email (19 Jul 2026), the Hermes Q&A log (137 answers), and a line-by-line audit of the hermes-app code.

## 1. What Aiman reported, and what is actually causing it

Aiman's email is polite and says "no major concerns", but the examples he attached point at real defects. Every one of them traces to something specific in the current build.

| # | What Aiman saw | Listing | Root cause found in the code |
|---|---|---|---|
| 1 | Hermes only has the latest figures if the P&L *analysis doc* is current. He rewrites that doc every month because Hermes "cannot read spreadsheets". | All | Google Sheets are exported as CSV. The Drive CSV export returns **only the first tab**, with no tab name. A multi-tab P&L (one tab per year, or Summary / P&L / Traffic) silently contributes one tab. Excel files are handled correctly, which hid the bug. |
| 2 | Same question asked twice gave two different answers. One cited Taboola's SpendGuard throttling, the next omitted it and gave a different cause. | OwnVitality.com | Three independent sources of drift: sampling at temperature 1.0 (forced when thinking is on for Haiku), Drive file order not fixed so the prompt bytes change between calls, and no memory of previous answers to the same business. |
| 3 | Buyer wrote "$25-50 per day". Claude web corrected it to per month. Hermes repeated "$25-50/day" in its own restatement and never flagged the error. | OwnVitality.com | The brain has no "check the buyer's premise" step, and Haiku with a 1,500-token thinking budget does not do it unprompted. Accepting a false premise is a hallucination in all but name. |
| 4 | Claude web knew the Feb-May 2026 profit recovery ($5.4K-$8K/m). Hermes only knew "31% margin in 2023, 7% in 2025, January 2026 loss". | Gronanda.com | Same as row 1: the recent months lived in the spreadsheet tabs Hermes never saw. Also, Claude web was acting as Aiman's analyst, whereas the Hermes brain only writes buyer-facing replies, so it never volunteers trend commentary. |
| 5 | Claude web gave more detail on the Aurora Lamp (Trustpilot rating, return rate, quarterly ROAS, CAC). Hermes gave rounded figures (about 70% paid, ROAS about 3.0). | TheHaloSphere.com | Rounded figures are fine and match how Joe writes; "about" is the right register as long as the number is right. The real concern is coverage: if the folder is near the 600K-character cap, Hermes stops reading **all remaining files** and tells nobody. The files-read and files-skipped lists are computed and thrown away, so Aiman cannot see what Hermes did or did not read. |
| 6 | Hermes cannot take an attached file, image, or PDF with a question. | All | Not built. The question form is text only. |
| 7 | Claude web reads PDFs that are just screenshots. | All | Image-only PDFs and PNG/JPG files return nothing and are silently dropped. |
| 8 | Aiman is still using Joe's personal Claude account to fill the gaps. | All | Consequence of rows 1-7. V2 has to close the gap so he stops. |

Two things Aiman did not mention but the log shows:

- Aiman often pastes an entire buyer thread with "Please read the whole conversation and help me reply." The brain is written for a clean list of questions, so answer quality on these is luck.
- Answers cut off at the token cap would be streamed to the screen and logged to Airtable as if complete, because nothing checks the stop reason. The cap is 3,500 tokens including up to 1,500 of thinking, so roughly 1,500 words of visible answer. In practice it has never been hit: the longest of the 137 logged answers is about 1,700 tokens. It stays in the plan because it is a two-line fix and Sonnet's longer thinking makes it more likely.

## 1a. A folder problem found while checking the P&L location

Joe confirmed the P&L always lives in the Drive folder and is the source of truth, and pointed at the Gronanda **Public Data Room** folder. Hermes is not registered against that folder. It is registered against the parent internal deal folder, and the Public Data Room sits two levels down (deal folder, then "LOI Dataroom", then "Public Data Room"). Hermes recurses into subfolders, so it does reach the live P&L sheet, and then loses every tab but the first (row 1 above).

The bigger issue is what else it reaches on the way. The registered Gronanda folder contains two APA drafts, the LOI, a counter-LOI from a named buyer, call summaries, and two superseded P&L spreadsheets from December and March. The exclusion list catches "call-summary" and "asset purchase agreement" but not "APA" or "LOI", so the offer documents are being read into the prompt today. OwnVitality is similar: follow-up emails naming buyers and a price-reduction email sit in its registered folder. The brain hides the seller's identity, but nothing stops a buyer question like "what offers have you had" being answered from another buyer's LOI. The Listing Folder Spec already says to register a buyer-safe folder, not the deal folder.

**Decision (Joe, 2026-09-08): the Legals folder.** Hermes keeps reading the deal folder, recursion and all, so nothing changes about where documents live or how the team files them. Three layers keep the wrong things out:

1. **A `Legals` folder in each listing folder.** Every agreement, LOI, counter-LOI, APA and term sheet goes in there. Hermes is hard-coded never to enter a folder named Legal or Legals. One-time tidy per listing: move the loose legal docs (Gronanda has four at the top level today) into it.
2. **Name patterns as the second net.** Loose files whose names contain LOI, APA, letter of intent, negotiation, term sheet or heads of terms are skipped wherever they sit, on top of the existing broker, commission, engagement letter, call summary and outreach patterns. These deal-document patterns apply to file names only: a folder called "LOI Dataroom" legitimately holds the public data room. ("Offer", "counter" and "contract" were dropped as too broad; they would have hidden an offer page traffic report or a supplier contract summary.)
3. **The coverage panel.** Every answer lists the exact files Hermes read and the files it skipped with the reason, so a misfiled document shows up on the next question rather than in a buyer's inbox.

Why a denylist is acceptable now: Hermes is internal and Aiman reads every answer before it reaches a buyer, so the failure mode is "slips past Aiman", not direct exposure. **Before Phase 2 (buyers with direct access) this must become an allowlist folder.** Noted here so it is not forgotten.

One gap the Legals folder does not cover: non-legal documents that name other buyers (follow-up emails, price-reduction emails). Hermes should keep reading those for context, so the Phase B brain rewrite adds an explicit rule: never name other buyers, their offers, or price discussions to a buyer.

The seller interview needs no special handling. It is the same interview Hermes has read since June; the brain hides the seller's identity and Joe accepted that residual risk then.

## 2. Why the model switch matters, and why it is not enough on its own

Joe's call to move from Haiku 4.5 to Sonnet 5 is right. Sonnet 5 has a 1M-token context (Haiku: 200K), adaptive thinking, native PDF and image reading, and the citations feature. It is materially better at catching a wrong premise and at multi-month trend reasoning.

But rows 1, 4, 5 and 7 above are data problems. Sonnet cannot reason about tabs it was never shown. **The Sheets fix is the single biggest accuracy win in this plan, and it is about ten lines of code.** Model and data fixes ship together in Phase A.

Cost. Sonnet 5 is $2 input / $10 output per million tokens, versus Haiku's $1 / $5. Hermes currently sends the full knowledge base uncached on every question. V2 adds prompt caching (1-hour TTL), so repeat questions on the same business read the documents at roughly a tenth of the price.

| | Today (Haiku, no cache) | V2 (Sonnet 5, cached) |
|---|---|---|
| First question on a business in an hour | ~$0.12 | ~$0.28 |
| Follow-up question within the hour | ~$0.12 | ~$0.05 |
| Estimated monthly at current volume (~55 questions) | ~$7 | ~$6-15 |

Assumes a 100K-token knowledge base. Hermes will use Sonnet 5 only; Opus is not on the table for the live tool (Joe's call, cost). Opus may be used during the build for reviewing code, never inside Hermes.

Technical note: Sonnet 5 rejects the `budget_tokens` thinking parameter the app uses today, so this is a code change, not an env-var change.

## 3. Design principles for V2

1. **Grounded or referred, nothing in between.** Every figure in a buyer-facing answer must be traceable to a document. If it cannot be, the answer uses the referral line. This is enforced by citations, not by asking the model nicely.
2. **Check the buyer before answering the buyer.** Every number and claim in the question is verified against the documents first. Wrong premises are corrected explicitly, up front.
2a. **Check the answer before showing the answer.** A second, fresh-eyes pass reads the draft answer against the documents with no memory of how it was written, and rejects any figure, claim or period it cannot find. Same idea as the fresh-eyes review skill: the writer and the checker are separate calls. With caching, the checker re-reads the documents for a few cents.
3. **Two audiences, two sections.** A buyer-facing answer, then a clearly separated "Notes for you" block for Aiman: trend observations, discrepancies between documents, figures that could not be verified, what got referred to the seller. This is the Claude-web analyst behaviour Aiman values, without leaking it to buyers.
4. **Show your coverage.** The UI lists which documents were read, when each was last modified, and which were skipped and why. If a P&L is missing, Aiman sees it instead of guessing.
5. **Consistency by memory, not by luck.** Previous answers for the same business are fed back in, and seller-confirmed answers become part of the knowledge base.
6. **Auditable after the fact.** Every answer logs the model, effort, files read, files skipped, token usage, stop reason and the citations, so a wrong answer can be traced to a bad document, a missing document, or the model.
7. **Measured, not assumed.** A small fixed set of real questions is re-run before any brain or model change ships, so a regression is caught by a script rather than by a buyer.

## 4. The plan, in phases

### Phase A: accuracy core (ship first, one focused session)

- Switch to `claude-sonnet-5` with adaptive thinking and effort `high`. Raise max output tokens so long multi-question batches never truncate. Check the stop reason and never show or log a cut-off answer.
- Fix Google Sheets: export as Excel and reuse the existing per-tab parser, emitting tab names and proper dates. Render tabs as tables with headers so columns keep their meaning.
- Deterministic document order (sort by name), and per-file size limits instead of aborting the whole folder walk.
- Prompt caching on the knowledge base with a 1-hour TTL.
- Provenance logging to Airtable: model, effort, files read, files skipped, truncated flag, token usage, stop reason.
- Feed files-skipped and truncation into the prompt so the model knows its coverage is partial, and into the UI so Aiman knows.
- Hard-coded skip of any Legal/Legals folder, and the extended name patterns (see 1a).
- Brain confidentiality change: pushed and deployed 2026-09-08.

### Phase B: grounding and the two-audience answer

- Send documents as native document blocks with citations enabled. The UI shows sources per claim on expand. Any buyer-facing figure without a citation is flagged in the Notes block.
- Verification pass: a second call checks the draft against the documents and returns a list of unsupported claims. Unsupported claims are either removed and referred to the seller, or shown to Aiman in the Notes block with the reason, never silently kept. Rounded figures pass as long as they round correctly.
- Brain rewrite: premise-check rule, discrepancy rule (when two documents disagree, say so in Notes rather than silently picking the newest), period-labelling rule (every figure states the period it covers, e.g. "as of May 2026"), tighter hypothetical rule (reasoning from documented facts is labelled as inference and never invents numbers), and the "Notes for you" section.
- Handle pasted buyer threads explicitly: identify the last buyer message, treat the earlier thread as context.
- Consistency memory: the last N logged answers for the business are included as "answers already given, stay consistent unless the documents contradict them".

### Phase C: the workflow gaps Aiman named

- Attach files to a question (images, PDFs, spreadsheets, screenshots of buyer messages). Sent as native image and document blocks for that answer only, not stored. Confirmed in scope by Joe.
- Native PDF and image ingestion from Drive: PDFs go to the model as documents (so screenshot-only PDFs are read visually), PNG/JPG as images. Drive comments already ingested stay.
- Referred questions and seller answers loop (the unbuilt Phase 1b): Hermes writes referred questions to the Referred table, Aiman enters the seller's reply, and it is injected as confirmed knowledge next time. Knowledge grows per business without editing Drive.

### Phase D: hardening and proof

- Regression script: Aiman's three screenshot questions plus a dozen from the log, re-run against the build with the verification pass reporting unsupported claims and a same-question-twice consistency check. No grading needed from anyone to run it. The graded set with Aiman's known-correct answers waits until after the build, when he reviews the updated Hermes (Joe's call: no time for grading now).
- Security: **done 2026-09-09** for the dependency half (Next.js 16.3.4, npm audit fixes, `xlsx` from the SheetJS registry; zero advisories). Still to do: login rate limiting and constant-time password compare.
- Short document cache with a "Refresh documents" button, so repeated questions do not re-download the folder.

### Deliberately not in V2

- Public buyer-facing access (Phase 2 in the original spec). Everything above makes that safer later, but it stays internal for now.
- Gmail ingestion. Curated email content still goes into a Drive doc, as decided in June.
- Cross-buyer pattern analysis ("three passes on the same theme"). That needs Hermes to see all buyer conversations for a listing, which is a CRM question, not a Hermes one. Revisit once the referred-questions loop is live.

## 5. Decisions so far (2026-09-08)

- Plan approved by Joe with the amendments above: verification pass added, rounded figures are fine, attachments confirmed, Sonnet 5 only, graded eval deferred to the post-build feedback round.
- Brain confidentiality change committed locally; push pending the token fix below.
- P&L confirmed as the source of truth and always in the Drive folder. The analysis docs are not maintained.

- Token sorted (an expired June token in the keychain was shadowing the new one). Brain change pushed.
- **Phase A shipped 2026-09-08** (commit 3bf3aa8). Verified locally on Gronanda: every P&L tab read (answer now runs to May 2026 instead of stopping at March), all six APA and LOI documents excluded, the LOI Dataroom and live P&L sheet read, PDFs parsing again, prompt cache hitting in full on repeat questions, answer time down from 97s to about 23s after parallelising the Drive reads and adding a 5-minute document cache (both pulled forward from Phase D). Two things the coverage panel exposed that the team should know: Apple Numbers files (`.numbers`) and PNG screenshots are unreadable, so the Facebook ad-spend workbooks, the Google Ads spend file and the monthly COGS screenshots in Gronanda's folder contribute nothing until they are exported to Excel or Sheets (images come in Phase C).
- Folder decision: Legals folder plus name patterns plus coverage panel (section 1a).
- **Phase B shipped 2026-09-10.** Verified locally in production mode. OwnVitality, Aiman's exact "per day" question: the answer opens by correcting it to monthly, the Notes block records the correction and its sources, and the checker flagged one inference the documents do not quite support. Gronanda, a deliberately wrong premise ("about $15k net profit in May 2026, why has it dropped since January"): both errors corrected ($7,667 in May; the trend recovered from a January loss to $5.4K-$8K a month February to May), every figure carries its period, five sources cited, checker clean. Timing with a warm cache: 31s for OwnVitality, 62s for Gronanda (the verification call adds 4 to 20s). Cost per question about $0.12 cached, about $0.45 for the first question on a business in an hour. Dependency upgrade shipped 2026-09-09 (zero advisories).

## 6. Still needed from the team

1. **Eleven columns in the Airtable "Hermes Q&A Log" table** so answers carry provenance. Either add the `schema.bases:write` scope to the existing Airtable token (airtable.com/create/tokens) and Claude creates them, or add by hand: Model (single line text), Effort (single line text), Files Read (long text), Files Skipped (long text), Truncated (checkbox), Stop Reason (single line text), Input Tokens (number), Cache Read Tokens (number), Output Tokens (number), Hermes Notes (long text), Flagged Claims (long text). Until they exist the app logs the original four fields only.
2. **Create a `Legals` folder in each active listing folder** and move agreements, LOIs and APAs into it. Aiman can do this in a few minutes per listing.
3. **Render env vars** when Phase A deploys: ANTHROPIC_MODEL=claude-sonnet-5, ANTHROPIC_EFFORT=high, ANTHROPIC_MAX_TOKENS=16000, and delete ANTHROPIC_THINKING_BUDGET. These are in render.yaml, but values set in the Render dashboard override it, so check there.
