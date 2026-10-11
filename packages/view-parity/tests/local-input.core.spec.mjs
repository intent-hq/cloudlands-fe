import { test, expect, openExample, outputJson } from "../lib/functional.mjs";
import {
  imageFile,
  putImageOnClipboard,
  downloadBytes,
  recordVideoFile,
} from "../lib/native-files.mjs";

test("local editor: a real paste-chip transaction expands into raw text", async ({ page }) => {
  const example = await openExample(page, "local-editor", "native-editor");
  const text = "Native first line\nNative second line";
  await example.getByLabel("Paste chip text", { exact: true }).fill(text);
  await example.getByRole("button", { name: "Insert paste chip", exact: true }).click();
  await expect
    .poll(async () => outputJson(example.getByLabel("Editor JSON", { exact: true })))
    .toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "pasteChip", attrs: { content: text, lineCount: 2 } }],
        },
      ],
    });
  await expect(example.getByLabel("Editor text", { exact: true })).toHaveText(text);
  await example.getByRole("button", { name: "Expand to raw text", exact: true }).click();
  await expect
    .poll(async () => outputJson(example.getByLabel("Editor JSON", { exact: true })))
    .toMatchObject({ content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  await expect(example.getByRole("button", { name: "Remove pasted text" })).toHaveCount(0);
  await expect(example.getByRole("textbox", { name: "Native TipTap editor" })).toBeFocused();
});

test("local editor: suggestion arrows select a real skill node and return editor focus", async ({
  page,
}) => {
  const example = await openExample(page, "local-editor", "native-editor");
  const filter = example.getByLabel("Filter local skills", { exact: true });
  await filter.focus();
  await filter.press("ArrowUp");
  await expect(example.getByRole("option", { name: /verify/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await filter.press("Enter");
  await expect(example.getByLabel("Selected local skill", { exact: true })).toHaveText("verify");
  await expect
    .poll(async () => outputJson(example.getByLabel("Editor JSON", { exact: true })))
    .toMatchObject({
      content: [
        { type: "paragraph", content: [{ type: "skillCommand", attrs: { name: "verify" } }] },
      ],
    });
  await expect(example.getByRole("listbox")).toHaveCount(0);
  await expect(example.getByRole("textbox", { name: "Native TipTap editor" })).toBeFocused();
});

test("question wizard: a rejected completion preserves choices for a later successful send", async ({
  page,
}) => {
  const example = await openExample(page, "question-wizard", "question-wizard");
  await example.getByRole("switch", { name: "Accept wizard completion" }).click();
  await example.getByRole("radio", { name: /Focused/ }).click();
  await example.getByRole("checkbox", { name: "Navigation", exact: true }).click();
  await example.getByRole("checkbox", { name: "Settings", exact: true }).click();
  await example.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(example.getByLabel("Wizard completion attempts")).toHaveText("1");
  await expect(example.getByLabel("Wizard resolved count")).toHaveText("0");
  await expect(example.getByRole("checkbox", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await example.getByRole("switch", { name: "Accept wizard completion" }).click();
  await example.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(example.getByLabel("Wizard resolved count")).toHaveText("1");
  expect(await outputJson(example.getByLabel("Wizard submitted answers"))).toMatchObject([
    { selectedLabels: ["Focused"], freeText: "", skipped: false },
    { selectedLabels: ["Navigation", "Settings"], freeText: "", skipped: false },
  ]);
});

test("question wizard: native clipboard image bytes reach the submitted answer through FileReader", async ({
  page,
  context,
}) => {
  const example = await openExample(page, "question-wizard", "question-wizard");
  const clipboardBytes = await putImageOnClipboard(page, context);
  const other = example.getByRole("textbox", { name: "Type your own answer" });
  await other.focus();
  await other.press("ControlOrMeta+v");
  await expect(example.getByRole("button", { name: /^View .+ full size$/ })).toHaveCount(1);
  await other.fill("  Use this image  ");
  await other.press("Enter");
  await example.getByRole("checkbox", { name: "Composer", exact: true }).click();
  await example.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(example.getByLabel("Wizard resolved count")).toHaveText("1");
  const answers = await outputJson(example.getByLabel("Wizard submitted answers"));
  expect(answers[0]).toMatchObject({
    selectedLabels: [],
    freeText: "Use this image",
    skipped: false,
    imageBlocks: [{ type: "image", data: clipboardBytes, mimeType: "image/png" }],
  });
  expect(answers[1]).toMatchObject({ selectedLabels: ["Composer"], skipped: false });
  const draft = await outputJson(example.getByLabel("Wizard draft"));
  expect(JSON.stringify(draft)).not.toContain(clipboardBytes);
});

test("collapsible panel: keyboard changes persist and synchronize panels sharing the same key", async ({
  page,
}) => {
  let example = await openExample(page, "collapsible-panel", "collapsible-panel");
  const saved = example.getByRole("button", { name: "Saved panel", exact: true });
  await expect(saved).toHaveAttribute("aria-expanded", "true");
  await saved.focus();
  await saved.press("Enter");
  await expect(
    example.getByRole("button", { name: "Shared preference panel", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("catalog-native-panel")))
    .toBe("true");
  await page.reload();
  example = page.locator('[data-functional-example="collapsible-panel"]');
  await expect(example.getByRole("button", { name: "Saved panel", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await example
    .getByRole("button", { name: "Shared preference panel", exact: true })
    .press("Space");
  await expect(example.getByRole("button", { name: "Saved panel", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("catalog-native-panel")))
    .toBe("false");
});

test("native image: decoded metadata and downloaded bytes describe the selected local file", async ({
  page,
}) => {
  const example = await openExample(page, "image-lightbox", "native-image-lightbox");
  const file = imageFile();
  await example.locator('input[type="file"]').setInputFiles(file);
  const opener = example.getByRole("button", { name: "Open image lightbox" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  const image = dialog.getByRole("img", { name: file.name });
  await expect
    .poll(() => image.evaluate((el) => ({ width: el.naturalWidth, height: el.naturalHeight })))
    .toEqual({ width: 16, height: 10 });
  await dialog.getByRole("button", { name: "Image options", exact: true }).click();
  await expect(page.getByTestId("image-info-dimensions")).toHaveText("16 × 10 px");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(file.name);
  expect(await downloadBytes(download)).toEqual(file.buffer);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("native attachments: same-name files retain separate identities and removal targets one file", async ({
  page,
}) => {
  const example = await openExample(page, "attachment-preview", "native-attachments");
  await example
    .locator('input[type="file"]')
    .setInputFiles([
      imageFile("shared.png"),
      { name: "shared.png", mimeType: "text/plain", buffer: Buffer.from("Distinct local file") },
    ]);
  await expect
    .poll(async () => (await outputJson(example.getByLabel("Local attachment files"))).length)
    .toBe(2);
  const files = await outputJson(example.getByLabel("Local attachment files"));
  expect(new Set(files.map((file) => file.id)).size).toBe(2);
  const preview = example.getByRole("button", { name: "View shared.png full size" });
  await preview.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  await example.getByRole("button", { name: "Remove shared.png", exact: true }).first().click();
  await expect
    .poll(async () => outputJson(example.getByLabel("Local attachment files")))
    .toEqual([files[1]]);
  expect(await outputJson(example.getByLabel("Removed attachment IDs"))).toEqual([files[0].id]);
});

test("native video: real recorded media exposes finite metadata and downloads unchanged bytes", async ({
  page,
}) => {
  const example = await openExample(page, "video-lightbox", "native-video-lightbox");
  const file = await recordVideoFile(page);
  expect(file.buffer.length).toBeGreaterThan(0);
  await example.locator('input[type="file"]').setInputFiles(file);
  const opener = example.getByRole("button", { name: "Open video lightbox" });
  await opener.click();
  const video = page.getByTestId("chat-video-player");
  await expect
    .poll(() => video.evaluate((el) => Number.isFinite(el.duration) && el.duration > 0))
    .toBe(true);
  expect(await video.evaluate((el) => ({ width: el.videoWidth, height: el.videoHeight }))).toEqual({
    width: 64,
    height: 48,
  });
  await page.getByRole("button", { name: "Video options", exact: true }).click();
  await expect(page.getByTestId("video-info-duration")).toBeVisible();
  await expect(page.getByTestId("video-info-dimensions")).toHaveText("64 × 48 px");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(file.name);
  expect(await downloadBytes(download)).toEqual(file.buffer);
  await page.keyboard.press("Escape");
  await expect(video).toBeHidden();
  await expect(opener).toBeFocused();
});
