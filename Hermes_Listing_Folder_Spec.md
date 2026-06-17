# Hermes Listing Spec

How a business's information is stored and registered so Hermes can answer questions about it. The principle is that documents stay exactly where they already live in Google Drive. Hermes only stores a link to each folder, not the files. Adding a business is pasting a name and a Drive link.

## Two parts: the folder and the registry

**The folder (in Google Drive).** Each business already has, or gets, one Google Drive folder holding its documents. These folders stay where they are. Nothing moves into a new location.

**The registry (in Airtable).** A small table called "Hermes Listings" holds one row per business: the business name and the link to its Drive folder. This is the list Hermes shows in its dropdown. It is plain text, the documents are not copied into it.

So a business exists in Hermes when it has a row in the registry pointing at a Drive folder. Remove or archive the row and it disappears from Hermes. The documents are untouched either way.

## Adding a business

Two ways, same result:

1. **In Hermes (the normal way):** open the "Add business" screen, type the business name exactly as it should appear in the dropdown (use the domain, for example `PawsLoveStore.com`), paste the Google Drive folder link, and save. Hermes adds the registry row.
2. **In Airtable directly:** add a row to the "Hermes Listings" table with the name and the Drive folder link, set Status to Active. Useful as a fallback.

That is the whole process. No moving files, no developer, no deploy.

## The folder must be buyer-safe (important)

Point Hermes at a buyer-safe folder, not your full internal deal folder. Hermes reads every file in the folder you register and may use anything in it to answer a buyer. So the folder should contain only documents you are happy a buyer could be told about. This is the same curation you already do when you choose what goes into a Claude Project.

The simplest way to guarantee this is a dedicated folder per listing (for example a "Hermes" subfolder inside the deal folder, or a separate clean folder) that holds only the buyer-safe documents. Register that folder's link, not the parent deal folder.

**Keep these OUT of the registered folder:** the broker agreement, anything with commission or fee detail, your private notes and valuation working, the seller's real name and contact details, and any internal or draft documents. Even though the Brain is told never to reveal these, the safest design is to never put them in front of Hermes at all.

## What goes in the folder

Put in the documents Hermes should answer from, the same buyer-safe set you load into a Claude Project today. Typically:

- Business Description
- Seller Interview (buyer-safe version)
- P&L (the numbers)
- Financial Report
- Buyer question history or listing Q&A, if you have it
- Email threads with the seller that contain real answers (with internal or identifying parts removed)
- Revenue or traffic proof

There is no fixed file list and no required file names. The more complete the folder, the better the answers. If a fact is not in the folder, Hermes will not know it and will fall back to "we will send this question to the seller".

## File formats Hermes can read

- Google Docs, Google Sheets, Google Slides (read natively)
- PDF (text is extracted, see the caution below)
- Word (.docx), Excel (.xlsx)
- Plain text (.txt) and Markdown (.md)

**One caution on PDFs.** If a PDF has selectable text, Hermes reads it fine. If a PDF is just a screenshot or photo (for example a revenue proof that is an image), there is no text in it to read. If a number only exists as a screenshot, also write that number as text somewhere in the folder (in the Business Description or a short notes doc) so Hermes can answer on it. The build spec covers an optional image-reading upgrade if this becomes a regular problem.

## Drive access (set up once)

All of JWB's listing folders sit under one shared drive. That shared drive is shared once with Hermes's read-only Google service account. Because every folder lives under it, any folder link you paste into the registry is automatically readable, with no per-business sharing step. The service account can read only that shared drive and nothing else in Drive, which keeps confidential seller files contained to where they already are.

If a listing folder is ever created outside that shared drive, it will not be readable until that folder (or its parent) is also shared with the service account.

## Updating a business

If a document changes (an updated P&L for example), edit or replace the file in that business's Drive folder. Hermes picks up the current version within a few minutes (it briefly caches each business's files, see the build spec). The team only ever maintains the documents and the registry, never Hermes itself.

## Capturing new answers from the seller

When a buyer asks something Hermes cannot answer, Hermes refers it to the seller. Once the seller replies, you do not need to edit a Drive document. Open the Referred questions screen in Hermes for that business, type the seller's answer, and save (or fill the answer into the Hermes Q&A Log table in Airtable). Hermes then includes that confirmed answer the next time the same thing is asked, so each business's knowledge grows as buyers ask questions. The full mechanism is in the build spec, Section 10.

## Removing or pausing a business

When a business sells or is pulled, set its registry row to Archived (or delete the row). It disappears from the Hermes dropdown. The Drive folder and its documents are left alone.

## Security

The documents never leave Google Drive and are never duplicated. The service account is read-only and limited to the one shared drive. The registry holds only names and links. Only people with access to the Airtable base and the shared drive can add or change listings, the same people who already handle these files.
