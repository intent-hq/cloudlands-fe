import {
  test,
  expect,
  openStreaming,
  captureStreaming,
  frame,
  caller,
  button,
  field,
  toggle,
  choice,
  emit,
  applyEvents,
  applyChunk,
  errorState,
} from "../lib/streaming-status.mjs";

// Independent examples of original003's ordered recovery and public callbacks.
// Caller-state output is used only for callback receipts, never as a visibility oracle.
test("streaming status S1: attempting model quota and ordinary error obey source priority", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  const card = display.getByTestId("failure-recovery-card");
  const thinking = display.locator("[data-streaming-typing-row]");
  await captureStreaming(page, display, "priority-before", info);
  await toggle(host, "Include error", true);
  await toggle(host, "Model unavailable", true);
  await toggle(host, "Quota exceeded", true);
  await expect(thinking).toHaveAttribute("aria-hidden", "false");
  await expect(card).toHaveCount(0);
  await choice(host, "Recovery state", "inactive");
  await expect(card.locator("code")).toHaveText("preview:primary-model");
  await expect(card.getByTestId("error-quota-exceeded")).toHaveCount(0);
  await toggle(host, "Model unavailable", false);
  await expect(card.getByTestId("error-quota-exceeded").locator("code")).toHaveText("Claude Code");
  await expect(card).not.toHaveAttribute("role", "alert");
  await toggle(host, "Offer Codex retry", false);
  await toggle(host, "Offer Gemini CLI retry", false);
  await expect(card).toHaveAttribute("role", "alert");
  await expect(card).toHaveAttribute("aria-live", "assertive");
  await expect(card.getByTestId("retry-with-provider")).toHaveCount(0);
  await toggle(host, "Processing active", false);
  await toggle(host, "Offer Codex retry", true);
  await toggle(host, "Include error", false);
  // Quota alone does not make the source outer visible gate truthy.
  await expect(card).toHaveCount(0);
  await toggle(host, "Include error", true);
  await expect(card.getByTestId("retry-with-provider")).toHaveCount(1);
  await choice(host, "Recovery state", "attempting");
  await expect(card).toHaveCount(0);
  await expect(thinking).toHaveCount(0);
  await captureStreaming(page, display, "priority-after", info);
});

test("streaming status S2: permission and explicit recovery preserve active and inactive visibility", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  const thinking = display.locator("[data-streaming-typing-row]");
  await captureStreaming(page, display, "permission-before", info);
  await emit(host, "prompt", "Current provider is preparing a response.");
  await expect(display.getByTestId("streaming-status-phase")).toHaveText(
    "Current provider is preparing a response.",
  );
  await toggle(host, "Permission pending", true);
  await expect(thinking).toHaveCount(0);
  await toggle(host, "Include error", true);
  await expect(display.getByTestId("failure-recovery-card")).toHaveCount(0);
  await choice(host, "Recovery state", "queued");
  await expect(display.getByRole("alert")).toBeVisible();
  await expect(thinking).toHaveCount(0);
  await choice(host, "Recovery state", "attempting");
  await expect(display.getByRole("alert")).toHaveCount(0);
  await toggle(host, "Permission pending", false);
  await expect(thinking).toHaveAttribute("aria-hidden", "false");
  await toggle(host, "Processing active", false);
  await expect(thinking).toHaveCount(0);
  await toggle(host, "Streaming active", true);
  await expect(thinking).toHaveAttribute("aria-hidden", "false");
  await toggle(host, "Streaming active", false);
  await choice(host, "Recovery state", "automatic");
  await expect(display.getByRole("alert")).toBeVisible();
  await captureStreaming(page, display, "permission-after", info);
});

test("streaming status S3: admission wait supersedes stall and settings invokes only its host callback", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  const stall = display.locator("[data-stream-stalled]");
  const queue = display.locator("[data-stream-slot-wait]");
  const thinking = display.locator("[data-streaming-typing-row]");
  await captureStreaming(page, display, "admission-before", info);
  await emit(host, "stalled", "Stale silence must not become a thinking lifecycle.");
  await expect(stall).toBeVisible();
  await expect(thinking).toHaveCount(0);
  await choice(host, "Admission wait", "slots");
  await expect(stall).toHaveCount(0);
  await expect(thinking).toHaveAttribute("aria-hidden", "false");
  await expect(queue).toHaveAttribute("role", "status");
  await expect(queue).toHaveAttribute("aria-live", "polite");
  const slotMessage = await queue.getByTestId("slot-wait-message").textContent();
  await expect(queue.getByTestId("slot-wait-message")).toContainText("3/3");
  const url = page.url();
  await queue.getByTestId("slot-wait-change-limit").press("Enter");
  await expect
    .poll(async () => (await caller(host)).observations.callbacks)
    .toEqual([
      {
        name: "onOpenAgentBackendSettings",
        callbackRevision: 0,
        mountRevision: 0,
        argumentCount: 0,
        arguments: [],
      },
    ]);
  expect(page.url()).toBe(url);
  await choice(host, "Admission wait", "memory-budget");
  await expect(queue).toHaveAttribute("data-queue-reason", "memory-budget");
  await expect(queue.getByTestId("slot-wait-message")).not.toHaveText(slotMessage);
  await expect(queue.getByTestId("slot-wait-message")).toContainText("3/3");
  await captureStreaming(page, display, "admission-memory", info);
  await toggle(host, "Queue waiting", false);
  await expect(queue).toHaveCount(0);
  await expect(stall).toBeVisible();
  await toggle(host, "Permission pending", true);
  await expect(stall).toHaveCount(0);
  await toggle(host, "Permission pending", false);
  await expect(stall).toBeVisible();
  await toggle(host, "Processing active", false);
  await expect(stall).toHaveCount(0);
  await expect(thinking).toHaveCount(0);
  await captureStreaming(page, display, "admission-after", info);
});

test("streaming status S4: event ordering ties and strictly newer chunks supersede stalls", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  const stall = display.locator("[data-stream-stalled]");
  const phase = display.getByTestId("streaming-status-phase");
  // Read the actual clock to create caller data; never replace or advance it.
  const timestamp = await page.evaluate(() => Date.now());
  const older = {
    phase: "launch",
    message: "Older launch arrived last.",
    level: "info",
    timestamp: timestamp - 5000,
  };
  const prompt = {
    phase: "prompt",
    message: "Newest prompt wins over arrival order.",
    level: "info",
    timestamp,
  };
  const stalled = {
    phase: "stalled",
    message: "Stall text must never become thinking text.",
    level: "warn",
    timestamp: timestamp + 1,
    silentMs: 120000,
  };
  await captureStreaming(page, display, "event-order-before", info);
  await applyEvents(host, [prompt, older]);
  await expect(phase).toHaveText(prompt.message);
  await applyEvents(host, [stalled, older, prompt]);
  await expect(stall).toBeVisible();
  await expect(phase).toHaveCount(0);
  // The measured silence starts before emission, so the visible label is already in minutes.
  await expect(display.getByTestId("stalled-message")).toContainText(/\d+m \d+s/);
  await applyChunk(host, stalled.timestamp);
  await expect(stall).toBeVisible();
  await applyChunk(host, stalled.timestamp + 1);
  await expect(stall).toHaveCount(0);
  await expect(phase).toHaveText(prompt.message);
  await applyChunk(host, stalled.timestamp - 1);
  await expect(stall).toBeVisible();
  await applyChunk(host, null);
  const resumed = {
    phase: "resumed",
    message: "Equal timestamp later entry resumes.",
    level: "info",
    timestamp: stalled.timestamp,
  };
  await applyEvents(host, [older, stalled, resumed]);
  await expect(stall).toHaveCount(0);
  await expect(phase).toHaveText(resumed.message);
  await applyEvents(host, [older, resumed, stalled]);
  await expect(stall).toBeVisible();
  const tool = {
    phase: "tool-call",
    message: "Newer tool event supersedes silence.",
    level: "info",
    timestamp: stalled.timestamp + 1,
  };
  await applyEvents(host, [tool, stalled, older]);
  await expect(stall).toHaveCount(0);
  await expect(phase).toHaveText(tool.message);
  await applyEvents(host, [{ ...tool, phase: "future-phase", message: "" }]);
  await expect(phase).toHaveCount(0);
  await expect(display.locator("[data-streaming-typing-row]")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await applyEvents(host, []);
  await expect(display.getByTestId("streaming-status-elapsed")).toHaveCount(0);
  await captureStreaming(page, display, "event-order-after", info);
});

test("streaming status S5: current model and provider actions retain exact callback arguments", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  await errorState(host);
  await toggle(host, "Model unavailable", true);
  await captureStreaming(page, display, "callbacks-before", info);
  await button(display, "Retry with preview:fallback-model").press("Enter");
  await button(host, "Replace streaming callbacks").click();
  await field(host, "Next available model").fill("current:model/B");
  await button(display, "Retry with current:model/B").press("Space");
  await expect
    .poll(async () => (await caller(host)).observations.callbacks)
    .toEqual([
      {
        name: "onRetryWithModel",
        callbackRevision: 0,
        mountRevision: 0,
        argumentCount: 1,
        arguments: ["preview:fallback-model"],
      },
      {
        name: "onRetryWithModel",
        callbackRevision: 1,
        mountRevision: 0,
        argumentCount: 1,
        arguments: ["current:model/B"],
      },
    ]);
  await toggle(host, "Include optional callbacks", false);
  await expect(button(display, "Retry with current:model/B")).toHaveCount(0);
  await toggle(host, "Model unavailable", false);
  await toggle(host, "Quota exceeded", true);
  await expect(display.getByTestId("retry-with-provider")).toHaveCount(0);
  await toggle(host, "Include optional callbacks", true);
  await expect(display.getByTestId("retry-with-provider")).toHaveText([
    "Retry on Codex",
    "Retry on Gemini CLI",
  ]);
  await button(display, "Retry on Gemini CLI").press("Enter");
  await button(display, "Retry on Codex").press("Space");
  await toggle(host, "Include provider display name", false);
  await expect(display.getByTestId("error-quota-exceeded").locator("code")).toHaveText(
    "claude-code",
  );
  await expect
    .poll(async () => (await caller(host)).observations.callbacks.slice(2))
    .toEqual([
      {
        name: "onRetryWithProvider",
        callbackRevision: 1,
        mountRevision: 0,
        argumentCount: 1,
        arguments: ["gemini"],
      },
      {
        name: "onRetryWithProvider",
        callbackRevision: 1,
        mountRevision: 0,
        argumentCount: 1,
        arguments: ["codex"],
      },
    ]);
  await captureStreaming(page, display, "callbacks-after", info);
});

test("streaming status S6: queued corrupted diagnostics and failure timestamp props remain current", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  await errorState(host);
  const card = display.getByRole("alert");
  const details = button(card, "Details");
  const raw = card.getByTestId("failure-raw-details");
  await captureStreaming(page, display, "failure-before", info);
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(raw).toHaveCount(0);
  const ordinaryDescription = await card.getByTestId("error-message").textContent();
  const ordinaryTitle = await card.getByTestId("error-title").textContent();
  await choice(host, "Recovery state", "queued");
  await expect(card.getByTestId("error-message")).not.toHaveText(ordinaryDescription);
  await expect(button(card, "Retry")).toBeEnabled();
  await toggle(host, "Session corrupted", true);
  await expect(card.getByTestId("error-title")).not.toHaveText(ordinaryTitle);
  const corruptedDescription = await card.getByTestId("error-message").textContent();
  await choice(host, "Recovery state", "action-needed");
  await expect(card.getByTestId("error-message")).toHaveText(corruptedDescription);
  await field(host, "Failure details").fill(
    "Diagnostic <literal> & current\nSecond diagnostic line.",
  );
  await details.press("Enter");
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(raw).toHaveAttribute("id", await details.getAttribute("aria-controls"));
  await expect(raw).toHaveAttribute("role", "region");
  await expect(raw).toHaveText("Diagnostic <literal> & current\nSecond diagnostic line.");
  await details.press("Tab");
  await page.keyboard.press("Tab");
  await expect(raw).toBeFocused();
  await field(host, "Failure details").fill("Replacement diagnostic.");
  await expect(raw).toHaveText("Replacement diagnostic.");
  await button(host, "Mark failure now").click();
  await expect(card.getByTestId("error-failed-at")).toBeVisible();
  const failedAt = card.getByTestId("error-failed-at");
  const timestamp = "2025-02-03T04:05:06.000Z";
  await field(host, "Failure timestamp").fill(timestamp);
  await button(host, "Apply failure timestamp").click();
  await failedAt.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("2025");
  await expect(tooltip).toContainText("04:05:06");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 0);
  await field(host, "Failure timestamp").fill("not-a-date");
  await button(host, "Apply failure timestamp").click();
  await expect(failedAt).toHaveText("Invalid date");
  await failedAt.hover();
  await expect(tooltip).toHaveText("Invalid date");
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await field(host, "Failure timestamp").fill("");
  await button(host, "Apply failure timestamp").click();
  await expect(failedAt).toHaveCount(0);
  await button(host, "Mark failure now").click();
  await button(host, "Clear failure timestamp").click();
  await expect(card.getByTestId("error-failed-at")).toHaveCount(0);
  await details.press("Space");
  await expect(raw).toHaveCount(0);
  await captureStreaming(page, display, "failure-after", info);
});
