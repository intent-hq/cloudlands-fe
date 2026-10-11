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

test("accordion: keyboard selection closes the previous panel and can collapse the active panel", async ({
  page,
}) => {
  const fixture = await openFixture(page, "accordion", "accordion-state-matrix");
  const details = fixture.getByRole("button", { name: "Details", exact: true });
  const history = fixture.getByRole("button", { name: "History", exact: true });
  await details.focus();
  await page.keyboard.press("ArrowDown");
  await expect(history).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(history).toHaveAttribute("aria-expanded", "true");
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(fixture.getByText("Accordion history", { exact: true })).toBeVisible();
  await expect(fixture.getByText("Accordion details", { exact: true })).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(history).toHaveAttribute("aria-expanded", "false");
  await expect(fixture.getByText("Accordion history", { exact: true })).toBeHidden();
});

test("radio group: arrow navigation updates the single selected choice", async ({ page }) => {
  const fixture = await openFixture(page, "radio-group", "radio-group-state-matrix");
  const standard = fixture.getByRole("radio", { name: /^Standard/ });
  const fast = fixture.getByRole("radio", { name: /^Fast/ });
  await standard.focus();
  await page.keyboard.press("ArrowDown");
  await expect(fast).toBeFocused();
  await expect(fast).toBeChecked();
  await expect(standard).not.toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(standard).toBeFocused();
  await expect(standard).toBeChecked();
});

test("checkbox group: arrows move focus without selecting; Space toggles the focused item", async ({
  page,
}) => {
  const fixture = await openFixture(page, "checkbox-group", "checkbox-group-state-matrix");
  const alerts = fixture.getByRole("checkbox", { name: /^Alerts/ });
  const summaries = fixture.getByRole("checkbox", { name: /^Summaries/ });
  const tips = fixture.getByRole("checkbox", { name: /^Tips/ });
  await alerts.focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaries).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tips).toBeFocused();
  await expect(tips).not.toBeChecked();
  await expect(alerts).toBeChecked();
  await expect(summaries).toBeChecked();
  await page.keyboard.press("Space");
  await expect(tips).toBeChecked();
  await page.keyboard.press("Space");
  await expect(tips).not.toBeChecked();
});

test("slider: keyboard bounds and increments reach the real controlled value", async ({ page }) => {
  const fixture = await openFixture(page, "slider", "slider-state-matrix");
  const slider = fixture.getByRole("slider", { name: "Catalog volume", exact: true });
  const value = fixture.getByLabel("Catalog slider value", { exact: true });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(value).toHaveText("0");
  await page.keyboard.press("ArrowRight");
  await expect(value).toHaveText("1");
  await page.keyboard.press("PageUp");
  await expect(value).toHaveText("11");
  await page.keyboard.press("End");
  await expect(value).toHaveText("100");
  await page.keyboard.press("ArrowRight");
  await expect(value).toHaveText("100");
});

test("menu: checked and radio choices update without closing, and Escape restores focus", async ({
  page,
}) => {
  const fixture = await openFixture(page, "menu", "menu-command-states");
  const trigger = fixture.getByRole("button", { name: "Open catalog menu", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const choice = page.getByRole("menuitemcheckbox", { name: "Show panel", exact: true });
  await choice.click();
  await expect(choice).toBeChecked();
  const compact = page.getByRole("menuitemradio", { name: "Compact", exact: true });
  await compact.click();
  await expect(compact).toBeChecked();
  await expect(
    page.getByRole("menuitemradio", { name: "Comfortable", exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(choice).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(choice).toBeChecked();
  await expect(compact).toBeChecked();
});

test("sheet: opening focuses its content and Escape returns to the trigger", async ({ page }) => {
  const fixture = await openFixture(page, "sheet", "sheet-state-matrix");
  const trigger = fixture.getByRole("button", { name: "Open catalog sheet", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Catalog sheet", exact: true });
  const field = dialog.getByRole("textbox", { name: "Sheet preview field", exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.type("Edited in sheet");
  await field.press("Tab");
  await expect(dialog.getByRole("button", { name: /close/i })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
