import { test, expect, openFixture } from "../lib/functional.mjs";

test("toggle: keyboard activation changes pressed state without entering disabled controls", async ({
  page,
}) => {
  const fixture = await openFixture(page, "toggle", "toggle-state-matrix");
  const bold = fixture.getByRole("button", { name: "Bold", exact: true });
  await bold.focus();
  await page.keyboard.press("Space");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  await expect(fixture.getByRole("button", { name: "Pinned", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    fixture.getByRole("button", { name: "Disabled toggle", exact: true }),
  ).not.toBeFocused();
});

test("toggle group: arrows move focus without changing the chosen value; Space selects", async ({
  page,
}) => {
  const fixture = await openFixture(page, "toggle-group", "toggle-group-state-matrix");
  const list = fixture.getByRole("radio", { name: "List view", exact: true });
  const tree = fixture.getByRole("radio", { name: "Tree view", exact: true });
  const value = fixture.getByLabel("Display mode value", { exact: true });
  await list.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tree).toBeFocused();
  await expect(value).toHaveText("list");
  await page.keyboard.press("Space");
  await expect(tree).toBeChecked();
  await expect(value).toHaveText("tree");
  await page.keyboard.press("ArrowRight");
  await expect(list).toBeFocused();
  await page.keyboard.press("Space");
  await expect(value).toHaveText("list");
});
