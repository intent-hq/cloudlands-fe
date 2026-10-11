#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { loadManifest, selectedCases, packageRoot, repoRoot, endpoint } from "../lib/manifest.mjs";
import {
  assertSourcePointers,
  inspectReference,
  verifyReference,
  candidateProvenance,
  changedSources,
  assertCandidatePointers,
  resolveCandidateRoot,
} from "../lib/provenance.mjs";

const require = createRequire(import.meta.url);
const [mode = "help", ...args] = process.argv.slice(2);
const options = {};
const names = new Set([
  "reference-url",
  "candidate-url",
  "reference-root",
  "candidate-root",
  "artifacts",
  "case",
  "grep",
]);
let output;

try {
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index].replace(/^--/, "");
    if (args[index] === "--list") {
      options.list = true;
      continue;
    }
    if (
      !args[index].startsWith("--") ||
      !names.has(key) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    ) {
      throw new Error(
        `Unknown or incomplete option ${args[index]}. No baseline update mode exists. Run the help script.`,
      );
    }
    options[key] = args[++index];
  }
  if (mode === "help") {
    console.log(await readFile(path.join(packageRoot, "USAGE.txt"), "utf8"));
  } else {
    const manifest = loadManifest();
    const candidateRoot = resolveCandidateRoot(
      options["candidate-root"] || process.env.PARITY_CANDIDATE_ROOT || repoRoot,
    );
    const referenceRoot = path.resolve(
      options["reference-root"] || process.env.PARITY_REFERENCE_ROOT || repoRoot,
    );
    if (mode === "reference") {
      console.log(JSON.stringify(inspectReference(referenceRoot, manifest.reference), null, 2));
      console.log(
        "Inspection only. Review source and named-state changes before manually editing scene-manifest.json. Nothing was updated.",
      );
    } else if (mode === "check") {
      assertSourcePointers(referenceRoot, manifest, candidateRoot);
      selectedCases(manifest, options.case);
      console.log(
        `Manifest valid: ${manifest.parity.length} explicit parity cases, ${manifest.uncovered.length} explicitly uncovered surfaces. Reference source pointers exist at ${manifest.reference.commit}. This does not prove live scene availability or visual parity.`,
      );
    } else if (["parity", "core", "extended"].includes(mode)) {
      const cases = selectedCases(manifest, options.case || process.env.PARITY_CASE);
      if (options.case && mode !== "parity")
        throw new Error(
          "--case only selects parity cases. Core and extended checks have separate fixed contracts.",
        );
      const candidateUrl = options.list
        ? undefined
        : endpoint(
            options["candidate-url"] || process.env.PARITY_CANDIDATE_URL,
            "PARITY_CANDIDATE_URL / --candidate-url",
          );
      const referenceUrl =
        mode !== "parity" || options.list
          ? undefined
          : endpoint(
              options["reference-url"] || process.env.PARITY_REFERENCE_URL,
              "PARITY_REFERENCE_URL / --reference-url",
            );
      if (referenceUrl && referenceUrl === candidateUrl)
        throw new Error("Reference and candidate URLs must be independent endpoints.");
      if (
        mode === "parity" &&
        !options.list &&
        !options["reference-root"] &&
        !process.env.PARITY_REFERENCE_ROOT
      ) {
        throw new Error(
          "--reference-root / PARITY_REFERENCE_ROOT is required: explicitly identify the checkout served by the reference URL.",
        );
      }
      const artifacts = path.resolve(
        options.artifacts ||
          process.env.PARITY_ARTIFACTS ||
          path.join(repoRoot, ".demo-artifacts/view-parity"),
      );
      const relative = path.relative(repoRoot, artifacts);
      if (
        relative !== ".demo-artifacts/view-parity" &&
        !relative.startsWith(`.demo-artifacts/view-parity${path.sep}`)
      ) {
        throw new Error(
          "Evidence must remain under the owning workspace's .demo-artifacts/view-parity.",
        );
      }
      if (candidateRoot !== repoRoot) {
        const fromCandidate = path.relative(candidateRoot, artifacts);
        if (
          fromCandidate === "" ||
          (!fromCandidate.startsWith(`..${path.sep}`) &&
            fromCandidate !== ".." &&
            !path.isAbsolute(fromCandidate))
        )
          throw new Error("Evidence cannot be written inside the isolated candidate checkout.");
      }
      await mkdir(artifacts, { recursive: true });
      output = await mkdtemp(
        path.join(artifacts, `${new Date().toISOString().replaceAll(":", "-")}-${mode}-`),
      );
      console.log(`Evidence: ${output}`);
      let reference;
      if (mode === "parity" && !options.list) {
        assertSourcePointers(referenceRoot, manifest, candidateRoot);
        reference = verifyReference(referenceRoot, manifest.reference);
      }
      assertCandidatePointers(candidateRoot, manifest);
      const candidate = candidateProvenance(candidateRoot);
      const session = {
        startedAt: new Date().toISOString(),
        mode,
        listOnly: Boolean(options.list),
        grep: options.grep || process.env.PARITY_GREP,
        referenceUrl,
        candidateUrl,
        reference,
        candidate,
        harnessRoot: repoRoot,
        serverCheckoutAssociation: "operator-declared for both URLs; no server attestation",
        selectedCases: mode === "parity" ? cases.map((entry) => entry.id) : undefined,
        uncovered: manifest.uncovered,
        manifest,
      };
      await writeFile(path.join(output, "session.json"), JSON.stringify(session, null, 2));
      const playwright = path.join(
        path.dirname(require.resolve("@playwright/test/package.json")),
        "cli.js",
      );
      const child = spawn(
        process.execPath,
        [
          playwright,
          "test",
          "--config",
          path.join(packageRoot, "playwright.config.mjs"),
          "--project",
          mode,
          ...(options.grep || process.env.PARITY_GREP
            ? ["--grep", options.grep || process.env.PARITY_GREP]
            : []),
          ...(options.list ? ["--list"] : []),
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            PARITY_RUN_DIR: output,
            PARITY_REFERENCE_ROOT: referenceRoot,
            PARITY_CANDIDATE_ROOT: candidateRoot,
            PARITY_REFERENCE_URL: referenceUrl || "",
            PARITY_CANDIDATE_URL: candidateUrl || "",
            PARITY_CASE: options.case || process.env.PARITY_CASE || "",
          },
          stdio: "inherit",
        },
      );
      const forward = () => child.kill("SIGINT");
      process.once("SIGINT", forward);
      process.once("SIGTERM", forward);
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve(signal ? 130 : (code ?? 1)));
      });
      process.removeListener("SIGINT", forward);
      process.removeListener("SIGTERM", forward);
      let drift;
      let candidateAfter;
      let referenceAfter;
      let changedCandidatePaths = [];
      if (!options.list) {
        try {
          candidateAfter = candidateProvenance(candidateRoot);
          if (reference) referenceAfter = verifyReference(referenceRoot, manifest.reference);
          changedCandidatePaths = changedSources(candidate, candidateAfter);
          if (candidateAfter.sourceTreeSha256 !== candidate.sourceTreeSha256)
            throw new Error(
              "Candidate sources changed during this run. Rerun when editing settles.",
            );
        } catch (error) {
          drift = error.message;
        }
      }
      const exitCode = drift ? 1 : code;
      await writeFile(
        path.join(output, "completion.json"),
        JSON.stringify(
          {
            completedAt: new Date().toISOString(),
            exitCode,
            sourceDrift: drift,
            changedCandidatePaths,
            candidateAfter,
            referenceAfter,
          },
          null,
          2,
        ),
      );
      if (drift) console.error(drift);
      console.log(`Finished ${mode} with exit ${exitCode}. Evidence: ${output}`);
      process.exitCode = exitCode;
    } else {
      throw new Error(
        `Unknown mode ${mode}. Use help, check, reference, parity, core, or extended.`,
      );
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`view-parity: ${message}`);
  if (output)
    await writeFile(
      path.join(output, "failure.json"),
      JSON.stringify({ at: new Date().toISOString(), error: message }, null, 2),
    );
  process.exitCode = 1;
}
