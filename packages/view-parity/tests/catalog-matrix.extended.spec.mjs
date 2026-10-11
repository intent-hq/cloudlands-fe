import { test, expect, openFixture } from "../lib/functional.mjs";

test("fields matrix: native file selection updates its field and retains filename access", async ({
  page,
}) => {
  const fixture = await openFixture(page, "fields", "field-state-matrix");
  const field = fixture.locator('[data-field-preview="file-input-filled"]');
  await field.locator('input[type="file"]').setInputFiles({
    name: "catalog-evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Native field evidence\n"),
  });
  await expect(field.getByText("catalog-evidence.txt", { exact: true })).toBeVisible();
  expect(
    await field.locator('input[type="file"]').evaluate(async (input) => input.files[0].text()),
  ).toBe("Native field evidence\n");
});

test("fields matrix: zoomed text input remains contained and operable", async ({ page }) => {
  const fixture = await openFixture(page, "fields", "field-state-matrix");
  const field = fixture.locator('[data-field-preview="input-text-zoom-200"]');
  const input = field.getByRole("textbox");
  await input.fill("Long editable content must remain available");
  await input.press("End");
  await expect(input).toBeFocused();
  const bounds = await field.boundingBox();
  const control = await input.boundingBox();
  expect(control.x).toBeGreaterThanOrEqual(bounds.x - 1);
  expect(control.x + control.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  expect(control.y + control.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
});

test("rows matrix: the source static menu dismisses after a keyboard selection", async ({
  page,
}) => {
  const fixture = await openFixture(page, "rows", "row-family-matrix");
  const menu = fixture.locator('[data-row-preview="menu-item-states"]');
  const item = menu.getByRole("menuitem", { name: "Default item", exact: true });
  await item.focus();
  await item.press("End");
  await expect(menu.getByRole("menuitem", { name: "Active item", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("menu")).toHaveCount(0);
});
