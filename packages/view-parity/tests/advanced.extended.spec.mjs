import { test, expect, openFixture, openExample, openPreview } from "../lib/functional.mjs";

test("select navigation: Home and End select the first and last real options", async ({ page }) => {
  const fixture = await openPreview(page, "select-focus", "inline");
  const trigger = fixture.getByRole("combobox", { name: "Choose fruit", exact: true });
  for (const [key, value, label] of [
    ["End", "cherry", "A very long cherry option label used to verify truncation"],
    ["Home", "apple", "Apple"],
  ]) {
    await trigger.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Apple", exact: true })).toBeVisible();
    await page.keyboard.press(key);
    await page.keyboard.press("Enter");
    await expect(fixture.getByTestId("select-value")).toHaveText(value);
    await expect(trigger).toHaveText(label);
    await expect(trigger).toBeFocused();
  }
});

for (const [edge, arrow, value] of [
  ["End", "ArrowDown", "apple"],
  ["Home", "ArrowUp", "cherry"],
]) {
  test(`select navigation: ${arrow} wraps from ${edge} before Enter`, async ({ page }) => {
    const fixture = await openPreview(page, "select-focus", "inline");
    const trigger = fixture.getByRole("combobox", { name: "Choose fruit", exact: true });
    await trigger.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Apple", exact: true })).toBeVisible();
    await page.keyboard.press(edge);
    await page.keyboard.press(arrow);
    await page.keyboard.press("Enter");
    await expect(fixture.getByTestId("select-value")).toHaveText(value);
    await expect(trigger).toBeFocused();
  });
}

test("composer history: Arrow Down restores the draft after browsing earlier messages", async ({
  page,
}) => {
  const fixture = await openFixture(page, "message-composer", "basic");
  const field = fixture.getByRole("textbox");
  await field.fill("Unsaved browser draft");
  await field.press("ArrowUp");
  await expect(field).toHaveValue("Summarize the open tasks");
  await field.press("ArrowUp");
  await expect(field).toHaveValue("Review the architecture");
  await field.press("ArrowDown");
  await field.press("ArrowDown");
  await expect(field).toHaveValue("Unsaved browser draft");
});

test("composer queue: keyboard edit restores text and files, and Delete removes a different row", async ({
  page,
}) => {
  const fixture = await openFixture(page, "message-composer", "queued-messages");
  await fixture
    .getByRole("button", { name: "Then identify the main risks", exact: true })
    .press("F2");
  await expect(fixture.getByRole("textbox")).toHaveValue("Then identify the main risks");
  await expect(fixture.getByRole("textbox")).toBeFocused();
  await expect(
    fixture.getByRole("button", { name: "Then identify the main risks", exact: true }),
  ).toHaveCount(0);
  await expect(fixture.getByText("workspace-map.png", { exact: true })).toBeVisible();
  await fixture
    .getByRole("button", { name: "Summarize the implementation plan", exact: true })
    .press("Delete");
  await expect(
    fixture.getByRole("button", { name: "Summarize the implementation plan", exact: true }),
  ).toHaveCount(0);
  await expect(fixture.getByRole("textbox")).toHaveValue("Then identify the main risks");
});

test("editable name: outside blur commits once, empty edits do not overwrite, disabled stays closed", async ({
  page,
}) => {
  const example = await openExample(page, "editable-name", "editable-name");
  await example.getByRole("button", { name: "Workspace name", exact: true }).click();
  await example.getByRole("textbox").fill("Saved on blur");
  await example.getByRole("switch", { name: "Disable name editing" }).click();
  await expect(example.getByLabel("Name save count")).toHaveText("1");
  await expect(example.getByRole("button", { name: "Saved on blur", exact: true })).toBeDisabled();
  await expect(example.getByRole("textbox")).toHaveCount(0);
  await example.getByRole("switch", { name: "Disable name editing" }).click();
  await example.getByRole("button", { name: "Saved on blur", exact: true }).click();
  await example.getByRole("textbox").fill("   ");
  await example.getByRole("textbox").press("Enter");
  await expect(example.getByLabel("Saved editable name")).toHaveText("Saved on blur");
  await expect(example.getByLabel("Name save count")).toHaveText("1");
});

test("hover surface: caller opens retained content, action works, and close restores focus", async ({
  page,
}) => {
  const example = await openExample(page, "hover-card", "hover-card");
  const trigger = example.getByRole("button", { name: "Toggle hover surface" });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Hover surface action" }).click();
  await expect(example.getByLabel("Hover surface actions")).toHaveText("1");
  await page.getByRole("button", { name: "Close hover surface" }).click();
  await expect(page.getByRole("button", { name: "Hover surface action" })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("scroll area: real vertical and horizontal thumb drags move overflowing content", async ({
  page,
}) => {
  const example = await openExample(page, "scroll-area", "scroll-area");
  const fixture = example.getByTestId("overflow-area");
  const viewport = fixture.locator('[data-slot="scroll-area-viewport"]').first();
  await viewport.scrollIntoViewIfNeeded();
  const before = await viewport.evaluate((node) => ({
    top: node.scrollTop,
    left: node.scrollLeft,
  }));
  for (const orientation of ["vertical", "horizontal"]) {
    const bar = fixture
      .locator(`[data-slot="scroll-area-scrollbar"][data-orientation="${orientation}"]`)
      .first();
    const thumb = bar.locator('[data-slot="scroll-area-thumb"]');
    const box = await thumb.boundingBox();
    const track = await bar.boundingBox();
    expect(box, `The ${orientation} overflow thumb must have a pointer target`).not.toBeNull();
    expect(track).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      orientation === "horizontal" ? track.x + track.width - 2 : box.x + box.width / 2,
      orientation === "vertical" ? track.y + track.height - 2 : box.y + box.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(() =>
        viewport.evaluate(
          (node, axis) => (axis === "vertical" ? node.scrollTop : node.scrollLeft),
          orientation,
        ),
      )
      .toBeGreaterThan(orientation === "vertical" ? before.top : before.left);
  }
});

test("rich tooltip: controlled close settles once and disabled replacement restores description", async ({
  page,
}) => {
  const example = await openExample(page, "tooltip-rich", "tooltip-forwarding");
  await example.getByRole("button", { name: "Open rich tooltip", exact: true }).click();
  await page.getByRole("button", { name: "Tooltip action", exact: true }).click();
  await expect(example.getByLabel("Rich tooltip actions", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Close tooltip", exact: true }).click();
  await expect(example.getByLabel("Rich tooltip open", { exact: true })).toHaveText("false");
  await expect(example.getByLabel("Rich tooltip closes", { exact: true })).toHaveText("1");
  await example.getByRole("button", { name: "Replace tooltip control", exact: true }).click();
  const replacement = example.getByRole("button", {
    name: "Replacement tooltip control",
    exact: true,
  });
  await replacement.focus();
  await expect(example.getByLabel("Rich tooltip open", { exact: true })).toHaveText("true");
  await example.getByRole("switch", { name: "Disable rich tooltip", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tooltip action", exact: true })).toBeHidden();
  await expect(replacement).toHaveAccessibleDescription(
    "The original control description remains available.",
  );
});

test("public tooltip: keep-open click preserves native toggle and disabling closes the surface", async ({
  page,
}) => {
  const example = await openExample(page, "tooltip", "tooltip-public");
  const control = example.getByRole("button", { name: "Public tooltip control", exact: true });
  await example.getByRole("switch", { name: "Keep public tooltip open on click" }).click();
  await control.focus();
  await control.press("Space");
  await expect(example.getByLabel("Public tooltip pressed")).toHaveText("true");
  await expect(example.getByLabel("Public tooltip child clicks")).toHaveText("1");
  await expect(example.getByLabel("Public tooltip wrapper clicks")).toHaveText("1");
  await expect(example.getByLabel("Public tooltip open", { exact: true })).toHaveText("true");
  await example.getByRole("switch", { name: "Disable public tooltip" }).click();
  await expect(example.getByLabel("Public tooltip open", { exact: true })).toHaveText("false");
  await expect(control).toHaveAccessibleDescription(
    "The original public control description remains available.",
  );
  const alternate = example.getByRole("button", { name: "Alternate shortcut trigger" });
  await alternate.focus();
  await expect(alternate).toHaveAccessibleDescription(/Open navigation/);
  await alternate.press("Escape");
  await expect(alternate).toBeFocused();
  await expect(alternate).not.toHaveAccessibleDescription(/Open navigation/);
});
