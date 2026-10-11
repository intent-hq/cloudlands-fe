import { test, expect, openExample, outputJson } from "../lib/functional.mjs";

const output = (fixture, name) => fixture.getByLabel(name, { exact: true });

test("form: native required validation blocks Enter before the real submit handler", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "form-submit");
  const name = fixture.getByRole("textbox", { name: "Project name", exact: true });
  await name.focus();
  await page.keyboard.press("Enter");
  await expect(name).toBeFocused();
  expect(await name.evaluate((input) => input.validity.valueMissing)).toBe(true);
  await expect(output(fixture, "Form submission count")).toHaveText("0");
  await name.fill("Browser project");
  await name.press("Enter");
  await expect(output(fixture, "Form submission count")).toHaveText("1");
  await expect
    .poll(() => outputJson(output(fixture, "Saved project")))
    .toEqual({ name: "Browser project", notes: "" });
});

test("form: native duplicate submit requests share the pending submission", async ({ page }) => {
  const fixture = await openExample(page, "form", "form-submit");
  await fixture.getByRole("textbox", { name: "Project name", exact: true }).fill("Single flight");
  const form = fixture.locator("form");
  // Native HTML calls enter the actual production submit handler before its
  // asynchronous validation settles. No event handler or dependency is replaced.
  await form.evaluate((element) => {
    element.requestSubmit();
    element.requestSubmit();
  });
  await expect(output(fixture, "Form submission count")).toHaveText("1");
  await expect(form).not.toHaveAttribute("aria-busy", "true");
  await fixture.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(output(fixture, "Form submission count")).toHaveText("2");
});

test("form: Enter inserts a multiline break and modified Enter submits the draft", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "form-submit");
  await fixture
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Multiline project");
  const notes = fixture.getByRole("textbox", { name: "Project notes", exact: true });
  await notes.focus();
  await page.keyboard.type("First line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  await expect(output(fixture, "Form submission count")).toHaveText("0");
  await notes.press("ControlOrMeta+Enter");
  await expect(output(fixture, "Form submission count")).toHaveText("1");
  await expect
    .poll(() => outputJson(output(fixture, "Saved project")))
    .toEqual({ name: "Multiline project", notes: "First line\nSecond line" });
});

test("form: custom validation retains edits; reset clears dirty state and errors", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "form-submit");
  const name = fixture.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("ab");
  await fixture.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(output(fixture, "Form dirty")).toHaveText("true");
  await expect(output(fixture, "Form submission count")).toHaveText("0");
  expect(Object.keys(await outputJson(output(fixture, "Form validation errors")))).toEqual([
    "name",
  ]);
  await expect(name).toHaveValue("ab");
  const reset = fixture.getByRole("button", { name: "Reset form", exact: true });
  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(name).toHaveValue("");
  await expect(output(fixture, "Form dirty")).toHaveText("false");
  await expect.poll(() => outputJson(output(fixture, "Form validation errors"))).toEqual({});
  await expect(output(fixture, "Form submission count")).toHaveText("0");
});

test("autosave: typing a burst saves the prepared value once after debounce", async ({ page }) => {
  const fixture = await openExample(page, "form", "autosave");
  const field = fixture.getByRole("textbox", { name: "Autosave workspace name", exact: true });
  await field.fill("  Draft");
  await field.press("End");
  await page.keyboard.type(" workspace  ");
  await expect(output(fixture, "Autosave status")).toHaveText("unsaved");
  await expect(output(fixture, "Autosave count")).toHaveText("0");
  await expect(output(fixture, "Saved workspace name")).toHaveText("Draft workspace");
  await expect(output(fixture, "Autosave count")).toHaveText("1");
  // The committed value is trimmed, but acknowledgement must not replace a focused draft.
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("  Draft workspace  ");
});

for (const trigger of ["blur", "shortcut"]) {
  test(`autosave: ${trigger} commits the pending draft without a later duplicate save`, async ({
    page,
  }) => {
    const fixture = await openExample(page, "form", "autosave");
    const field = fixture.getByRole("textbox", { name: "Autosave workspace name", exact: true });
    await field.fill(`Committed by ${trigger}`);
    if (trigger === "blur")
      await fixture.getByRole("button", { name: "Leave autosave field", exact: true }).click();
    else await field.press("ControlOrMeta+s");
    await expect(output(fixture, "Saved workspace name")).toHaveText(`Committed by ${trigger}`);
    await expect(output(fixture, "Autosave count")).toHaveText("1");
    // Wait on the real saved-status lifecycle, beyond the cleared debounce timer.
    await expect(output(fixture, "Autosave status")).toHaveText("idle");
    await expect(output(fixture, "Autosave count")).toHaveText("1");
  });
}

function collection(page, fixture) {
  const list = fixture.getByRole("listbox", { name: "Interactive collection", exact: true });
  const row = (name) =>
    list
      .getByRole("option")
      .filter({ has: page.getByRole("textbox", { name: `Edit ${name}`, exact: true }) });
  return { list, row };
}

test("collection: arrows, Home, End and typeahead move focus; Space changes selection", async ({
  page,
}) => {
  const fixture = await openExample(page, "collection", "collection-selection");
  const { row } = collection(page, fixture);
  await row("Alpha").focus();
  await page.keyboard.press("ArrowDown");
  await expect(row("Beta")).toBeFocused();
  await page.keyboard.press("End");
  await expect(row("Bravo")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(row("Alpha")).toBeFocused();
  await page.keyboard.type("br");
  await expect(row("Bravo")).toBeFocused();
  await expect
    .poll(() => outputJson(output(fixture, "Selected collection keys")))
    .toEqual(["beta", "bravo"]);
  await page.keyboard.press("Space");
  await expect(row("Bravo")).toHaveAttribute("aria-selected", "false");
  await expect
    .poll(() => outputJson(output(fixture, "Selected collection keys")))
    .toEqual(["beta"]);
  await expect(output(fixture, "Activated collection key")).toHaveText("bravo");
  await page.keyboard.press("Enter");
  await expect(row("Bravo")).toHaveAttribute("aria-selected", "true");
});

test("collection: nested text and button interactions do not select or activate the row", async ({
  page,
}) => {
  const fixture = await openExample(page, "collection", "collection-selection");
  const input = fixture.getByRole("textbox", { name: "Edit Alpha", exact: true });
  await input.click();
  await page.keyboard.type("bravo draft");
  await input.press("Home");
  await input.press("ArrowRight");
  await expect(input).toBeFocused();
  const action = fixture.getByRole("button", { name: "Act on Alpha", exact: true });
  await action.click();
  await expect(output(fixture, "Collection action count")).toHaveText("1");
  await action.press("Enter");
  await expect(output(fixture, "Collection action count")).toHaveText("2");
  await expect(output(fixture, "Activated collection key")).toHaveText("none");
  await expect
    .poll(() => outputJson(output(fixture, "Selected collection keys")))
    .toEqual(["beta", "bravo"]);
});

test("confirm: real service promises settle false on Escape and true on acceptance, restoring focus", async ({
  page,
}) => {
  const fixture = await openExample(page, "confirm", "confirmation-flow");
  const trigger = fixture.getByRole("button", { name: "Confirm archive", exact: true });
  const result = output(fixture, "Confirmation service result");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Archive workspace", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(result).toHaveText("false");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(result).toHaveText("true");
  await expect(trigger).toBeFocused();
});

test("prompt: required input blocks empty acceptance and resolves the edited, trimmed value", async ({
  page,
}) => {
  const fixture = await openExample(page, "confirm", "confirmation-flow");
  const trigger = fixture.getByRole("button", { name: "Prompt for name", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Rename workspace", exact: true });
  const input = dialog.getByRole("textbox", { name: "Workspace name", exact: true });
  await expect(input).toBeFocused();
  await input.fill("   ");
  await expect(dialog.getByRole("button", { name: "Rename", exact: true })).toBeDisabled();
  await input.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(output(fixture, "Confirmation service result")).toHaveText("none");
  await input.fill("  Renamed by browser  ");
  await input.press("Enter");
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => outputJson(output(fixture, "Confirmation service result")))
    .toBe("Renamed by browser");
  await expect(trigger).toBeFocused();
});

test("form: pending completion disables editing and rejects repeated native submits", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "form-submit");
  const name = fixture.getByRole("textbox", { name: "Project name", exact: true });
  await fixture.getByRole("switch", { name: "Hold form submission", exact: true }).click();
  await name.fill("Held project");
  await name.press("Enter");
  await expect(output(fixture, "Form submission status")).toHaveText("pending");
  await expect(output(fixture, "Form hook submitting")).toHaveText("true");
  await expect(name).toBeDisabled();
  const form = fixture.getByRole("form", { name: "Project submission form", exact: true });
  await expect(form).toHaveAttribute("aria-busy", "true");
  await form.evaluate((element) => {
    element.requestSubmit();
    element.requestSubmit();
  });
  await expect(output(fixture, "Form submission attempts")).toHaveText("1");
  await expect(output(fixture, "Form submission count")).toHaveText("0");
  await fixture.getByRole("button", { name: "Release form submission", exact: true }).click();
  await expect(output(fixture, "Form submission count")).toHaveText("1");
  await expect(output(fixture, "Form hook submitting")).toHaveText("false");
  await expect(form).not.toHaveAttribute("aria-busy", "true");
  await expect(name).toBeEnabled();
  await expect
    .poll(() => outputJson(output(fixture, "Saved project")))
    .toEqual({ name: "Held project", notes: "" });
});

test("form: rejected submission restores editing, preserves the draft, and permits a retry", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "form-submit");
  const name = fixture.getByRole("textbox", { name: "Project name", exact: true });
  const hold = fixture.getByRole("switch", { name: "Hold form submission", exact: true });
  await hold.click();
  await name.fill("Retry this project");
  await name.press("Enter");
  await expect(output(fixture, "Form submission status")).toHaveText("pending");
  await fixture.getByRole("button", { name: "Reject form submission", exact: true }).click();
  await expect(output(fixture, "Form submission status")).toHaveText("rejected");
  await expect(output(fixture, "Form submission error")).not.toBeEmpty();
  await expect(output(fixture, "Form hook submitting")).toHaveText("false");
  await expect(output(fixture, "Form submission count")).toHaveText("0");
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue("Retry this project");
  await expect(output(fixture, "Form dirty")).toHaveText("true");
  await hold.click();
  await name.press("Enter");
  await expect(output(fixture, "Form submission attempts")).toHaveText("2");
  await expect(output(fixture, "Form submission count")).toHaveText("1");
  await expect(output(fixture, "Form submission error")).toBeEmpty();
});

for (const [policy, key] of [
  ["Ignore Enter", "Enter"],
  ["Ignore modified Enter", "ControlOrMeta+Enter"],
]) {
  test(`form: ${policy} prevents keyboard submission but leaves explicit submission usable`, async ({
    page,
  }) => {
    const fixture = await openExample(page, "form", "form-submit");
    await fixture.getByRole("switch", { name: policy, exact: true }).click();
    const name = fixture.getByRole("textbox", { name: "Project name", exact: true });
    await name.fill("Explicit submission");
    await name.press(key);
    await expect(output(fixture, "Form submission attempts")).toHaveText("0");
    await fixture.getByRole("button", { name: "Save project", exact: true }).click();
    await expect(output(fixture, "Form submission count")).toHaveText("1");
  });
}

test("autosave: an independent external update preserves a focused unsaved draft", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "autosave");
  const field = fixture.getByRole("textbox", { name: "Autosave workspace name", exact: true });
  await field.fill("Local draft survives");
  await fixture.getByRole("button", { name: "Update autosave externally", exact: true }).click();
  await expect(output(fixture, "Autosave external updates")).toHaveText("1");
  await expect(output(fixture, "Saved workspace name")).not.toHaveText("Workspace");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Local draft survives");
  await field.press("ControlOrMeta+s");
  await expect(output(fixture, "Saved workspace name")).toHaveText("Local draft survives");
  await expect(output(fixture, "Autosave count")).toHaveText("1");
});

test("form: a caller keyboard handler owns modified Enter without accidental submission", async ({
  page,
}) => {
  const fixture = await openExample(page, "form", "form-keyboard-override");
  const notes = fixture.getByRole("textbox", { name: "Override notes", exact: true });
  await notes.fill("Caller handles keys");
  await notes.press("ControlOrMeta+Enter");
  await expect
    .poll(() => outputJson(output(fixture, "Override key callbacks")))
    .toContain("Mod+Enter");
  await expect(output(fixture, "Override submission count")).toHaveText("0");
  await fixture.getByRole("button", { name: "Submit override form", exact: true }).click();
  await expect(output(fixture, "Override submission count")).toHaveText("1");
});
