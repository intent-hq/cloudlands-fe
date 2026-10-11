import { test, expect, openExample, outputJson } from "../lib/functional.mjs";
import { imageFile, putImageOnClipboard } from "../lib/native-files.mjs";

test("local editor: deletion and undo of insertion leave no orphaned chip content", async ({
  page,
}) => {
  let example = await openExample(page, "local-editor", "native-editor");
  await example.getByRole("button", { name: "Insert paste chip", exact: true }).click();
  await example.getByRole("button", { name: "Remove pasted text", exact: true }).click();
  await expect(example.getByLabel("Editor text", { exact: true })).toHaveText("");
  await expect(
    example.getByRole("button", { name: "Remove pasted text", exact: true }),
  ).toHaveCount(0);
  // A fresh editor gives insertion its own undo history. Immediate insert/delete
  // transactions may legitimately share one native history group.
  example = await openExample(page, "local-editor", "native-editor");
  await example.getByRole("button", { name: "Insert paste chip", exact: true }).click();
  await expect(
    example.getByRole("button", { name: "Remove pasted text", exact: true }),
  ).toBeVisible();
  await example.getByRole("button", { name: "Undo editor change", exact: true }).click();
  await expect(example.getByLabel("Editor text", { exact: true })).toHaveText("");
  await expect(
    example.getByRole("button", { name: "Remove pasted text", exact: true }),
  ).toHaveCount(0);
});

test("local editor: error retry and Escape retain native input focus", async ({ page }) => {
  const example = await openExample(page, "local-editor", "native-editor");
  await example.getByRole("button", { name: "Show error prop" }).click();
  await example.getByRole("button", { name: /Retry/ }).click();
  await expect(example.getByLabel("Skill retry requests")).toHaveText("1");
  const input = example.getByLabel("Filter local skills", { exact: true });
  await input.focus();
  await input.press("Escape");
  await expect(example.getByLabel("Skill dismissal count")).toHaveText("1");
  await expect(input).toBeFocused();
  await example.getByRole("button", { name: "Show skill choices" }).click();
  await input.fill("summ");
  await expect(example.getByRole("option")).toHaveCount(1);
  await input.press("Enter");
  await expect(example.getByLabel("Selected local skill")).toHaveText("summarize");
});

test("question wizard: dismiss cancellation and controlled collapse preserve the current draft", async ({
  page,
}) => {
  const example = await openExample(page, "question-wizard", "question-wizard");
  const other = example.getByRole("textbox", { name: "Type your own answer" });
  await other.fill("Preserve my answer");
  await example.getByRole("button", { name: "Dismiss", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Dismiss questions?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(example.getByLabel("Wizard dismissed count")).toHaveText("0");
  await expect(other).toHaveValue("Preserve my answer");
  await example.getByRole("button", { name: "Toggle wizard collapse" }).click();
  await expect(other).toBeHidden();
  await example.getByRole("button", { name: "Toggle wizard collapse" }).click();
  await expect(other).toHaveValue("Preserve my answer");
  const before = await outputJson(example.getByLabel("Wizard draft"));
  await example.getByRole("button", { name: "Focus question", exact: true }).click();
  await expect(example.getByLabel("Wizard focus result")).toHaveText("true");
  expect(await outputJson(example.getByLabel("Wizard draft"))).toEqual(before);
});

test("question wizard: Skip clears native pasted images and text from the final answer", async ({
  page,
  context,
}) => {
  const example = await openExample(page, "question-wizard", "question-wizard");
  await putImageOnClipboard(page, context);
  const other = example.getByRole("textbox", { name: "Type your own answer" });
  await other.focus();
  await other.press("ControlOrMeta+v");
  await expect(example.getByRole("button", { name: /^View .+ full size$/ })).toHaveCount(1);
  await other.fill("This answer is skipped");
  await example.getByRole("button", { name: "Skip", exact: true }).click();
  await example.getByRole("checkbox", { name: "Navigation", exact: true }).click();
  await example.getByRole("button", { name: "Continue", exact: true }).click();
  const answers = await outputJson(example.getByLabel("Wizard submitted answers"));
  expect(answers[0]).toMatchObject({ selectedLabels: [], freeText: "", skipped: true });
  expect(answers[0]).not.toHaveProperty("imageBlocks");
});

test("native image: the first Escape closes its menu and the second restores opener focus", async ({
  page,
}) => {
  const example = await openExample(page, "image-lightbox", "native-image-lightbox");
  await example.locator('input[type="file"]').setInputFiles(imageFile());
  const opener = example.getByRole("button", { name: "Open image lightbox" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  const menuButton = dialog.getByRole("button", { name: "Image options", exact: true });
  await menuButton.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(menuButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(example.getByLabel("image lightbox close count")).toHaveText("1");
});

test("native image: Copy image writes an actual decodable PNG to the clipboard", async ({
  page,
  context,
}) => {
  const example = await openExample(page, "image-lightbox", "native-image-lightbox");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await example.locator('input[type="file"]').setInputFiles(imageFile());
  await example.getByRole("button", { name: "Open image lightbox" }).click();
  await page.getByRole("button", { name: "Image options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Copy image", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        if (!item?.types.includes("image/png")) return null;
        const image = await createImageBitmap(await item.getType("image/png"));
        const dimensions = { width: image.width, height: image.height };
        image.close();
        return dimensions;
      }),
    )
    .toEqual({ width: 16, height: 10 });
});

test("collapsible panel: unmounting and remounting preserves the caller-owned draft", async ({
  page,
}) => {
  const example = await openExample(page, "collapsible-panel", "collapsible-panel");
  await example.getByLabel("Panel draft", { exact: true }).fill("Retained across mount");
  await example.getByRole("button", { name: "Unmount panels" }).click();
  await expect(example.getByLabel("Panel draft", { exact: true })).toHaveCount(0);
  await example.getByRole("button", { name: "Mount panels" }).click();
  await expect(example.getByLabel("Panel draft", { exact: true })).toHaveValue(
    "Retained across mount",
  );
  const local = example.getByRole("button", { name: "Initially collapsed panel" });
  await expect(local).toHaveAttribute("aria-expanded", "false");
  await local.press("Space");
  await expect(example.getByRole("button", { name: "Local panel action" })).toBeVisible();
});
