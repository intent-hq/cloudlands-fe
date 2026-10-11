import { test, expect, openExample, outputJson } from "../lib/functional.mjs";

const output = (fixture, name) => fixture.getByLabel(name, { exact: true });

test("form: externally busy state disables controls and resumes the same draft", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "form-submit");
  const name = fixture.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Preserved while paused");
  const pause = fixture.getByRole("switch", { name: "Pause form editing", exact: true });
  await pause.click();
  await expect(name).toBeDisabled();
  await expect(fixture.getByRole("button", { name: "Save project", exact: true })).toBeDisabled();
  await expect(output(fixture, "Form submission count")).toHaveText("0");
  await pause.click();
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue("Preserved while paused");
  await name.press("Enter");
  await expect(output(fixture, "Form submission count")).toHaveText("1");
});

test("autosave: blank input does not save on blur or shortcut", async ({ page }) => {
  const fixture = await openExample(page, "form", "autosave");
  const field = fixture.getByRole("textbox", { name: "Autosave workspace name", exact: true });
  await field.fill("  ");
  await field.press("ControlOrMeta+s");
  await fixture.getByRole("button", { name: "Leave autosave field", exact: true }).click();
  await expect(output(fixture, "Saved workspace name")).toHaveText("Workspace");
  await expect(output(fixture, "Autosave count")).toHaveText("0");
  await expect(output(fixture, "Autosave status")).toHaveText("unsaved");
});

test("form dialog: Escape cancels once, preserves the draft, and submission resolves once", async ({
  page,
}) => {
  const fixture = await openExample(page, "confirm", "confirmation-flow");
  const trigger = fixture.getByRole("button", { name: "Edit workspace", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Edit workspace", exact: true });
  await dialog
    .getByRole("textbox", { name: "Workspace draft name", exact: true })
    .fill("Kept draft");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(output(fixture, "Confirmation cancelled count")).toHaveText("1");
  await expect(output(fixture, "Confirmation accepted count")).toHaveText("0");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  const field = dialog.getByRole("textbox", { name: "Workspace draft name", exact: true });
  await expect(field).toHaveValue("Kept draft");
  await field.press("ControlOrMeta+Enter");
  await expect(dialog).toBeHidden();
  await expect(output(fixture, "Confirmed workspace name")).toHaveText("Kept draft");
  await expect(output(fixture, "Confirmation accepted count")).toHaveText("1");
  await expect(output(fixture, "Confirmation cancelled count")).toHaveText("1");
  await expect(trigger).toBeFocused();
});

test("prompt: outside dismissal settles null and restores the request trigger", async ({
  page,
}) => {
  const fixture = await openExample(page, "confirm", "confirmation-flow");
  const trigger = fixture.getByRole("button", { name: "Prompt for name", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Rename workspace", exact: true });
  await expect(dialog).toBeVisible();
  // A real click outside the centered dialog exercises the production dismiss layer.
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await expect.poll(() => outputJson(output(fixture, "Confirmation service result"))).toBeNull();
  await expect(trigger).toBeFocused();
});

test("alert: outside clicks preserve the request; acknowledgement settles its promise", async ({
  page,
}) => {
  const fixture = await openExample(page, "confirm", "confirmation-flow");
  const trigger = fixture.getByRole("button", { name: "Show acknowledgement", exact: true });
  await trigger.click();
  const dialog = page.getByRole("alertdialog", { name: "Workspace saved", exact: true });
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await expect(output(fixture, "Confirmation service result")).toHaveText("none");
  await dialog.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(output(fixture, "Confirmation service result")).toHaveText("acknowledged");
  await expect(trigger).toBeFocused();
});

test("takeover: long content scrolls within the body while footer actions remain usable", async ({
  page,
}) => {
  const fixture = await openExample(page, "screen", "takeover");
  await fixture.getByRole("button", { name: "Toggle long content", exact: true }).click();
  const body = fixture.getByTestId("takeover-scroll-region");
  await body.scrollIntoViewIfNeeded();
  const documentScroll = await page.evaluate(() => document.scrollingElement.scrollTop);
  await body.hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(documentScroll);
  const proceed = fixture.getByRole("button", { name: "Continue takeover", exact: true });
  await expect(proceed).toBeInViewport();
  await proceed.click();
  await expect(output(fixture, "Takeover step")).toHaveText("2");
  await fixture.getByRole("button", { name: "Cancel takeover", exact: true }).click();
  await expect(output(fixture, "Takeover cancelled count")).toHaveText("1");
});
