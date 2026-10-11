import { expect } from "../lib/functional.mjs";
import { test, openAvatarFixture } from "../lib/avatar-browser.mjs";

test("presence: failed tile images become initials inside both fixed and filled avatar callers", async ({
  page,
}) => {
  const fixture = await openAvatarFixture(page, "tile-states");
  const fallbacks = fixture.locator("[data-catalog-fail]");
  await expect(fallbacks).toHaveText(["A", "A", "A", "G"]);
  await expect(fallbacks.locator("img")).toHaveCount(0);
});

test("presence: native pointer and keyboard actions retain names after image failure", async ({
  page,
}) => {
  const fixture = await openAvatarFixture(page, "presence-stack-action");
  const ada = fixture.getByRole("button", { name: "Ada Lovelace · online", exact: true });
  const grace = fixture.getByRole("button", { name: "Grace Hopper · online", exact: true });
  const linus = fixture.getByRole("button", { name: "linus · online", exact: true });
  await ada.click();
  await expect(fixture.getByRole("status")).toHaveText("Ada Lovelace selected");
  await grace.focus();
  await grace.press("Enter");
  await expect(fixture.getByRole("status")).toHaveText("Grace Hopper selected");
  await linus.focus();
  await linus.press("Space");
  await expect(fixture.getByRole("status")).toHaveText("linus selected");
  const offline = fixture.getByRole("button", { name: "Cy Offline · offline", exact: true });
  await expect(offline).toHaveAttribute("aria-disabled", "true");
  await offline.focus();
  await expect(offline).toBeFocused();
  await offline.press("Enter");
  await expect(fixture.getByRole("status")).toHaveText("linus selected");
});

test("presence: failed-image viewer remains keyboard named and its tooltip dismisses with Escape", async ({
  page,
}) => {
  const fixture = await openAvatarFixture(page, "note-presence-stack");
  const viewer = fixture.getByRole("button", { name: "linus", exact: true });
  await fixture.getByRole("button", { name: "Ada Lovelace", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(viewer).toBeFocused();
  await expect(page.getByRole("tooltip", { name: "linus", exact: true })).toBeVisible();
  await viewer.press("Escape");
  await expect(page.getByRole("tooltip", { name: "linus", exact: true })).toHaveCount(0);
  await expect(viewer).toBeFocused();
  await expect(viewer).toHaveAccessibleName("linus");
  await expect(fixture.getByRole("button", { name: "Mia Overflow", exact: true })).toHaveCount(0);
  await expect(fixture.getByRole("group")).toHaveAccessibleName(/4/);
});
