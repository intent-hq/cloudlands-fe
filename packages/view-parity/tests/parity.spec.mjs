import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadManifest, selectedCases, endpoint, repoRoot } from "../lib/manifest.mjs";
import { verifyReference, candidateProvenance, changedSources } from "../lib/provenance.mjs";
import {
  openScene,
  observeErrors,
  stableScreenshot,
  captureSelector,
  openCatalogFixture,
  assertImageFailureEvidence,
} from "../lib/browser.mjs";
import { compareImages } from "../lib/compare.mjs";
import { inspectWorkbenchError } from "../lib/workbench-error.mjs";

const manifest = loadManifest();

for (const entry of selectedCases(manifest)) {
  test(`${entry.id}: ${entry.reason}`, async ({ browser }, testInfo) => {
    const referenceUrl = endpoint(process.env.PARITY_REFERENCE_URL, "PARITY_REFERENCE_URL");
    const candidateUrl = endpoint(process.env.PARITY_CANDIDATE_URL, "PARITY_CANDIDATE_URL");
    const referenceRoot = process.env.PARITY_REFERENCE_ROOT;
    const before = verifyReference(referenceRoot, manifest.reference);
    const candidateBefore = candidateProvenance(process.env.PARITY_CANDIDATE_ROOT || repoRoot);
    const options = {
      viewport: { width: entry.width, height: entry.height },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: entry.theme,
      reducedMotion: entry.motion === "reduced" ? "reduce" : "no-preference",
    };
    const referenceContext = await browser.newContext(options);
    const candidateContext = await browser.newContext(options);
    try {
      const reference = await referenceContext.newPage();
      const candidate = await candidateContext.newPage();
      const referenceResourceEvents = [];
      const candidateResourceEvents = [];
      const referenceConsoleDiagnostics = [];
      const candidateConsoleDiagnostics = [];
      const referenceErrors = await observeErrors(reference, {
        expectedImageUrls: entry.expectedImageUrls,
        resourceEvents: referenceResourceEvents,
        consoleDiagnostics: entry.expectedWorkbenchError ? referenceConsoleDiagnostics : undefined,
      });
      const candidateErrors = await observeErrors(candidate, {
        expectedImageUrls: entry.expectedImageUrls,
        resourceEvents: candidateResourceEvents,
        consoleDiagnostics: entry.expectedWorkbenchError ? candidateConsoleDiagnostics : undefined,
      });
      const open = entry.kind === "catalog-fixture" ? openCatalogFixture : openScene;
      // Retain ready-state images even when an error fixture logs a real failure.
      // The observed browser errors still fail the final assertions below.
      const [referenceState, candidateState] = await Promise.all([
        open(reference, referenceUrl, entry),
        open(candidate, candidateUrl, entry),
      ]);
      const checkedStates =
        entry.kind !== "catalog-fixture"
          ? entry.expectedStateCount
            ? referenceState.availableStates.toSorted()
            : [
                ...new Set(
                  manifest.parity
                    .filter((item) => item.scene === entry.scene && item.kind !== "catalog-fixture")
                    .map((item) => item.state),
                ),
              ].sort()
          : undefined;
      // Retain every attempt and its context, including attempts that fail before stability.
      const captures = await Promise.allSettled(
        [
          ["reference", reference],
          ["candidate", candidate],
        ].map(([side, page]) =>
          stableScreenshot(page, entry, async ({ png, ...attempt }) => {
            const name = `${side}-attempt-${attempt.attempt}.png`;
            if (png) {
              const file = testInfo.outputPath(name);
              await writeFile(file, png);
              await testInfo.attach(name, { path: file, contentType: "image/png" });
            }
            await testInfo.attach(`${side}-attempt-${attempt.attempt}.json`, {
              body: JSON.stringify(
                {
                  url: page.url(),
                  ...attempt,
                  image: png
                    ? { name, sha256: createHash("sha256").update(png).digest("hex") }
                    : null,
                },
                null,
                2,
              ),
              contentType: "application/json",
            });
          }),
        ),
      );
      const failed = captures.find((result) => result.status === "rejected");
      if (failed) {
        await testInfo.attach("capture-errors.json", {
          body: JSON.stringify({ reference: referenceErrors, candidate: candidateErrors }, null, 2),
          contentType: "application/json",
        });
        throw failed.reason;
      }
      const [referencePng, candidatePng] = captures.map((result) => result.value);
      const [referenceAria, candidateAria] = await Promise.all([
        reference.locator(captureSelector(entry)).ariaSnapshot(),
        candidate.locator(captureSelector(entry)).ariaSnapshot(),
      ]);
      const { diff, ...comparison } = compareImages(referencePng, candidatePng);
      const after = verifyReference(referenceRoot, manifest.reference);
      const candidateAfter = candidateProvenance(process.env.PARITY_CANDIDATE_ROOT || repoRoot);
      const consoleDiagnostics = {
        reference: await Promise.all(referenceConsoleDiagnostics),
        candidate: await Promise.all(candidateConsoleDiagnostics),
      };
      const metadata = {
        capturedAt: new Date().toISOString(),
        case: entry,
        checkedStates,
        browser: {
          version: browser.version(),
          platform: process.platform,
          arch: process.arch,
          context: options,
        },
        reference: {
          ...before,
          ...referenceState,
          serverCheckoutAssociation: "operator-declared; the reference API has no commit endpoint",
        },
        candidate: { ...candidateBefore, ...candidateState },
        sourceVerification: {
          referenceAfter: after,
          candidateAfter,
          changedCandidatePaths: changedSources(candidateBefore, candidateAfter),
        },
        comparison,
        geometry: {
          reference: await reference.locator(captureSelector(entry)).boundingBox(),
          candidate: await candidate.locator(captureSelector(entry)).boundingBox(),
        },
        accessibility: {
          reference: referenceAria,
          candidate: candidateAria,
          match: referenceAria === candidateAria,
        },
        images: {
          referenceSha256: createHash("sha256").update(referencePng).digest("hex"),
          candidateSha256: createHash("sha256").update(candidatePng).digest("hex"),
        },
        errors: { reference: referenceErrors, candidate: candidateErrors },
        consoleDiagnostics,
        expectedImageFailureEvidence: {
          reference: referenceResourceEvents,
          candidate: candidateResourceEvents,
        },
      };
      for (const [name, buffer, contentType] of [
        ["reference.png", referencePng, "image/png"],
        ["candidate.png", candidatePng, "image/png"],
        ["diff.png", diff, "image/png"],
        ["comparison.json", Buffer.from(JSON.stringify(metadata, null, 2)), "application/json"],
      ]) {
        const file = testInfo.outputPath(name);
        await writeFile(file, buffer);
        await testInfo.attach(name, { path: file, contentType });
      }
      // Exercise the negative fixture only after preserving the selected graph's
      // pixels, geometry and accessibility. Keep every raw error in comparison.json.
      let expectedReferenceError;
      let expectedCandidateError;
      if (entry.expectedWorkbenchError) {
        [expectedReferenceError, expectedCandidateError] = await Promise.all([
          inspectWorkbenchError(reference, referenceErrors, consoleDiagnostics.reference),
          inspectWorkbenchError(candidate, candidateErrors, consoleDiagnostics.candidate),
        ]);
        await testInfo.attach("workbench-invalid-source.json", {
          body: JSON.stringify(
            { reference: expectedReferenceError, candidate: expectedCandidateError },
            null,
            2,
          ),
          contentType: "application/json",
        });
      }
      expect(after.sourceTreeSha256, "Reference sources changed while capturing").toBe(
        before.sourceTreeSha256,
      );
      expect(
        candidateAfter.sourceTreeSha256,
        "Candidate sources changed while capturing; rerun after edits settle",
      ).toBe(candidateBefore.sourceTreeSha256);
      // Keep the actual ready state's artifacts even when the wider scene is incomplete.
      // Missing/extra states still fail; matching pixels cannot override this contract.
      if (checkedStates) {
        if (entry.expectedStateCount)
          expect
            .soft(
              referenceState.availableStates,
              "The independently served source scene must expose its reviewed state count",
            )
            .toHaveLength(entry.expectedStateCount);
        expect
          .soft(
            referenceState.availableStates.toSorted(),
            "Reference named states changed: review missing or extra manifest cases",
          )
          .toEqual(checkedStates);
        expect
          .soft(
            candidateState.availableStates.toSorted(),
            "Candidate does not implement the checked named-state contract",
          )
          .toEqual(checkedStates);
      }
      expect
        .soft(
          referenceErrors.filter((_, index) => index !== expectedReferenceError?.consumedIndex),
          "Unexpected reference browser errors",
        )
        .toEqual([]);
      expect
        .soft(
          candidateErrors.filter((_, index) => index !== expectedCandidateError?.consumedIndex),
          "Unexpected candidate browser errors",
        )
        .toEqual([]);
      assertImageFailureEvidence(referenceResourceEvents);
      assertImageFailureEvidence(candidateResourceEvents);
      expect
        .soft(candidateAria, "Accessible state differs; inspect comparison.json")
        .toBe(referenceAria);
      expect(
        comparison.pass,
        `Visual drift in ${entry.id}: ${comparison.diffPixels} changed pixels; dimensions ${JSON.stringify(comparison.reference)} → ${JSON.stringify(comparison.candidate)}. Inspect reference.png, candidate.png and diff.png; no baseline was updated.`,
      ).toBe(true);
    } catch (error) {
      for (const [side, context] of [
        ["reference", referenceContext],
        ["candidate", candidateContext],
      ]) {
        const page = context.pages()[0];
        if (!page || page.isClosed()) continue;
        const evidence = await page.screenshot({ timeout: 3_000 }).catch(() => null);
        if (evidence)
          await testInfo.attach(`${side}-failure.png`, {
            body: evidence,
            contentType: "image/png",
          });
      }
      throw error;
    } finally {
      await Promise.all([referenceContext.close(), candidateContext.close()]);
    }
  });
}
