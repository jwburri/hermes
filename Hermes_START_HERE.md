# Hermes — Start Here

Hermes is built and live at https://hermes.justwebsitebrokerage.com. This file used to be the first-build guide for Claude Code (June 2026). That job is done.

If you are picking Hermes up, read these in order:

1. `Hermes_Handoff.md` — what Hermes is, where everything lives, how an answer is produced, how to run, deploy and roll back, the operating rules for the team, what is still to build, and the traps already found.
2. `Hermes_V2_Plan.md` — the analysis behind V2 (Aiman's feedback and the root causes in the code), the decisions Joe made, and the phase-by-phase scope with what has shipped.
3. `Hermes_Listing_Folder_Spec.md` — how each listing's Drive folder must be organised, including the Legals folder rule.

The code is in `hermes-app/` (a clone of github.com/jwburri/hermes). All code changes go through Claude Code; the team never edits the code by hand. To change how Hermes answers, edit `hermes-app/Hermes_Brain.md` and push.

The original build specification, `Hermes_Build_Spec.md`, is kept for the product intent and the Phase 2 (buyer-facing) design, but the handoff and the V2 plan win wherever they differ.
