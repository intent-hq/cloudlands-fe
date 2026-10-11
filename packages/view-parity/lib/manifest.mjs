import { readFileSync } from "node:fs";
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

export function loadManifest() {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "scene-manifest.json"), "utf8"));
  requireValue(manifest.schemaVersion === 1, "schemaVersion must be 1");
  requireValue(
    /^[a-f0-9]{40}$/.test(manifest.reference?.commit),
    "reference.commit must be a full commit SHA",
  );
  requireValue(
    /^[a-f0-9]{64}$/.test(manifest.reference?.sourceTreeSha256),
    "reference.sourceTreeSha256 must be SHA-256",
  );
  requireValue(
    manifest.reference.sourcePaths?.length > 0 && manifest.reference.sourcePaths.every(sourcePath),
    "reference.sourcePaths must be repository-relative",
  );
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
    if (entry.kind === "catalog-fixture") {
      requireValue(
        Array.isArray(entry.renderedStates) &&
          entry.renderedStates.length > 0 &&
          entry.renderedStates.every((value) => /^[a-z0-9-]+$/.test(value)),
        `${entry.id}: catalog rendered-state readiness contract required`,
      );
    }
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
