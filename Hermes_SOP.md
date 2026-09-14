# Hermes: how to use it

One page. From a new listing to answered buyer questions. Hermes is at https://hermes.justwebsitebrokerage.com, team password from Joe.

## 1. Set up the Drive folder (once per listing)

Hermes reads every file in the listing's folder and its subfolders. It stores nothing; the folder is the knowledge.

```
Brokerage 2.0 / WEBSITES / [Domain]/          <- register this folder in Hermes
    LOI Data Room/ (or Data Room/)             <- buyer-safe documents live here
        Business Description
        Seller Interview
        P&L (the live Google Sheet, every tab is read)
        P&L analysis report            <- made by the skill in step 2
        Email correspondence report    <- made by the skill in step 2
        revenue and traffic proof, screenshots, PDFs
    Legals/                                    <- LOI, APA, counter offers, broker agreement. Hermes never opens this folder
```

Rules:

- Every agreement, LOI, APA, term sheet and counter offer goes in `Legals`. Nothing legal sits loose.
- Hermes also skips any file whose name contains LOI, APA, letter of intent, negotiation, term sheet, heads of terms, broker, commission, engagement letter, call summary, asset purchase agreement, outreach or legal. Do not name a document you want read with those words.
- Readable: Google Docs, Sheets, Slides, PDF (including scans and screenshots), Word, Excel, CSV, text, PNG and JPG. Not readable: Apple Numbers. Export those to Sheets or Excel.
- The live P&L sheet is the source of truth. Analysis documents can go stale; Hermes flags conflicts.

## 2. Generate the two knowledge documents (Joe, in Claude)

Run these once when the listing goes live, then again when a month closes or new seller emails arrive. Each run adds a new dated Google Doc to the data room.

```
/jwb-hermes-pl-analysis [Domain]
/jwb-hermes-email-report [Domain] [seller email]
```

The first reads the P&L and writes the financial analysis and vetting verdict. The second turns the seller's emails into a buyer-safe facts document with the seller's identity, deal pricing and other buyers stripped out.

## 3. Register the listing in Hermes (2 minutes)

Add business. Name is the domain exactly as it should read in the dropdown, for example `PawsLoveStore.com`. Paste the Drive folder link. Save.

Then ask it one question and open "Documents Hermes read" under the answer. If a file you expected is missing, the reason is shown next to it. Fix the folder and tick "Re-read the documents from Drive first" on the next question.

## 4. Answer a buyer

1. Pick the business. Paste the buyer's questions, or the whole email thread. Attach any screenshot, PDF or spreadsheet the buyer sent (up to five files).
2. Get answers. About 30 seconds for a short question, a few minutes for a long batch.
3. Read three things before you send:
   - **The answer.** Hermes corrects wrong figures in the buyer's question and gives the period for every number.
   - **Notes for you.** Never for the buyer. Corrections made, documents that disagree, trends, questions referred to the seller.
   - **Check before sending.** A second pass that lists any claim it could not find in the documents. If something is listed, check it yourself before sending.
4. Copy answers copies only the buyer-facing part. Paste into your email and send.

## 5. Questions Hermes refers to the seller

When Hermes cannot answer from the documents it writes "We will send this question to the seller and get back to you". Each of those is saved automatically under Referred questions in the top menu.

When the seller replies: open Referred questions, paste the reply under the question, Save. From then on Hermes answers that question itself, for every buyer. No document edits needed.

## 6. Changes and endings

- A document changed or was added: tick "Re-read the documents from Drive first" on the next question. Otherwise Hermes picks it up within five minutes.
- Business sold or pulled: Add business, then Archive next to its name. The folder is untouched.

## 7. If something looks wrong

- **"Could not read any documents"** on every business: the Drive share to Hermes was removed. Tell Joe. The fix is re-adding `hermes-reader@hermes-499709.iam.gserviceaccount.com` as Viewer on the shared drive.
- **An answer is thin or wrong:** open "Documents Hermes read". The file with the fact is either missing, skipped by a name rule, or in an unreadable format.
- **Answer cut off:** ask fewer questions in one go.
- **Anything else:** copy the question and what Hermes said, and send it to Joe.
