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
} from "../lib/browser.mjs";
import { compareImages } from "../lib/compare.mjs";

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
      const referenceErrors = observeErrors(reference);
      const candidateErrors = observeErrors(candidate);
      const open = entry.kind === "catalog-fixture" ? openCatalogFixture : openScene;
      const [referenceState, candidateState] = await Promise.all([
        open(reference, referenceUrl, entry, referenceErrors),
        open(candidate, candidateUrl, entry, candidateErrors),
      ]);
      if (entry.kind !== "catalog-fixture") {
        const checkedStates = [
          ...new Set(
            manifest.parity
              .filter((item) => item.scene === entry.scene && item.kind !== "catalog-fixture")
              .map((item) => item.state),
          ),
        ].sort();
        expect(
          referenceState.availableStates.toSorted(),
          "Reference named states changed: review missing or extra manifest cases",
        ).toEqual(checkedStates);
        expect(
          candidateState.availableStates.toSorted(),
          "Candidate does not implement the checked named-state contract",
        ).toEqual(checkedStates);
      }
      const [referencePng, candidatePng] = await Promise.all([
        stableScreenshot(reference, entry),
        stableScreenshot(candidate, entry),
      ]);
      const [referenceAria, candidateAria] = await Promise.all([
        reference.locator(captureSelector(entry)).ariaSnapshot(),
        candidate.locator(captureSelector(entry)).ariaSnapshot(),
      ]);
      const { diff, ...comparison } = compareImages(referencePng, candidatePng);
      const after = verifyReference(referenceRoot, manifest.reference);
      const candidateAfter = candidateProvenance(process.env.PARITY_CANDIDATE_ROOT || repoRoot);
      const metadata = {
        capturedAt: new Date().toISOString(),
        case: entry,
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
      expect(after.sourceTreeSha256, "Reference sources changed while capturing").toBe(
        before.sourceTreeSha256,
      );
      expect(
        candidateAfter.sourceTreeSha256,
        "Candidate sources changed while capturing; rerun after edits settle",
      ).toBe(candidateBefore.sourceTreeSha256);
      expect.soft(referenceErrors, "Reference browser errors").toEqual([]);
      expect.soft(candidateErrors, "Candidate browser errors").toEqual([]);
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
