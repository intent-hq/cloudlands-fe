import { test as base, expect } from "@playwright/test";
import { endpoint, repoRoot } from "./manifest.mjs";
import { candidateProvenance, changedSources } from "./provenance.mjs";
import { observeErrors } from "./browser.mjs";

export const test = base.extend({
  sourceProvenance: [
    async ({ browserName }, use, testInfo) => {
      const root = process.env.PARITY_CANDIDATE_ROOT || repoRoot;
      const before = candidateProvenance(root);
      await use();
      const after = candidateProvenance(root);
      const changedCandidatePaths = changedSources(before, after);
      await testInfo.attach("candidate-provenance.json", {
        body: JSON.stringify({ browserName, before, after, changedCandidatePaths }, null, 2),
        contentType: "application/json",
      });
      expect(changedCandidatePaths, "Candidate sources changed during this journey").toEqual([]);
    },
    { auto: true },
  ],
  browserErrors: [
    async ({ page }, use, testInfo) => {
      const errors = observeErrors(page);
      await use(errors);
      await testInfo.attach("browser-errors.json", {
        body: JSON.stringify(errors, null, 2),
        contentType: "application/json",
      });
      expect(errors, "The real candidate page must not report runtime or resource errors").toEqual(
        [],
      );
    },
    { auto: true },
  ],
});
export { expect };

export async function openFixture(page, component, fixtureId) {
  const baseUrl = endpoint(process.env.PARITY_CANDIDATE_URL, "PARITY_CANDIDATE_URL");
  const url = new URL(`${baseUrl}/sandbox/${component}`);
  url.searchParams.set("theme", "light");
  url.searchParams.set("motion", "reduced");
  url.searchParams.set("width", "420");
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Cannot load real catalog fixture ${url}`).toBe(true);
  const fixture = page.locator(`[data-catalog-fixture-id="${fixtureId}"]`);
  await expect(
    fixture,
    `Missing real ${component} fixture ${fixtureId}; an unported placeholder is not coverage`,
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    fixture.locator("[data-catalog-unimplemented]"),
    "Partial fixtures are not coverage",
  ).toHaveCount(0);
  return fixture;
}

export async function openExample(page, component, exampleId) {
  const baseUrl = endpoint(process.env.PARITY_CANDIDATE_URL, "PARITY_CANDIDATE_URL");
  const url = new URL(`${baseUrl}/sandbox/${component}`);
  url.searchParams.set("example", "interactive");
  url.searchParams.set("theme", "light");
  url.searchParams.set("motion", "reduced");
  url.searchParams.set("width", "420");
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Cannot load actual interactive example ${url}`).toBe(true);
  const example = page.locator(`[data-functional-example="${exampleId}"]`);
  await expect(example, "An unavailable pattern must fail, never silently skip").toBeVisible({
    timeout: 15_000,
  });
  await expect(
    example.locator("[data-catalog-unimplemented]"),
    "Partial examples are not coverage",
  ).toHaveCount(0);
  return example;
}

export async function outputJson(locator) {
  return JSON.parse(await locator.textContent());
}
