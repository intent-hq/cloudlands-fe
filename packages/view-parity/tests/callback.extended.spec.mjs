import { test, expect, openExample } from "../lib/functional.mjs";

test("JSON import callback: pending keyboard reentry follows source behavior and Cancel stays usable", async ({
  page,
}) => {
  const example = await openExample(page, "settings-textarea", "textarea-consumers");
  await example.getByRole("switch", { name: "Hold Import callback", exact: true }).click();
  const importer = example.getByTestId("callback-json-import-setting");
  const field = importer.getByRole("textbox");
  const raw = '{"pending-server":{"command":"node"}}';
  await field.fill(raw);
  await importer.getByRole("button", { name: "Import Servers", exact: true }).click();
  await expect(example.getByLabel("Import callback status", { exact: true })).toHaveText("pending");
  await expect(importer.getByRole("button", { name: "Importing...", exact: true })).toBeDisabled();
  await expect(field).toBeEnabled();
  await field.press("ControlOrMeta+Enter");
  await expect(example.getByLabel("Import callback attempts", { exact: true })).toHaveText("2");
  await importer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(example.getByLabel("Import cancelled count", { exact: true })).toHaveText("1");
  await expect(example.getByLabel("Import callback status", { exact: true })).toHaveText("pending");
  await example.getByRole("button", { name: "Resolve Import callback", exact: true }).click();
  await expect(example.getByLabel("Import callback completed", { exact: true })).toHaveText(raw);
  await expect(importer.getByRole("button", { name: "Import Servers", exact: true })).toBeEnabled();
});

test("JSON import callback: caller rejection keeps the raw draft available for retry", async ({
  page,
}) => {
  const example = await openExample(page, "settings-textarea", "textarea-consumers");
  const hold = example.getByRole("switch", { name: "Hold Import callback", exact: true });
  await hold.click();
  const importer = example.getByTestId("callback-json-import-setting");
  const field = importer.getByRole("textbox");
  const raw = ' {\n "retry-server": {"command":"node"}\n } ';
  await field.fill(raw);
  await field.press("ControlOrMeta+Enter");
  await expect(example.getByLabel("Import callback status", { exact: true })).toHaveText("pending");
  await example.getByRole("button", { name: "Reject Import callback", exact: true }).click();
  await expect(example.getByLabel("Import callback status", { exact: true })).toHaveText(
    "rejected",
  );
  await expect(importer.getByText("Caller rejected this callback", { exact: true })).toBeVisible();
  await expect(field).toHaveValue(raw);
  await hold.click();
  await importer.getByRole("button", { name: "Import Servers", exact: true }).click();
  await expect(example.getByLabel("Import callback status", { exact: true })).toHaveText(
    "completed",
  );
  expect(await example.getByLabel("Import callback completed", { exact: true }).textContent()).toBe(
    raw,
  );
  await expect(example.getByLabel("Import callback attempts", { exact: true })).toHaveText("2");
  await expect(importer.getByText("Caller rejected this callback", { exact: true })).toHaveCount(0);
});

test("replace callback: Escape cancels and a caller remount builds a fresh instruction snapshot", async ({
  page,
}) => {
  const example = await openExample(page, "modal-heading-spacing", "replace-agent-callback");
  const launcher = example.getByRole("button", { name: "Open replace agent", exact: true });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Replace this agent?", exact: true });
  await dialog.getByRole("button", { name: "Hand-off instruction", exact: true }).click();
  const field = dialog.getByRole("textbox", { name: "Hand-off instruction", exact: true });
  await field.fill("Discard this local edit on the caller's next remount");
  await field.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(example.getByLabel("Replacement cancelled count", { exact: true })).toHaveText("1");
  await expect(launcher).toBeFocused();
  await example
    .getByLabel("Replacement agent name", { exact: true })
    .fill("New verification agent");
  await example.getByLabel("Replacement specialist", { exact: true }).fill("verifier");
  await launcher.click();
  await dialog.getByRole("button", { name: "Hand-off instruction", exact: true }).click();
  await expect(field).toHaveValue(/New verification agent/);
  await expect(field).toHaveValue(/verifier/);
  await expect(field).not.toHaveValue(/Discard this local edit/);
  await expect(example.getByLabel("Replacement send count", { exact: true })).toHaveText("0");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(example.getByLabel("Replacement cancelled count", { exact: true })).toHaveText("2");
});
