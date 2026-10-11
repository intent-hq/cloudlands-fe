import { test, expect, openFixture } from "../lib/functional.mjs";

test("fields matrix: text editing, read-only protection and native required validation", async ({
  page,
}) => {
  const fixture = await openFixture(page, "fields", "field-state-matrix");
  await expect(fixture.locator("[data-field-preview]")).toHaveCount(240);
  const text = fixture.locator('[data-field-preview="input-text-filled"]').getByRole("textbox");
  await text.fill("Locally edited field");
  await text.press("Tab");
  await expect(text).toHaveValue("Locally edited field");
  const readonly = fixture
    .locator('[data-field-preview="input-text-read-only"]')
    .getByRole("textbox");
  await readonly.focus();
  await readonly.press("ControlOrMeta+a");
  await readonly.press("Backspace");
  await expect(readonly).toHaveValue("Alpha");
  await expect(
    fixture.locator('[data-field-preview="input-text-disabled"]').getByRole("textbox"),
  ).toBeDisabled();
  const required = fixture
    .locator('[data-field-preview="input-text-required"]')
    .getByRole("textbox");
  await required.fill("");
  expect(await required.evaluate((input) => input.checkValidity())).toBe(false);
  await required.fill("Required value");
  expect(await required.evaluate((input) => input.checkValidity())).toBe(true);
});

test("fields matrix: composed validation messages remain associated with their controls", async ({
  page,
}) => {
  const fixture = await openFixture(page, "fields", "field-state-matrix");
  const invalid = fixture.locator('[data-field-preview="form-field-invalid"]').getByRole("textbox");
  await invalid.fill("Edit a field while its caller reports an error");
  await expect(invalid).toHaveAttribute("aria-invalid", "true");
  await expect(invalid).toHaveAccessibleDescription(/needs attention/);
  const helper = fixture
    .locator('[data-field-preview="settings-field-row-help-text"]')
    .getByRole("textbox");
  await helper.focus();
  await expect(helper).toHaveAccessibleDescription(/Helpful context/);
  const required = fixture
    .locator('[data-field-preview="form-field-required"]')
    .getByRole("textbox");
  await required.fill("");
  expect(await required.evaluate((input) => input.validity.valueMissing)).toBe(true);
});

test("fields matrix: uncontrolled choice fixtures retain keyboard selection", async ({ page }) => {
  const fixture = await openFixture(page, "fields", "field-state-matrix");
  const checkbox = fixture.locator('[data-field-preview="checkbox-filled"]').getByRole("checkbox");
  await checkbox.focus();
  await checkbox.press("Space");
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  const radios = fixture.locator('[data-field-preview="radio-group-filled"]');
  await radios.getByRole("radio", { name: "Alpha option", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(radios.getByRole("radio", { name: "Beta option", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const readOnly = fixture
    .locator('[data-field-preview="checkbox-read-only"]')
    .getByRole("checkbox");
  await readOnly.focus();
  await readOnly.press("Space");
  await expect(readOnly).toHaveAttribute("aria-checked", "true");
});

async function openRowsAfterMenuDismissal(page) {
  const fixture = await openFixture(page, "rows", "row-family-matrix");
  // The source page starts with a focus-owning static menu. Leave it through
  // its real keyboard dismissal before exercising unrelated row controls.
  const menu = fixture.locator('[data-row-preview="menu-item-states"]').getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.press("Escape");
  await expect(menu).toHaveCount(0);
  return fixture;
}

test("rows matrix: keyboard and pointer selection preserve independent selected rows", async ({
  page,
}) => {
  const fixture = await openRowsAfterMenuDismissal(page);
  await expect(fixture.locator("[data-row-preview]")).toHaveCount(17);
  const list = fixture.getByRole("listbox", { name: "Collection row states" });
  const first = list.getByRole("option", { name: /Default row/ });
  const selected = list.getByRole("option", { name: /Selected row/ });
  const long = list.getByRole("option", { name: /deliberately long/ });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(long).toHaveAttribute("aria-selected", "true");
  await first.focus();
  await first.press("Space");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.press("End");
  await expect(long).toBeFocused();
  await long.press("Home");
  await expect(first).toBeFocused();
  await first.press("s");
  await expect(selected).toBeFocused();
  await selected.click();
  await expect(selected).toHaveAttribute("aria-selected", "false");
  await expect(long).toHaveAttribute("aria-selected", "true");
});

test("rows matrix: sidebar keyboard navigation skips disabled rows", async ({ page }) => {
  const fixture = await openRowsAfterMenuDismissal(page);
  const menu = fixture.locator('[data-row-preview="sidebar-menu-states"]');
  const first = menu.getByRole("button", { name: "Focused navigation", exact: true });
  const last = menu.getByRole("button", { name: /^Unread navigation/ });
  await first.focus();
  await first.press("End");
  await expect(last).toBeFocused();
  await last.press("ArrowDown");
  await expect(first).toBeFocused();
  await expect(
    menu.getByRole("button", { name: "Disabled navigation", exact: true }),
  ).toBeDisabled();
});

test("rows matrix: nested overflow action dismisses and returns focus without selecting a collection row", async ({
  page,
}) => {
  const fixture = await openRowsAfterMenuDismissal(page);
  const trigger = fixture.getByRole("button", { name: "More avatar-row actions", exact: true });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Delete row", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Delete row", exact: true })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(fixture.getByRole("option", { name: /Default row/ })).toHaveAttribute(
    "aria-selected",
    "false",
  );
});

test("rows matrix: tab keyboard changes skip the disabled workspace", async ({ page }) => {
  const fixture = await openRowsAfterMenuDismissal(page);
  const tabs = fixture.getByRole("tablist", { name: "Workspace tabs", exact: true });
  const active = tabs.getByRole("tab", { name: "Active workspace", exact: true });
  const unread = tabs.getByRole("tab", { name: "Unread workspace", exact: true });
  await active.focus();
  await active.press("ArrowRight");
  await expect(unread).toBeFocused();
  await unread.press("Enter");
  await expect(unread).toHaveAttribute("aria-selected", "true");
  await unread.press("ArrowRight");
  await expect(active).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Disabled workspace", exact: true })).toBeDisabled();
});
