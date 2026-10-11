import { test, expect, openFixture } from "../lib/functional.mjs";

test("button: disabled and loading controls cannot enter the keyboard tab order", async ({
  page,
}) => {
  const fixture = await openFixture(page, "button", "interaction-states");
  const disabled = fixture.getByRole("button", { name: "Disabled action", exact: true });
  const loading = fixture.getByRole("button", { name: "Loading action", exact: true });
  const active = fixture.getByRole("button", { name: "Active", exact: true });
  await expect(disabled).toBeDisabled();
  await expect(loading).toBeDisabled();
  await active.focus();
  await page.keyboard.press("Tab");
  const add = fixture.getByRole("button", { name: "Add item", exact: true });
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(fixture.getByLabel("Button click count", { exact: true })).toHaveText("1");
});

test("input: a read-only field remains selectable but rejects keyboard edits", async ({ page }) => {
  const fixture = await openFixture(page, "input", "input-state-matrix");
  const input = fixture.getByRole("textbox", { name: "Read-only input", exact: true });
  const original = await input.inputValue();
  await input.focus();
  await input.press("Home");
  await input.press("Shift+End");
  await page.keyboard.type("attempted replacement");
  await expect(input).toHaveValue(original);
  await expect(input).toBeFocused();
});

test("dialog: Tab and Shift+Tab remain inside an open modal", async ({ page }) => {
  await openFixture(page, "dialog", "dialog-state-matrix");
  const dialog = page.getByRole("dialog", { name: "Catalog dialog open state", exact: true });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("textbox", { name: "Open-state dialog field", exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open-state dialog trigger", exact: true }),
  ).toBeFocused();
});
