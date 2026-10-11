import { expect } from "../lib/functional.mjs";
import { test, openAvatarFixture } from "../lib/avatar-browser.mjs";

test("presence: decorative avatars add no keyboard stops between action and note stacks", async ({
  page,
}) => {
  const decorative = await openAvatarFixture(page, "presence-stack-decorative");
  const actions = page.locator('[data-catalog-fixture-id="presence-stack-action"]');
  const notes = page.locator('[data-catalog-fixture-id="note-presence-stack"]');
  const lastAction = actions.getByRole("button", { name: "Cy Offline · offline", exact: true });
  await lastAction.focus();
  await lastAction.press("Tab");
  await expect(notes.getByRole("button", { name: "Ada Lovelace", exact: true })).toBeFocused();
  await expect(decorative.getByRole("button")).toHaveCount(0);
});
