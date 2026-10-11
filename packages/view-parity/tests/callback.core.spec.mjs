import { test, expect, openExample } from "../lib/functional.mjs";

test("textarea callback: raw length gates saving before whitespace is trimmed", async ({
  page,
}) => {
  const example = await openExample(page, "settings-textarea", "textarea-consumers");
  const field = example.getByTestId("callback-autosave-setting").getByRole("textbox");
  await field.fill(`${" ".repeat(79)}ok`);
  await field.press("ControlOrMeta+s");
  await field.press("Tab");
  await expect(example.getByLabel("Autosave callback attempts", { exact: true })).toHaveText("0");
  await expect(example.getByLabel("Autosave current value", { exact: true })).toHaveText(
    "Original prompt",
  );
  await field.fill(`${" ".repeat(78)}ok`);
  await field.press("ControlOrMeta+s");
  await expect(example.getByLabel("Autosave callback completed", { exact: true })).toHaveText("ok");
  await expect(example.getByLabel("Autosave callback attempts", { exact: true })).toHaveText("1");
  await expect(example.getByLabel("Autosave current value", { exact: true })).toHaveText("ok");
});

test("JSON import callback: invalid shapes stay local and valid input preserves exact bytes", async ({
  page,
}) => {
  const example = await openExample(page, "settings-textarea", "textarea-consumers");
  const importer = example.getByTestId("callback-json-import-setting");
  const field = importer.getByRole("textbox");
  const submit = importer.getByRole("button", { name: "Import Servers", exact: true });
  for (const [value, message] of [
    ["  ", /Please paste/],
    ["{", /Invalid JSON/],
    ["[]", /Expected an object/],
    ["{}", /No server configurations/],
  ]) {
    await field.fill(value);
    await submit.click();
    await expect(importer.getByText(message)).toBeVisible();
    await expect(example.getByLabel("Import callback attempts", { exact: true })).toHaveText("0");
  }
  const raw = '  {\n  "local-server": {"command": "node", "args": ["server.js"]}\n}\n';
  await field.fill(raw);
  await submit.click();
  await expect(example.getByLabel("Import callback status", { exact: true })).toHaveText(
    "completed",
  );
  expect(await example.getByLabel("Import callback received", { exact: true }).textContent()).toBe(
    raw,
  );
  expect(await example.getByLabel("Import callback completed", { exact: true }).textContent()).toBe(
    raw,
  );
  await expect(example.getByLabel("Import callback attempts", { exact: true })).toHaveText("1");
});

test("replace callback: Enter edits the instruction and modified Enter sends its untrimmed bytes once", async ({
  page,
}) => {
  const example = await openExample(page, "modal-heading-spacing", "replace-agent-callback");
  await example.getByRole("button", { name: "Open replace agent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Replace this agent?", exact: true });
  const disclosure = dialog.getByRole("button", { name: "Hand-off instruction", exact: true });
  await disclosure.focus();
  await disclosure.press("Enter");
  const field = dialog.getByRole("textbox", { name: "Hand-off instruction", exact: true });
  await field.fill("  Preserve this handoff  ");
  await field.press("End");
  await field.press("Enter");
  await expect(field).toHaveValue("  Preserve this handoff  \n");
  await expect(example.getByLabel("Replacement send count", { exact: true })).toHaveText("0");
  const raw = "  Preserve this handoff  \nSecond instruction\n  ";
  await field.fill(raw);
  await field.press("ControlOrMeta+Enter");
  await expect(dialog).toHaveCount(0);
  await expect(example.getByLabel("Replacement send count", { exact: true })).toHaveText("1");
  await expect(example.getByLabel("Replacement cancelled count", { exact: true })).toHaveText("0");
  expect(
    await example.getByLabel("Replacement sent instruction", { exact: true }).textContent(),
  ).toBe(raw);
});

test("replace callback: a whitespace-only instruction cannot send and Cancel reports cancellation", async ({
  page,
}) => {
  const example = await openExample(page, "modal-heading-spacing", "replace-agent-callback");
  const launcher = example.getByRole("button", { name: "Open replace agent", exact: true });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Replace this agent?", exact: true });
  await dialog.getByRole("button", { name: "Hand-off instruction", exact: true }).click();
  const field = dialog.getByRole("textbox", { name: "Hand-off instruction", exact: true });
  await field.fill(" \n\t ");
  await expect(dialog.getByRole("button", { name: "Request handoff", exact: true })).toBeDisabled();
  await field.press("ControlOrMeta+Enter");
  await expect(dialog).toBeVisible();
  await expect(example.getByLabel("Replacement send count", { exact: true })).toHaveText("0");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(example.getByLabel("Replacement cancelled count", { exact: true })).toHaveText("1");
  await expect(launcher).toBeFocused();
});
