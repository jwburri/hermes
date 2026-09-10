/**
 * Regression runner for Hermes. Run this before shipping a brain or model
 * change, read the report, then ship.
 *
 *   node scripts/regress.ts                     # every case in regress-set.json
 *   node scripts/regress.ts --only Gronanda     # cases whose business matches
 *   node scripts/regress.ts --case 9            # one case, 1-based
 *   HERMES_BASE=https://... node scripts/regress.ts
 *
 * Run it from the repo root: the case file and the fixtures are named relative
 * to it. Every request sets dryRun, so a run writes nothing to the Airtable log
 * or the referred-questions table. Cases run one at a time, which keeps the
 * prompt cache warm and an 8 GB Mac usable.
 *
 * Exit code 1 if any case stopped for a reason other than end_turn, the verify
 * pass errored, or the request failed. A failing case never stops the others.
 */

import fs from "node:fs";
import path from "node:path";
import {
  type Folded,
  extractNumbers,
  foldLine,
  newFolded,
  splitNotes,
  symmetricDifference,
} from "./regress-lib.ts";

const BASE = process.env.HERMES_BASE ?? "http://localhost:3000";
const SET_FILE = "scripts/regress-set.json";
const OUT_DIR = "scripts/regress-out";
const SESSION_COOKIE = "hermes_session";

interface Case {
  business: string;
  questions: string;
  attachments?: string[];
  repeat?: boolean;
}

interface Run extends Folded {
  seconds: number;
  /** Set when the request itself failed; the fold is then empty. */
  httpError: string;
}

interface Result {
  n: number;
  spec: Case;
  runs: Run[];
  /** Set when the business is not in the active list; runs is then empty. */
  skipped: string;
  consistency: string;
}

const USAGE = `Usage: node scripts/regress.ts [--only <business substring>] [--case <n>]

  --only <text>   run only cases whose business name contains <text>
  --case <n>      run only case <n> (1-based, as numbered in ${SET_FILE})
  --help          this message

  HERMES_BASE     server to test (default ${BASE})`;

/** Read one value out of .env.local. The password never goes on the command line. */
function envLocal(key: string): string {
  const line = fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.trimStart().startsWith(`${key}=`));
  if (!line) throw new Error(`${key} is not set in .env.local`);
  return line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}

/** Log in and return the session cookie as a Cookie header value. */
async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: envLocal("TEAM_PASSWORD") }),
  }).catch((err: Error) => {
    // "fetch failed" on its own sends people hunting for the wrong problem.
    throw new Error(`Could not reach ${BASE}: ${err.message}. Is it running?`);
  });
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}). Is ${BASE} running?`);
  }
  // One cookie, ours. getSetCookie keeps the headers separate; the joined
  // header would be ambiguous once a cookie value contains a comma.
  const header = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!header) throw new Error("Login returned no session cookie.");
  return header;
}

async function activeBusinesses(cookie: string): Promise<Map<string, string>> {
  const res = await fetch(`${BASE}/api/businesses`, { headers: { cookie } });
  const body = (await res.json()) as {
    businesses?: { id: string; name: string }[];
    error?: string;
  };
  if (!res.ok || !body.businesses) {
    throw new Error(`Could not list businesses: ${body.error ?? res.status}`);
  }
  return new Map(body.businesses.map((b) => [b.name, b.id]));
}

/** One answer request, folded. Never throws: failures come back as httpError. */
async function runOnce(spec: Case, businessId: string, cookie: string): Promise<Run> {
  const started = Date.now();
  const folded = newFolded();
  let httpError = "";
  try {
    let init: RequestInit;
    if (spec.attachments?.length) {
      const form = new FormData();
      form.append("businessId", businessId);
      form.append("questions", spec.questions);
      form.append("dryRun", "1");
      for (const file of spec.attachments) {
        form.append("files", new Blob([fs.readFileSync(file)]), path.basename(file));
      }
      init = { method: "POST", headers: { cookie }, body: form };
    } else {
      init = {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          questions: spec.questions,
          dryRun: true,
        }),
      };
    }

    const res = await fetch(`${BASE}/api/answer`, init);
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      httpError = `HTTP ${res.status}: ${body.error ?? "no body"}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // The tail may be half a line; keep it for the next chunk.
        buffer = lines.pop() ?? "";
        for (const line of lines) foldLine(folded, line);
      }
      foldLine(folded, buffer + decoder.decode());
    }
  } catch (err) {
    httpError = `Request failed: ${(err as Error).message}`;
  }
  return { ...folded, seconds: (Date.now() - started) / 1000, httpError };
}

function failed(r: Result): boolean {
  if (r.skipped) return false;
  return r.runs.some(
    (run) => run.httpError || run.stopReason !== "end_turn" || !!run.flags?.error,
  );
}

function flagCount(run: Run): number {
  return run.flags ? run.flags.unsupported.length + run.flags.premise.length : 0;
}

/** Repeated cases show both runs in one cell, as "first / second". */
function summaryTable(results: Result[]): string {
  const rows = results.map((r): (string | number)[] => {
    if (r.skipped) {
      return [r.n, r.spec.business, "skipped", "", "", "", "", "", r.skipped];
    }
    const run = r.runs[0];
    const both = (f: (x: Run) => string | number) => r.runs.map(f).join(" / ");
    return [
      r.n,
      r.spec.business,
      run.httpError ? "error" : run.stopReason || "(none)",
      both((x) => x.seconds.toFixed(1)),
      run.filesRead,
      both((x) => x.usage.outputTokens),
      both(flagCount),
      both((x) => x.referred.length),
      r.consistency,
    ];
  });
  return [
    ["#", "Business", "Stop", "Secs", "Files", "Out tokens", "Flagged", "Referred", "Consistency"],
    ["---", "---", "---", "---", "---", "---", "---", "---", "---"],
    ...rows,
  ]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
}

function runSection(run: Run, label: string): string {
  const lines: string[] = [];
  if (run.httpError) return `${label}\n\n${run.httpError}\n`;
  const { answer, notes } = splitNotes(run.text);
  lines.push(label);
  lines.push(
    `\nstop \`${run.stopReason || "(none)"}\` · ${run.seconds.toFixed(1)}s · ` +
      `${run.filesRead} files read, ${run.filesSkipped} skipped` +
      (run.truncated ? " (truncated)" : "") +
      ` · ${run.sources} sources · model \`${run.model || "(unknown)"}\``,
  );
  lines.push(
    `\ntokens: ${run.usage.outputTokens} out, ${run.usage.inputTokens} in, ` +
      `${run.usage.cacheReadTokens} cache read, ${run.usage.cacheCreationTokens} cache created`,
  );
  if (run.attachmentsRead.length || run.attachmentsIgnored.length) {
    lines.push(
      `\nattachments read: ${run.attachmentsRead.join(", ") || "none"} · ` +
        `ignored: ${run.attachmentsIgnored.join(", ") || "none"}`,
    );
  }
  lines.push("\n**Answer**\n");
  lines.push(answer || "_(empty)_");
  lines.push("\n**Notes for you**\n");
  lines.push(notes || "_(none)_");
  lines.push("\n**Flags**\n");
  if (!run.flags) {
    lines.push("_the check did not run_");
  } else if (run.flags.error) {
    lines.push(`_check errored: ${run.flags.error}_`);
  } else if (!flagCount(run)) {
    lines.push(`_nothing flagged (verdict: ${run.flags.verdict || "?"})_`);
  } else {
    for (const u of run.flags.unsupported) lines.push(`- "${u.claim}" — ${u.why}`);
    for (const p of run.flags.premise) {
      lines.push(`- Buyer said "${p.buyer_said}". Documents say: ${p.documents_say}`);
    }
  }
  lines.push("\n**Referred to the seller**\n");
  lines.push(run.referred.length ? run.referred.map((q) => `- ${q}`).join("\n") : "_none_");
  return lines.join("\n") + "\n";
}

function report(results: Result[], stamp: string): string {
  const out = [
    `# Hermes regression — ${stamp}`,
    "",
    `${BASE} · ${results.length} cases · ${results.filter(failed).length} failed · ` +
      `${results.filter((r) => r.skipped).length} skipped`,
    "",
    summaryTable(results),
    "",
  ];
  for (const r of results) {
    out.push(`## ${r.n}. ${r.spec.business}`, "");
    out.push("**Question**", "", "```", r.spec.questions, "```", "");
    if (r.skipped) {
      out.push(`Skipped: ${r.skipped}`, "");
      continue;
    }
    r.runs.forEach((run, i) => {
      out.push(runSection(run, r.runs.length > 1 ? `### Run ${i + 1}` : "### Run"));
    });
    if (r.runs.length > 1) out.push(`**Consistency:** ${r.consistency}`, "");
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let only = "";
  let single = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      return;
    } else if (arg === "--only") {
      only = argv[++i] ?? "";
      if (!only) throw new Error("--only needs a business substring.");
    } else if (arg === "--case") {
      single = Number(argv[++i]);
      if (!Number.isInteger(single) || single < 1) {
        throw new Error("--case needs a whole number, 1 or more.");
      }
    } else {
      throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    }
  }

  const { cases } = JSON.parse(fs.readFileSync(SET_FILE, "utf8")) as {
    cases: Case[];
  };
  // Number every case first, so --only and --case still refer to the file.
  const selected = cases
    .map((spec, i) => ({ n: i + 1, spec }))
    .filter(({ n, spec }) => {
      if (single && n !== single) return false;
      if (only && !spec.business.toLowerCase().includes(only.toLowerCase())) return false;
      return true;
    });
  if (!selected.length) throw new Error("No cases matched.");

  const cookie = await login();
  const businesses = await activeBusinesses(cookie);

  const results: Result[] = [];
  for (const { n, spec } of selected) {
    const businessId = businesses.get(spec.business);
    if (!businessId) {
      console.log(`${n}. ${spec.business}: skipped (not active)`);
      results.push({
        n,
        spec,
        runs: [],
        skipped: "not in the active business list",
        consistency: "",
      });
      continue;
    }

    const runs: Run[] = [];
    const times = spec.repeat ? 2 : 1;
    for (let i = 0; i < times; i++) {
      process.stdout.write(
        `${n}. ${spec.business}${times > 1 ? ` (run ${i + 1}/${times})` : ""}… `,
      );
      const run = await runOnce(spec, businessId, cookie);
      runs.push(run);
      console.log(
        run.httpError || `${run.stopReason} in ${run.seconds.toFixed(1)}s`,
      );
    }

    let consistency = "";
    if (times > 1) {
      const [a, b] = runs.map((r) => extractNumbers(splitNotes(r.text).answer));
      const diff = symmetricDifference(a, b);
      consistency = diff.length
        ? `differs: ${diff.join(", ")}`
        : "consistent";
    }
    results.push({ n, spec, runs, skipped: "", consistency });
  }

  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${stamp}.md`);
  fs.writeFileSync(file, report(results, stamp));

  console.log(`\n${summaryTable(results)}\n\nReport: ${file}`);
  if (results.some(failed)) process.exitCode = 1;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
