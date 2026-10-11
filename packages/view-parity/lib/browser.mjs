import { expect } from "@playwright/test";

export const frameSelector = '[data-testid="catalog-scene-focus"]';

export function sceneUrl(baseUrl, entry) {
  const url = new URL(`${baseUrl}/sandbox/${encodeURIComponent(entry.scene)}`);
  for (const [key, value] of Object.entries({
    state: entry.state,
    width: entry.width,
    theme: entry.theme,
    motion: entry.motion,
    fit: "component",
  })) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

export function observeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return errors;
}

export async function openScene(page, baseUrl, entry, errors = []) {
  const url = sceneUrl(baseUrl, entry);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (!response?.ok())
      throw new Error(`Scene document returned HTTP ${response?.status() ?? "no response"}.`);
    await page.waitForFunction(() => Boolean(window.__INTENT_PREVIEW__), undefined, {
      timeout: 15_000,
    });
    const available = await page.evaluate(async ({ scene }) => {
      const api = window.__INTENT_PREVIEW__;
      const states = await Promise.race([
        api.states(scene),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`State discovery timed out for ${scene}`)), 5_000),
        ),
      ]);
      return { scenes: api.list(), states };
    }, entry);
    if (!available.scenes.includes(entry.scene))
      throw new Error(
        `Missing scene ${entry.scene}. Available: ${available.scenes.join(", ") || "(none)"}.`,
      );
    if (!available.states.includes(entry.state))
      throw new Error(
        `Missing state ${entry.scene}/${entry.state}. Available: ${available.states.join(", ") || "(none)"}. Fixture fallbacks do not count as named cases.`,
      );
    await page
      .locator('[data-preview-ready="true"][data-preview-stable="true"]')
      .waitFor({ timeout: 15_000 });
    await expect(page.locator(frameSelector), "exactly one capture frame").toHaveCount(1);
    const current = await page.evaluate(() => window.__INTENT_PREVIEW__.current());
    expect(current, `Wrong active scene at ${url}`).toMatchObject({
      slug: entry.scene,
      state: entry.state,
      width: entry.width,
      status: "ready",
      fit: "component",
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    if (errors.length) throw new Error(errors.join("\n"));
    return { url: page.url(), requestedUrl: url, current, availableStates: available.states };
  } catch (error) {
    throw new Error(
      `Scene ${entry.scene}/${entry.state} failed readiness at ${url}: ${error.message}${errors.length ? `\nBrowser errors:\n${errors.join("\n")}` : ""}`,
    );
  }
}

export async function stableScreenshot(page) {
  const frame = page.locator(frameSelector);
  let previous;
  // Repeated real captures detect moving content without injecting CSS or freezing clocks.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.locator('[data-preview-ready="true"][data-preview-stable="true"]').waitFor();
    const png = await frame.screenshot({
      animations: "allow",
      caret: "hide",
      scale: "css",
      timeout: 5_000,
    });
    if (previous?.equals(png)) return png;
    previous = png;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  throw new Error(
    "Capture never produced two identical frames. The scene is still moving; no baseline was accepted.",
  );
}
