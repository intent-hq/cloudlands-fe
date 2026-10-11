import { test as base, expect, openFixture } from "./functional.mjs";
import { observeErrors, assertImageFailureEvidence } from "./browser.mjs";

const expectedImageUrls = ["https://avatar.invalid/missing.png"];

export const test = base.extend({
  browserErrors: [
    async ({ page }, use, testInfo) => {
      const resourceEvents = [];
      const errors = observeErrors(page, { expectedImageUrls, resourceEvents });
      await use(errors);
      await testInfo.attach("native-avatar-image-failures.json", {
        body: JSON.stringify({ errors, resourceEvents }, null, 2),
        contentType: "application/json",
      });
      assertImageFailureEvidence(resourceEvents);
      expect(errors).toEqual([]);
      expect(
        resourceEvents.some(
          (event) =>
            event.kind === "response" ||
            (event.kind === "requestfailed" && !event.error?.includes("ERR_ABORTED")),
        ),
        "Candidate fallback must follow an actual failed image request",
      ).toBe(true);
    },
    { auto: true },
  ],
});

export async function openAvatarFixture(page, fixtureId) {
  const fixture = await openFixture(page, "principal-avatar", fixtureId);
  await fixture.scrollIntoViewIfNeeded();
  await expect(fixture.locator('img[src="https://avatar.invalid/missing.png"]')).toHaveCount(0);
  return fixture;
}
