import { test, expect, openFixture } from "../lib/functional.mjs";

test("slider: discrete readout commits the nearest step, clamps bounds, and Escape cancels edits", async ({
  page,
}) => {
  const fixture = await openFixture(page, "slider", "slider-state-matrix");
  const slider = fixture.getByRole("slider", { name: "Catalog stepped volume", exact: true });
  await fixture.getByRole("button", { name: "40%", exact: true }).click();
  const editor = fixture.getByRole("spinbutton", { name: "Catalog stepped volume", exact: true });
  await editor.fill("73");
  await editor.press("Enter");
  await expect(slider).toHaveAttribute("aria-valuenow", "70");
  await fixture.getByRole("button", { name: "70%", exact: true }).click();
  await editor.fill("10");
  await editor.press("Escape");
  await expect(slider).toHaveAttribute("aria-valuenow", "70");
  await fixture.getByRole("button", { name: "70%", exact: true }).click();
  await editor.fill("150");
  await editor.press("Enter");
  await expect(slider).toHaveAttribute("aria-valuenow", "100");
});

test("slider: a real pointer drag updates the controlled value", async ({ page }) => {
  const fixture = await openFixture(page, "slider", "slider-state-matrix");
  const slider = fixture.getByRole("slider", { name: "Catalog volume", exact: true });
  await slider.scrollIntoViewIfNeeded();
  await slider.focus();
  await slider.press("Home");
  const bounds = await slider.boundingBox();
  expect(bounds, "The visible native slider needs a pointer target").not.toBeNull();
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await fixture.getByLabel("Catalog slider value", { exact: true }).textContent()),
    )
    .toBeGreaterThan(50);
});

test("menu: submenu keyboard navigation returns focus and skips disabled commands", async ({
  page,
}) => {
  const fixture = await openFixture(page, "menu", "menu-command-states");
  const trigger = fixture.getByRole("button", { name: "Open catalog menu", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const attach = page.getByRole("menuitem", { name: /Attach files/ });
  await attach.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Show panel", exact: true }),
  ).toBeFocused();
  const more = page.getByRole("menuitem", { name: "More actions", exact: true });
  await more.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitem", { name: "Archive", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(more).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("sheet: disabled close remains inert while Escape dismisses and restores focus", async ({
  page,
}) => {
  const fixture = await openFixture(page, "sheet", "sheet-state-matrix");
  const trigger = fixture.getByRole("button", {
    name: "Open left sheet with disabled close",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Left sheet", exact: true });
  await expect(dialog.getByRole("button", { name: /close/i })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
