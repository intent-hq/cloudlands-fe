import { test, expect, openFixture } from "../lib/functional.mjs";

test("button: Enter and Space each invoke the real action once", async ({ page }) => {
  const fixture = await openFixture(page, "button", "interaction-states");
  const primary = fixture.getByRole("button", { name: "1. Primary", exact: true });
  const count = fixture.getByLabel("Button click count", { exact: true });
  const status = fixture.getByLabel("Button action status", { exact: true });
  const initialStatus = await status.textContent();
  await primary.focus();
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1");
  await expect(status).not.toHaveText(initialStatus);
  await page.keyboard.press("Space");
  await expect(count).toHaveText("2");
});

test("checkbox: Space changes checked state and a second press restores it", async ({ page }) => {
  const fixture = await openFixture(page, "checkbox", "checkbox-state-matrix");
  const checkbox = fixture.getByRole("checkbox", { name: "Catalog checkbox", exact: true });
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expect(
    fixture.getByRole("checkbox", { name: "Disabled checkbox", exact: true }),
  ).toBeDisabled();
});

test("switch: Space toggles the setting and preserves keyboard focus", async ({ page }) => {
  const fixture = await openFixture(page, "switch", "switch-state-matrix");
  const control = fixture.getByRole("switch", { name: "Catalog switch", exact: true });
  await expect(control).not.toBeChecked();
  await control.focus();
  await page.keyboard.press("Space");
  await expect(control).toBeChecked();
  await expect(control).toBeFocused();
  await page.keyboard.press("Space");
  await expect(control).not.toBeChecked();
});

test("input: keyboard editing replaces a selection and survives blur", async ({ page }) => {
  const fixture = await openFixture(page, "input", "input-state-matrix");
  const input = fixture.getByRole("textbox", { name: "Project name", exact: true });
  await input.fill("Migration draft");
  await input.press("End");
  await input.press("Shift+Home");
  await page.keyboard.type("Reviewed project");
  await input.press("Tab");
  await expect(input).toHaveValue("Reviewed project");
  await expect(input).not.toBeFocused();
});

test("tabs: arrow navigation changes the active panel and skips a disabled tab", async ({
  page,
}) => {
  const fixture = await openFixture(page, "tabs", "tabs-state-matrix");
  const tabs = fixture.getByRole("tablist", { name: "Catalog tabs", exact: true });
  const overview = tabs.getByRole("tab", { name: "Overview", exact: true });
  const activity = tabs.getByRole("tab", { name: "Activity", exact: true });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(activity).toBeFocused();
  await expect(activity).toHaveAttribute("aria-selected", "true");
  await expect(fixture.getByRole("tabpanel", { name: "Activity", exact: true })).toBeVisible();
  await expect(fixture.getByRole("tabpanel", { name: "Overview", exact: true })).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute("aria-selected", "true");
});

test("dialog: keyboard opening, editing and Escape restore focus to the trigger", async ({
  page,
}) => {
  await openFixture(page, "dialog", "dialog-state-matrix");
  // The reference catalog also demonstrates an initially open dialog. Dismiss
  // that actual dialog through the keyboard before exercising the closed fixture.
  const initiallyOpen = page.getByRole("dialog", {
    name: "Catalog dialog open state",
    exact: true,
  });
  await expect(initiallyOpen).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(initiallyOpen).toBeHidden();
  const trigger = page.getByRole("button", { name: "Open catalog dialog", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Catalog dialog", exact: true });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("textbox", { name: "Dialog preview field", exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.type("A real keyboard edit");
  await expect(field).toHaveValue("A real keyboard edit");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
