#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const inventoryPath = path.join(packageRoot, "migration-inventory.json");
const ledgerPath = path.join(packageRoot, "migration-targets.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isView = (value) => /^src\/.*\.svelte(?:\.ts)?$/.test(value);
const isSha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const implementationStatuses = ["unmapped", "partial", "implemented"];
const caseStatuses = ["planned", "passed", "failed"];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args, input) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      input,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  } catch (error) {
    throw new Error(`Cannot read Git data: ${error.stderr?.toString().trim() || error.message}`);
  }
}

function resolveCommit(ref) {
  requireValue(typeof ref === "string" && ref.length > 0, "A Git reference cannot be empty.");
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    .toString()
    .trim();
  requireValue(isSha(commit), `Cannot resolve a commit for ${ref}.`);
  return commit;
}

function readTree(commit) {
  const entries = new Map();
  for (const line of git(["ls-tree", "-r", "-z", "--full-tree", commit]).toString().split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const [mode, type, oid] = line.slice(0, tab).split(" ");
    entries.set(line.slice(tab + 1), { mode, type, oid });
  }
  return entries;
}

// Blob identities come from ls-tree, never from paths interpolated into a shell.
function hashBlobs(trees, wanted) {
  const oids = [
    ...new Set(
      trees.flatMap((tree) =>
        wanted
          .map((file) => tree.get(file))
          .filter((entry) => entry?.type === "blob")
          .map((entry) => entry.oid),
      ),
    ),
  ];
  if (oids.length === 0) return new Map();
  const output = git(["cat-file", "--batch"], `${oids.join("\n")}\n`);
  const hashes = new Map();
  let offset = 0;
  for (const oid of oids) {
    const end = output.indexOf(10, offset);
    requireValue(end >= offset, "Incomplete Git blob header.");
    const [actualOid, type, sizeString] = output.subarray(offset, end).toString().split(" ");
    const size = Number(sizeString);
    requireValue(
      actualOid === oid && type === "blob" && Number.isSafeInteger(size) && size >= 0,
      `Invalid Git blob header for ${oid}.`,
    );
    requireValue(end + 1 + size < output.length, `Incomplete Git blob ${oid}.`);
    hashes.set(oid, sha256(output.subarray(end + 1, end + 1 + size)));
    offset = end + size + 2;
  }
  return hashes;
}

function fileHash(tree, hashes, file) {
  const entry = tree.get(file);
  // Symlinks are not an implementation file, even if their blob text has a hash.
  return entry?.type === "blob" && ["100644", "100755"].includes(entry.mode)
    ? (hashes.get(entry.oid) ?? null)
    : null;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    requireValue(
      ["--reference", "--candidate", "--json", "--fail-on-drift", "--help"].includes(flag),
      `Unknown option ${flag}. Run with --help.`,
    );
    requireValue(!(flag in options), `Repeated option ${flag}.`);
    if (flag === "--reference" || flag === "--candidate") {
      const value = args[++index];
      requireValue(value && !value.startsWith("--"), `${flag} requires a Git reference.`);
      options[flag] = value;
    } else options[flag] = true;
  }
  return options;
}

function validate(inventoryBytes, inventory, ledger) {
  requireValue(
    inventory.schemaVersion === 1 && ledger.schemaVersion === 1,
    "Unsupported inventory or target-ledger schema.",
  );
  requireValue(
    ledger.inventory.sha256 === sha256(inventoryBytes),
    "The immutable inventory hash differs from the target ledger. Review the inputs; nothing was updated.",
  );
  requireValue(
    isSha(ledger.audit.candidateCommit) && isSha(ledger.inventory.referenceCommit),
    "The ledger must pin full reference and audit commit SHAs.",
  );
  requireValue(
    ledger.inventory.referenceCommit === inventory.reference.commit,
    "The ledger and immutable inventory reference commits differ.",
  );
  const paths = inventory.sources.map((source) => source.path);
  requireValue(new Set(paths).size === paths.length, "Duplicate immutable source IDs.");
  const denominator = inventory.sources.filter((source) => source.coverageUnit).length;
  requireValue(
    denominator === 1430 &&
      denominator === ledger.inventory.viewSourceDenominator &&
      denominator === inventory.coverage.viewSourceDenominator,
    "The immutable view-source denominator must remain 1430.",
  );
  requireValue(
    Object.keys(ledger.sources).length === paths.length &&
      ledger.inventory.sourceRecordCount === paths.length &&
      paths.every((source) => Object.hasOwn(ledger.sources, source)),
    "Ledger source IDs must exactly match the immutable inventory.",
  );
  for (const [id, review] of Object.entries(ledger.reviews)) {
    requireValue(
      review.referenceCommit === inventory.reference.commit &&
        review.candidateCommit === ledger.audit.candidateCommit &&
        Array.isArray(review.taskNoteIds) &&
        review.taskNoteIds.length > 0 &&
        review.taskNoteIds.every((task) => typeof task === "string" && task.length > 0) &&
        Array.isArray(review.implementationCommits) &&
        review.implementationCommits.every(isSha) &&
        typeof review.scope === "string" &&
        review.scope.length > 0,
      `Invalid review provenance for ${id}.`,
    );
  }
  for (const [source, row] of Object.entries(ledger.sources)) {
    requireValue(
      implementationStatuses.includes(row.implementation.status),
      `Invalid implementation status for ${source}.`,
    );
    requireValue(
      Array.isArray(row.targets) && Array.isArray(row.gaps),
      `Missing targets/gaps for ${source}.`,
    );
    requireValue(
      (row.implementation.status === "unmapped") === (row.targets.length === 0),
      `Mapped status and target paths disagree for ${source}.`,
    );
    if (row.targets.length)
      requireValue(
        ledger.reviews[row.implementation.reviewId] &&
          typeof row.implementation.reviewedContract === "string" &&
          row.implementation.reviewedContract.length > 0,
        `Missing source/API review for ${source}.`,
      );
    const uniqueTargets = new Set();
    for (const target of row.targets) {
      requireValue(
        target.path.startsWith("apps/react/") &&
          !target.path.split("/").includes("..") &&
          !target.path.includes("\\") &&
          isHash(target.sha256) &&
          isSha(target.lastChangedCommit) &&
          !uniqueTargets.has(target.path),
        `Invalid or duplicate target for ${source}.`,
      );
      uniqueTargets.add(target.path);
    }
    for (const kind of ["functional", "visual"]) {
      requireValue(Array.isArray(row[kind].cases), `Missing ${kind} case records for ${source}.`);
      const caseIds = new Set();
      for (const evidence of row[kind].cases) {
        const key = `${evidence.id}:${evidence.referenceCommit}:${evidence.candidateCommit}`;
        requireValue(
          typeof evidence.id === "string" &&
            evidence.id.length > 0 &&
            caseStatuses.includes(evidence.status) &&
            isSha(evidence.referenceCommit) &&
            isSha(evidence.manifestCommit) &&
            !caseIds.has(key),
          `Invalid ${kind} case for ${source}.`,
        );
        caseIds.add(key);
        if (evidence.status !== "planned")
          requireValue(
            isSha(evidence.candidateCommit) &&
              typeof evidence.artifact === "string" &&
              evidence.artifact.length > 0,
            `Executed ${kind} evidence needs a candidate revision and artifact for ${source}.`,
          );
      }
    }
  }
}

function sourceDrift(inventory, ledger, tree, hashes) {
  const known = new Set(inventory.sources.map((source) => source.path));
  const drift = {
    addedViews: [],
    changedViews: [],
    deletedViews: [],
    changedSupport: [],
    deletedSupport: [],
  };
  for (const source of inventory.sources) {
    const currentHash = fileHash(tree, hashes, source.path);
    if (currentHash === source.sha256) continue;
    const row = ledger.sources[source.path];
    const review = ledger.reviews[row.implementation.reviewId];
    const item = {
      source: source.path,
      baselineSha256: source.sha256,
      sha256: currentHash,
      targets: row.targets.map((target) => target.path),
      taskNoteIds: review?.taskNoteIds ?? [],
    };
    const key = source.coverageUnit
      ? currentHash === null
        ? "deletedViews"
        : "changedViews"
      : currentHash === null
        ? "deletedSupport"
        : "changedSupport";
    drift[key].push(item);
  }
  for (const file of [...tree.keys()].sort()) {
    if (isView(file) && !known.has(file))
      drift.addedViews.push({
        source: file,
        sha256: fileHash(tree, hashes, file),
        targets: [],
        taskNoteIds: [],
      });
  }
  return drift;
}

function summarize(
  inventory,
  ledger,
  tree,
  hashes,
  referenceCommit,
  candidateCommit,
  sourceChanges,
) {
  const missingTargets = new Map();
  const changedTargets = new Map();
  const groups = { views: [], support: [] };
  const unmappedSources = [];
  const invalidatedReviews = [];
  for (const source of inventory.sources) {
    const row = ledger.sources[source.path];
    let targetsFresh = true;
    for (const target of row.targets) {
      const hash = fileHash(tree, hashes, target.path);
      if (hash === target.sha256) continue;
      targetsFresh = false;
      const map = hash === null ? missingTargets : changedTargets;
      if (!map.has(target.path))
        map.set(target.path, {
          target: target.path,
          auditedSha256: target.sha256,
          sha256: hash,
          sources: [],
          taskNoteIds: [],
        });
      const detail = map.get(target.path);
      detail.sources.push(source.path);
      detail.taskNoteIds = [
        ...new Set([
          ...detail.taskNoteIds,
          ...ledger.reviews[row.implementation.reviewId].taskNoteIds,
        ]),
      ];
    }
    const sourceFresh = !sourceChanges.has(source.path);
    if (row.targets.length && (!sourceFresh || !targetsFresh))
      invalidatedReviews.push({
        source: source.path,
        sourceChanged: !sourceFresh,
        targetChangedOrMissing: !targetsFresh,
      });
    if (!row.targets.length) unmappedSources.push(source.path);
    groups[source.coverageUnit ? "views" : "support"].push({
      row,
      fresh: sourceFresh && targetsFresh,
    });
  }
  const counts = {};
  for (const [kind, entries] of Object.entries(groups)) {
    counts[kind] = {
      total: entries.length,
      implementation: Object.fromEntries(
        implementationStatuses.map((status) => [
          status,
          entries.filter(({ row }) => row.implementation.status === status).length,
        ]),
      ),
      currentImplementation: Object.fromEntries(
        ["partial", "implemented"].map((status) => [
          status,
          entries.filter(({ row, fresh }) => fresh && row.implementation.status === status).length,
        ]),
      ),
      currentReviewedSources: entries.filter(({ row, fresh }) => fresh && row.targets.length > 0)
        .length,
    };
    for (const evidenceKind of ["functional", "visual"]) {
      const cases = new Map();
      let sourcesWithCurrentPassingCases = 0;
      for (const { row, fresh } of entries) {
        let currentPass = false;
        for (const entry of row[evidenceKind].cases) {
          const current =
            fresh &&
            entry.referenceCommit === referenceCommit &&
            entry.candidateCommit === candidateCommit;
          const bucket = entry.status === "planned" ? "planned" : current ? entry.status : "stale";
          const id = `${entry.id}:${entry.referenceCommit}:${entry.candidateCommit}`;
          if (!cases.has(id)) cases.set(id, bucket);
          else if (bucket === "stale") cases.set(id, bucket);
          currentPass ||= bucket === "passed";
        }
        if (currentPass) sourcesWithCurrentPassingCases++;
      }
      counts[kind][evidenceKind] = {
        uniqueRecordedCases: cases.size,
        ...Object.fromEntries(
          ["planned", "passed", "failed", "stale"].map((status) => [
            status,
            [...cases.values()].filter((value) => value === status).length,
          ]),
        ),
        sourcesWithCurrentPassingCases,
      };
    }
  }
  return {
    counts,
    unmappedSources,
    missingTargets: [...missingTargets.values()],
    changedTargets: [...changedTargets.values()],
    invalidatedReviews,
  };
}

function help() {
  console.log(`Usage: node packages/view-parity/scripts/migration-status.mjs [options]

  --reference <git ref>  Incoming Svelte source revision; defaults to inventory.reference.commit.
  --candidate <git ref>  React target revision; defaults to ledger.audit.candidateCommit.
  --json                Print the complete structured report, including every unmapped source.
  --fail-on-drift        Exit 1 for source drift, changed targets or missing targets.
  --help                Show this help.

Only committed Git blobs are inspected. Dirty/untracked working files are excluded.
Both reference and candidate source trees are compared with the immutable inventory,
including inventoried supporting modules affected by neutral extraction. Added view
units are reported without changing the original 1430-unit denominator. Mapped file
existence and planned test cases never establish acceptance. Case evidence must name
the exact reference/candidate revisions; one passing case never accepts a whole source.
No fetch, checkout, file write, baseline update or acceptance promotion is performed.
Exit codes: 0 report produced, 1 drift with --fail-on-drift, 2 invalid inputs/Git error.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options["--help"]) return help();
  const inventoryBytes = readFileSync(inventoryPath);
  const inventory = JSON.parse(inventoryBytes);
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  validate(inventoryBytes, inventory, ledger);
  const baselineCommit = resolveCommit(inventory.reference.commit);
  const referenceCommit = resolveCommit(options["--reference"] ?? baselineCommit);
  const candidateCommit = resolveCommit(options["--candidate"] ?? ledger.audit.candidateCommit);
  const auditedCandidateCommit = resolveCommit(ledger.audit.candidateCommit);
  const trees = new Map(
    [...new Set([baselineCommit, referenceCommit, candidateCommit, auditedCandidateCommit])].map(
      (commit) => [commit, readTree(commit)],
    ),
  );
  const targets = Object.values(ledger.sources).flatMap((row) =>
    row.targets.map((target) => target.path),
  );
  const wanted = [
    ...new Set([
      ...inventory.sources.map((source) => source.path),
      ...targets,
      ...[...trees.values()].flatMap((tree) => [...tree.keys()].filter(isView)),
    ]),
  ];
  const hashes = hashBlobs([...trees.values()], wanted);
  for (const source of inventory.sources)
    requireValue(
      fileHash(trees.get(baselineCommit), hashes, source.path) === source.sha256,
      `Immutable source hash does not match its Git blob: ${source.path}`,
    );
  for (const row of Object.values(ledger.sources))
    for (const target of row.targets)
      requireValue(
        fileHash(trees.get(auditedCandidateCommit), hashes, target.path) === target.sha256,
        `Audited target hash does not match its pinned Git blob: ${target.path}`,
      );
  const reference = sourceDrift(inventory, ledger, trees.get(referenceCommit), hashes);
  const candidate = sourceDrift(inventory, ledger, trees.get(candidateCommit), hashes);
  const sourceChanges = new Set(
    [...Object.values(reference), ...Object.values(candidate)].flat().map((entry) => entry.source),
  );
  const status = summarize(
    inventory,
    ledger,
    trees.get(candidateCommit),
    hashes,
    referenceCommit,
    candidateCommit,
    sourceChanges,
  );
  const report = {
    schemaVersion: 1,
    baselineCommit,
    referenceCommit,
    candidateCommit,
    auditedCandidateCommit,
    viewSourceDenominator: inventory.coverage.viewSourceDenominator,
    sourceDrift: { reference, candidate },
    ...status,
    limits: [
      "Implementation counts describe the recorded source/API audit, not full migration acceptance.",
      "A passing case is scoped evidence only; no whole-source acceptance count is inferred.",
      "Planned case definitions are not executed results. Unrecorded historical runs remain unreviewed.",
      "Only inventory support paths and all Svelte view units are monitored; this is not a complete build-dependency graph.",
      "Working-tree edits are excluded. This read-only report does not refresh pinned evidence.",
    ],
  };
  if (options["--json"]) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`View migration status: ${report.viewSourceDenominator} baseline view sources`);
    console.log(
      `Baseline: ${baselineCommit}\nReference: ${referenceCommit}\nCandidate: ${candidateCommit}`,
    );
    for (const side of ["reference", "candidate"]) {
      const drift = report.sourceDrift[side];
      console.log(
        `${side} source drift: ${drift.addedViews.length} added, ${drift.changedViews.length} changed, ${drift.deletedViews.length} deleted views; ${drift.changedSupport.length} changed, ${drift.deletedSupport.length} deleted support files`,
      );
      for (const entries of Object.values(drift))
        for (const entry of entries) {
          console.log(
            `  ${entry.source}${entry.targets.length ? ` -> ${entry.targets.join(", ")}` : " (unmapped)"}${entry.taskNoteIds.length ? `; tasks ${entry.taskNoteIds.join(", ")}` : ""}`,
          );
        }
    }
    for (const kind of ["views", "support"]) {
      const count = report.counts[kind];
      console.log(
        `${kind} recorded audit: ${JSON.stringify(count.implementation)}; current implementation audit: ${JSON.stringify(count.currentImplementation)}; current reviewed sources ${count.currentReviewedSources}`,
      );
      console.log(`  Functional cases: ${JSON.stringify(count.functional)}`);
      console.log(`  Visual cases: ${JSON.stringify(count.visual)}`);
    }
    console.log(
      `Targets: ${report.missingTargets.length} absent, ${report.changedTargets.length} changed; ${report.invalidatedReviews.length} source reviews need refresh.`,
    );
    for (const item of [...report.missingTargets, ...report.changedTargets])
      console.log(
        `  ${item.target} <- ${item.sources.join(", ")}; tasks ${item.taskNoteIds.join(", ")}`,
      );
    console.log(
      `Unmapped inventory sources: ${report.unmappedSources.length}; use --json for the full path list.`,
    );
    console.log(report.limits.join("\n"));
  }
  if (
    options["--fail-on-drift"] &&
    (sourceChanges.size || status.missingTargets.length || status.changedTargets.length)
  )
    process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Migration status: ${error.message}`);
  process.exitCode = 2;
}
