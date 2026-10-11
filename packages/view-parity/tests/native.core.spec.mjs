import {
  test,
  expect,
  openExample,
  openFixture,
  openPreview,
  outputJson,
} from "../lib/functional.mjs";

test("notification: progress updates and completion retain one notification identity", async ({
  page,
}) => {
  const example = await openExample(page, "notify", "notify");
  await example.getByRole("button", { name: "Loading", exact: true }).click();
  await expect(page.getByText("Live loading toast", { exact: true })).toBeVisible();
  const id = await example.getByTestId("notify-progress-id").textContent();
  expect(id).not.toBe("");
  await example.getByRole("button", { name: "Update progress", exact: true }).click();
  await expect(page.getByText("Progress updated", { exact: true })).toBeVisible();
  await expect(page.getByText("Live loading toast", { exact: true })).toHaveCount(0);
  await example.getByRole("button", { name: "Complete progress", exact: true }).click();
  await expect(page.getByText("Progress complete", { exact: true })).toBeVisible();
  await expect(example.getByTestId("notify-progress-id")).toHaveText(id);
  await example.getByRole("button", { name: "Dismiss progress", exact: true }).click();
  await expect(page.getByText("Progress complete", { exact: true })).toBeHidden();
});

test("notification: keyed replacement updates the existing visible notification", async ({
  page,
}) => {
  const example = await openExample(page, "notify", "notify");
  await example.getByRole("button", { name: "Start keyed notification" }).click();
  await expect(page.getByText("Keyed first message", { exact: true })).toBeVisible();
  await example.getByRole("button", { name: "Replace keyed notification" }).click();
  const ids = await outputJson(example.getByTestId("notify-keyed-ids"));
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(page.getByText("Keyed first message", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Keyed replacement message", { exact: true })).toHaveCount(1);
  await example.getByRole("button", { name: "Clear live toasts" }).click();
  await expect(page.getByText("Keyed replacement message", { exact: true })).toBeHidden();
});

test("notification: failure retry and close route to the actual caller", async ({ page }) => {
  const example = await openExample(page, "notify", "notify");
  await example.getByRole("button", { name: "Agent failure", exact: true }).click();
  await page.getByRole("button", { name: "Retry Implementor", exact: true }).click();
  await expect(example.getByTestId("notify-events")).toHaveText("retry");
  await page
    .locator("[data-sonner-toast]")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(example.getByTestId("notify-events")).toContainText("failure-close");
  await expect(page.getByText("Live failure toast", { exact: true })).toBeHidden();
});

test("toast action: native keyboard activation settles the source fixture callback", async ({
  page,
}) => {
  const preview = await openPreview(page, "toast-header", "standard");
  const action = preview.getByRole("button", { name: "Review", exact: true });
  await action.focus();
  await action.press("Enter");
  await expect(preview.getByTestId("toast-header-actions")).toHaveText("1");
  await expect(action).toBeHidden();
});

test("notification: detailed error copies actual diagnostic text through the native clipboard", async ({
  page,
  context,
}) => {
  const example = await openExample(page, "notify", "notify");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await example.getByRole("button", { name: "Detailed error", exact: true }).click();
  await page
    .locator("[data-sonner-toast] summary")
    .filter({ hasText: "Technical details" })
    .click();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Diagnostic details from catalog");
});

test("content header: editing selects the title, Enter saves once, and Escape cancels", async ({
  page,
}) => {
  const fixture = await openFixture(page, "content-header", "interaction-example");
  await fixture.getByRole("button", { name: "Preview implementation plan", exact: true }).click();
  const input = fixture.getByRole("textbox");
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(
    "Preview implementation plan",
  );
  await input.fill("  Browser review  ");
  await input.press("Enter");
  await expect(fixture.getByTestId("header-title")).toHaveText("Browser review");
  await expect(fixture.getByTestId("header-events")).toHaveText("title");
  await fixture.getByRole("button", { name: "Browser review", exact: true }).click();
  await input.fill("Discard this");
  await input.press("Escape");
  await fixture.getByRole("button", { name: "Header action", exact: true }).click();
  await expect(fixture.getByTestId("header-title")).toHaveText("Browser review");
  await expect(fixture.getByTestId("header-events")).toHaveText("title,action");
});

test("panel wrapper: caller close hides the content and reopening restores the edited title", async ({
  page,
}) => {
  const fixture = await openFixture(page, "panel-wrapper", "interaction-example");
  await fixture.getByRole("button", { name: "Preview implementation plan", exact: true }).click();
  await fixture.getByRole("textbox").fill("Retained title");
  await fixture.getByRole("textbox").press("Enter");
  await fixture.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(fixture.getByText("Panel content", { exact: true })).toBeHidden();
  await fixture.getByRole("button", { name: "Open header", exact: true }).click();
  await expect(fixture.getByText("Panel content", { exact: true })).toBeVisible();
  await expect(fixture.getByRole("button", { name: "Retained title", exact: true })).toBeVisible();
  await expect(fixture.getByTestId("header-events")).toHaveText("title,close");
});

test("zoom media: keyboard zoom/reset and copy forwarding preserve close focus", async ({
  page,
}) => {
  const example = await openExample(page, "zoom-pan-viewport", "zoom-media");
  const opener = example.getByRole("button", { name: "Open zoom media", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Zoom media preview", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("+");
  await expect
    .poll(async () => Number(await example.getByLabel("Media zoom scale").textContent()))
    .toBeGreaterThan(1);
  await page.keyboard.press("0");
  await expect(example.getByLabel("Media zoom scale")).toHaveText("1");
  await page.keyboard.press("ControlOrMeta+c");
  await expect(example.getByLabel("Media copy events")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
