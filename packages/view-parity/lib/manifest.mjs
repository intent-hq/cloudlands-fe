import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(packageRoot, "../..");

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid scene manifest: ${message}`);
}

function sourcePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split("/").includes("..")
  );
}

function validateReference(reference) {
  requireValue(
    typeof reference?.commit === "string" && /^[a-f0-9]{40}$/.test(reference.commit),
    "reference.commit must be a full commit SHA",
  );
  requireValue(
    typeof reference?.sourceTreeSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(reference.sourceTreeSha256),
    "reference.sourceTreeSha256 must be SHA-256",
  );
  requireValue(
    Array.isArray(reference.sourcePaths) &&
      reference.sourcePaths.length > 0 &&
      reference.sourcePaths.every(sourcePath),
    "reference.sourcePaths must be repository-relative",
  );
}

function selectReference(manifest, name) {
  requireValue(
    typeof name === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
    "reference profile name must contain lowercase letters, digits and single hyphens",
  );
  const baseCommit = manifest.reference.commit;
  if (name === "default") {
    manifest.referenceProfile = {
      name,
      file: "packages/view-parity/scene-manifest.json",
      baseCommit,
    };
    return;
  }
  const relative = `references/${name}.json`;
  const file = path.join(packageRoot, relative);
  let contents;
  try {
    contents = readFileSync(file);
  } catch (error) {
    throw new Error(
      `Cannot load reference profile ${name}: ${error.message}. No reference was changed.`,
    );
  }
  requireValue(
    path.relative(realpathSync(packageRoot), realpathSync(file)) ===
      path.join("references", `${name}.json`),
    `reference profile ${name} must be a file within references/, not a symlink elsewhere`,
  );
  let profile;
  try {
    profile = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Reference profile ${name} is not valid JSON: ${error.message}`);
  }
  requireValue(
    profile &&
      typeof profile === "object" &&
      !Array.isArray(profile) &&
      Object.keys(profile).every((key) =>
        ["schemaVersion", "baseCommit", "reviewReason", "reference"].includes(key),
      ) &&
      profile.schemaVersion === 1,
    `reference profile ${name} must use schemaVersion 1 and only the documented fields`,
  );
  requireValue(
    /^[a-f0-9]{40}$/.test(profile.baseCommit) && profile.baseCommit === baseCommit,
    `reference profile ${name} must identify the original manifest reference as baseCommit`,
  );
  requireValue(
    typeof profile.reviewReason === "string" &&
      profile.reviewReason.trim().length > 0 &&
      profile.reviewReason.length <= 500,
    `reference profile ${name} requires a short reviewReason (1–500 characters)`,
  );
  validateReference(profile.reference);
  requireValue(
    Object.keys(profile.reference).every((key) =>
      ["commit", "sourceTreeSha256", "sourcePaths"].includes(key),
    ),
    `reference profile ${name} has unknown reference fields`,
  );
  const paths = profile.reference.sourcePaths;
  requireValue(
    new Set(paths).size === paths.length &&
      paths.every((value) =>
        value
          .split("/")
          .every(
            (part) =>
              /^[a-zA-Z0-9_.-]+$/.test(part) &&
              part !== "." &&
              part !== ".." &&
              !part.startsWith("-"),
          ),
      ) &&
      manifest.reference.sourcePaths.every((value) => paths.includes(value)),
    `reference profile ${name} must retain every original source path without duplicates, pathspecs or traversal`,
  );
  const repoFile = `packages/view-parity/${relative}`;
  let committed;
  try {
    committed = execFileSync("git", ["-C", repoRoot, "show", `HEAD:${repoFile}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`Reference profile ${name} must be reviewed and committed before use.`);
  }
  requireValue(
    contents.equals(committed),
    `reference profile ${name} differs from its committed record`,
  );
  manifest.reference = profile.reference;
  manifest.referenceProfile = {
    name,
    file: repoFile,
    sha256: createHash("sha256").update(contents).digest("hex"),
    baseCommit,
    reviewReason: profile.reviewReason,
  };
}

export function loadManifest(referenceProfile = process.env.PARITY_REFERENCE_PROFILE || "default") {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "scene-manifest.json"), "utf8"));
  requireValue(manifest.schemaVersion === 1, "schemaVersion must be 1");
  validateReference(manifest.reference);
  selectReference(manifest, referenceProfile);
  requireValue(
    Array.isArray(manifest.parity) && manifest.parity.length > 0,
    "parity cases are required",
  );
  const ids = new Set();
  for (const entry of manifest.parity) {
    requireValue(
      /^[a-z0-9-]+$/.test(entry.id) && !ids.has(entry.id),
      `invalid or duplicate case id: ${entry.id}`,
    );
    ids.add(entry.id);
    requireValue(
      /^[a-z0-9-]+$/.test(entry.scene) &&
        (entry.kind === "catalog-fixture"
          ? /^[a-z0-9-]+$/.test(entry.fixture)
          : /^[a-z0-9-]+$/.test(entry.state)),
      `${entry.id}: scene and named state or catalog fixture required`,
    );
    requireValue(
      !entry.kind || ["named-scene", "catalog-fixture"].includes(entry.kind),
      `${entry.id}: unknown capture kind`,
    );
    if (entry.captureTarget !== undefined) {
      requireValue(
        typeof entry.captureTarget === "string" &&
          entry.captureTarget.length > 0 &&
          (entry.kind !== "catalog-fixture" ||
            (entry.id === "fields-select-placeholder" &&
              entry.scene === "fields" &&
              entry.fixture === "field-state-matrix" &&
              entry.captureTarget === '[data-field-preview="select-empty-placeholder"]' &&
              entry.cellContract?.selector === "[data-field-preview]" &&
              entry.cellContract.count === 240)),
        `${entry.id}: crop must identify a named-scene target or the reviewed Select placeholder in the complete 240-cell fields matrix`,
      );
    }
    if (entry.expectedStateCount !== undefined)
      requireValue(
        entry.kind !== "catalog-fixture" &&
          Number.isInteger(entry.expectedStateCount) &&
          entry.expectedStateCount > 0,
        `${entry.id}: sampled named scenes require a reviewed source state count`,
      );
    if (entry.captureContent !== undefined)
      requireValue(
        entry.captureTarget &&
          typeof entry.captureContent === "string" &&
          entry.captureContent.length > 0,
        `${entry.id}: rendered capture content needs an explicit component crop`,
      );
    if (entry.readinessTimeoutMs !== undefined)
      requireValue(
        entry.scene === "diagram-workbench" && entry.readinessTimeoutMs === 45_000,
        `${entry.id}: only the source diagram workbench declares the longer readiness budget`,
      );
    if (entry.expectedWorkbenchError !== undefined)
      requireValue(
        entry.scene === "diagram-workbench" &&
          entry.expectedStateCount === 94 &&
          entry.expectedWorkbenchError === "mermaid-invalid-source",
        `${entry.id}: only the pinned workbench invalid-source fixture has a diagnostic contract`,
      );
    if (entry.kind === "catalog-fixture") {
      requireValue(
        Array.isArray(entry.renderedStates) &&
          entry.renderedStates.length > 0 &&
          entry.renderedStates.every((value) => /^[a-z0-9-]+$/.test(value)),
        `${entry.id}: catalog rendered-state readiness contract required`,
      );
    }
    if (entry.cellContract !== undefined)
      requireValue(
        entry.kind === "catalog-fixture" &&
          ["[data-field-preview]", "[data-row-preview]"].includes(entry.cellContract.selector) &&
          Number.isInteger(entry.cellContract.count) &&
          entry.cellContract.count > 0,
        `${entry.id}: invalid catalog matrix readiness contract`,
      );
    if (entry.expectedImageUrls !== undefined)
      requireValue(
        entry.scene === "principal-avatar" &&
          entry.kind === "catalog-fixture" &&
          JSON.stringify(entry.expectedImageUrls) ===
            JSON.stringify(["https://avatar.invalid/missing.png"]),
        `${entry.id}: only the reviewed reserved avatar image failure is expected`,
      );
    requireValue(
      ["light", "dark"].includes(entry.theme),
      `${entry.id}: explicit light/dark theme required`,
    );
    requireValue(["reduced", "full"].includes(entry.motion), `${entry.id}: motion required`);
    requireValue(
      Number.isInteger(entry.width) && entry.width >= 240 && entry.width <= 1600,
      `${entry.id}: width must be 240..1600`,
    );
    requireValue(
      Number.isInteger(entry.height) && entry.height >= 240 && entry.height <= 2000,
      `${entry.id}: height must be 240..2000`,
    );
    for (const field of ["referenceSources", "candidateSources"]) {
      requireValue(
        Array.isArray(entry[field]) && entry[field].length > 0 && entry[field].every(sourcePath),
        `${entry.id}: ${field} required`,
      );
    }
    requireValue(
      typeof entry.reason === "string" && entry.reason.length > 0,
      `${entry.id}: named coverage reason required`,
    );
  }
  requireValue(
    manifest.comparison?.maxDiffPixels === 0 && manifest.comparison?.threshold === 0,
    "initial comparison must reject all pixel drift; tolerances need an explicit contract change",
  );
  requireValue(Array.isArray(manifest.uncovered), "uncovered surfaces must be explicit");
  requireValue(
    Array.isArray(manifest.functional) && manifest.functional.length >= 6,
    "functional sources must be mapped",
  );
  requireValue(
    new Set(manifest.functional.map((entry) => entry.component)).size ===
      manifest.functional.length,
    "functional components must be unique",
  );
  const components = new Set(manifest.functional.map((entry) => entry.component));
  requireValue(
    ["button", "input", "checkbox", "switch", "tabs", "dialog"].every((name) =>
      components.has(name),
    ),
    "core controls are missing or duplicated",
  );
  for (const entry of manifest.functional) {
    requireValue(
      entry.route === `/sandbox/${entry.component}` && typeof entry.fixture === "string",
      `${entry.component}: actual catalog route and fixture required`,
    );
    for (const field of ["referenceSources", "candidateSources"]) {
      requireValue(
        Array.isArray(entry[field]) && entry[field].length > 0 && entry[field].every(sourcePath),
        `${entry.component}: ${field} required`,
      );
    }
  }
  return manifest;
}

export function selectedCases(manifest, filter = process.env.PARITY_CASE) {
  if (!filter) return manifest.parity;
  const ids = filter.split(",");
  for (const id of ids) {
    if (!manifest.parity.some((entry) => entry.id === id))
      throw new Error(
        `Unknown parity case ${id}. Available: ${manifest.parity.map((entry) => entry.id).join(", ")}`,
      );
  }
  return manifest.parity.filter((entry) => ids.includes(entry.id));
}

export function endpoint(value, name) {
  if (!value) throw new Error(`${name} is required. See pnpm --filter @intent/view-parity help.`);
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) app root URL without credentials, query, or hash.`);
  }
  return url.href.replace(/\/$/, "");
}
