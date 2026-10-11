import { expect } from "@playwright/test";

const frameSelector = '[data-testid="catalog-scene-focus"]';

function sceneUrl(baseUrl, entry) {
  const url = new URL(`${baseUrl}/sandbox/${encodeURIComponent(entry.scene)}`);
  for (const [key, value] of Object.entries({
    state: entry.state,
    width: entry.width,
    theme: entry.theme,
    motion: entry.motion,
    fit: entry.kind === "catalog-fixture" ? undefined : "component",
  })) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.href;
}

export function observeErrors(page, { expectedImageUrls = [], resourceEvents = [] } = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const url = message.location().url;
    if (expectedImageUrls.includes(url) && message.text().startsWith("Failed to load resource:")) {
      resourceEvents.push({ kind: "console", url, message: message.text() });
    } else errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.resourceType() === "image" && expectedImageUrls.includes(request.url()))
      resourceEvents.push({
        kind: "requestfailed",
        url: request.url(),
        error: request.failure()?.errorText,
      });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (response.request().resourceType() === "image" && expectedImageUrls.includes(response.url()))
      resourceEvents.push({ kind: "response", url: response.url(), status: response.status() });
    else errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return errors;
}

export function assertImageFailureEvidence(resourceEvents) {
  for (const event of resourceEvents.filter((item) => item.kind === "console")) {
    expect(
      resourceEvents.some(
        (item) => item.url === event.url && ["requestfailed", "response"].includes(item.kind),
      ),
      `Expected image console failure lacks a matching native image request: ${event.url}`,
    ).toBe(true);
  }
}

export async function openScene(page, baseUrl, entry, errors = []) {
  const url = sceneUrl(baseUrl, entry);
  const readinessTimeoutMs = entry.readinessTimeoutMs ?? 15_000;
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
      .waitFor({ timeout: readinessTimeoutMs });
    await expect(page.locator(frameSelector), "exactly one capture frame").toHaveCount(1);
    await expect(
      page
        .locator(frameSelector)
        .locator('[data-catalog-unimplemented], [data-catalog-coverage="partial"]'),
      "A partial named scene is not visual coverage",
    ).toHaveCount(0);
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
    if (entry.captureContent) {
      const content = page.locator(captureSelector(entry)).locator(entry.captureContent);
      await expect(content, "The named capture must contain its rendered content").toHaveCount(1);
      await expect(content).toBeVisible();
    }
    if (errors.length) throw new Error(errors.join("\n"));
    return {
      url: page.url(),
      requestedUrl: url,
      current,
      availableStates: available.states,
      readinessTimeoutMs,
    };
  } catch (error) {
    throw new Error(
      `Scene ${entry.scene}/${entry.state} failed readiness at ${url}: ${error.message}${errors.length ? `\nBrowser errors:\n${errors.join("\n")}` : ""}`,
    );
  }
}

export function captureSelector(entry) {
  const frame =
    entry.kind === "catalog-fixture"
      ? `[data-catalog-preview="${entry.scene}"][data-catalog-fixture-id="${entry.fixture}"]`
      : frameSelector;
  return entry.captureTarget ? `${frame} ${entry.captureTarget}` : frame;
}

export async function openCatalogFixture(page, baseUrl, entry, errors = []) {
  const url = sceneUrl(baseUrl, entry);
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  if (!response?.ok())
    throw new Error(`Catalog document returned HTTP ${response?.status()}: ${url}`);
  const frame = page.locator(captureSelector(entry));
  await expect(frame, `Missing real fixture ${entry.scene}/${entry.fixture}`).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(frame).toBeVisible();
  await expect(
    frame.locator("[data-catalog-unimplemented]"),
    "Partial fixtures cannot establish visual parity",
  ).toHaveCount(0);
  const rendered = frame.locator(`[data-catalog-renderer-fixture="${entry.fixture}"]`);
  await expect(rendered).toHaveCount(1);
  if (entry.cellContract)
    await expect(
      rendered.locator(entry.cellContract.selector),
      "Incomplete source fixture matrix",
    ).toHaveCount(entry.cellContract.count);
  const stateTokens = () =>
    rendered.evaluate((root) => {
      const elements = [...root.querySelectorAll("[data-catalog-rendered-state]")];
      if (root.hasAttribute("data-catalog-rendered-state")) elements.unshift(root);
      return [
        ...new Set(
          elements.flatMap((element) =>
            element.getAttribute("data-catalog-rendered-state").split(/\s+/),
          ),
        ),
      ].sort();
    });
  await expect
    .poll(stateTokens, {
      message: "Catalog renderer readiness states differ from the reviewed source fixture",
    })
    .toEqual([...entry.renderedStates].sort());
  if (entry.dismissInitialDialog) {
    await expect(
      page.getByRole("dialog", { name: "Catalog dialog open state", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await frame.scrollIntoViewIfNeeded();
  for (const url of entry.expectedImageUrls ?? [])
    await expect(
      frame.locator(`img[src="${url}"]`),
      "The real avatar component must settle to its fallback",
    ).toHaveCount(0);
  await frame.evaluate(async (root) => {
    await document.fonts.ready;
    await Promise.all(
      [...root.querySelectorAll("img")]
        .filter((image) => !image.complete)
        .map((image) => image.decode()),
    );
  });
  await page.mouse.move(0, 0);
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    requestedUrl: url,
    url: page.url(),
    fixture: entry.fixture,
    renderedStates: await stateTokens(),
    readiness:
      "real catalog renderer/state markers, fonts/images loaded; two identical captures required",
    dismissInitialDialog: Boolean(entry.dismissInitialDialog),
  };
}

export async function stableScreenshot(page, entry, onUnstable) {
  const frame = page.locator(entry ? captureSelector(entry) : frameSelector);
  let previous;
  const attempts = [];
  // Repeated real captures detect moving content without injecting CSS or freezing clocks.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (entry?.kind !== "catalog-fixture")
      await page.locator('[data-preview-ready="true"][data-preview-stable="true"]').waitFor();
    const png = await frame.screenshot({
      animations: "allow",
      caret: "hide",
      scale: "css",
      timeout: 5_000,
    });
    attempts.push(png);
    if (previous?.equals(png)) return png;
    previous = png;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  await onUnstable?.(attempts);
  throw new Error(
    `Capture never produced two identical frames at ${page.url()}. The scene is still moving; no baseline was accepted.`,
  );
}
