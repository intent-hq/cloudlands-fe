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
  errorState,
  nativePaste,
  observeRealTime,
} from "../lib/streaming-status.mjs";

test("streaming status S7: auth and diagnostic copy use the current real clipboard and native paste", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: process.env.PARITY_CANDIDATE_URL,
  });
  const host = await openStreaming(page);
  const display = frame(host);
  await errorState(host);
  await toggle(host, "Include auth guidance", true);
  const guidance = display.getByTestId("error-auth-guidance");
  const copy = guidance.getByRole("button", { name: /^(Copy|Copied!)$/ });
  const paste = field(host, "Paste copied login command");
  await captureStreaming(page, display, "clipboard-before", info);
  await copy.press("Enter");
  await nativePaste(paste, "claude auth login", { copy, info, name: "auth-initial" });
  await field(host, "Login command").fill("provider-cli login --profile current");
  await copy.click();
  await nativePaste(paste, "provider-cli login --profile current", {
    copy,
    info,
    name: "auth-replaced",
  });
  await toggle(host, "Claude desktop note", false);
  await expect(guidance.getByTestId("error-auth-claude-desktop-note")).toHaveCount(0);
  await field(host, "Login command").fill("");
  await copy.click();
  await nativePaste(paste, "", { copy, info, name: "auth-empty" });
  await toggle(host, "Claude desktop note", true);
  await expect(guidance.getByTestId("error-auth-claude-desktop-note")).toBeVisible();
  await toggle(host, "Include auth guidance", false);
  await expect(guidance).toHaveCount(0);
  await field(host, "Failure details").fill("Raw diagnostic <literal> & no command execution.");
  await button(display, "Details").press("Enter");
  const rawCopy = display.getByRole("button", { name: /^(Copy details|Copied!)$/ });
  await rawCopy.click();
  await nativePaste(paste, "Raw diagnostic <literal> & no command execution.", {
    copy: rawCopy,
    info,
    name: "raw-diagnostic",
  });
  await expect.poll(async () => (await caller(host)).observations.count).toBe(0);
  await captureStreaming(page, display, "clipboard-after", info);
});

test("streaming status S8: retry stop and settings use current callbacks after replacement and remount", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  await captureStreaming(page, display, "ownership-before", info);
  await emit(host, "stalled", "The provider has stopped producing output.");
  await display.getByTestId("stalled-retry").press("Enter");
  await display.getByTestId("stalled-cancel").press("Space");
  await button(host, "Replace streaming callbacks").click();
  await display.getByTestId("stalled-retry").press("Space");
  await toggle(host, "Include optional callbacks", false);
  await expect(display.getByTestId("stalled-retry")).toHaveCount(0);
  await expect(display.getByTestId("stalled-cancel")).toHaveCount(0);
  await choice(host, "Admission wait", "slots");
  const url = page.url();
  await display.getByTestId("slot-wait-change-limit").press("Enter");
  await toggle(host, "Include optional callbacks", true);
  await errorState(host);
  await button(display, "Retry").press("Enter");
  await button(host, "Replace streaming callbacks").click();
  await button(host, "Remount streaming status").click();
  await button(display, "Retry").press("Space");
  await expect
    .poll(async () => (await caller(host)).observations.callbacks)
    .toEqual([
      {
        name: "onStalledRetry",
        callbackRevision: 0,
        mountRevision: 0,
        argumentCount: 1,
        arguments: [null],
      },
      {
        name: "onStop",
        callbackRevision: 0,
        mountRevision: 0,
        argumentCount: 1,
        arguments: [null],
      },
      {
        name: "onStalledRetry",
        callbackRevision: 1,
        mountRevision: 0,
        argumentCount: 1,
        arguments: [null],
      },
      {
        name: "onOpenAgentBackendSettings",
        callbackRevision: 1,
        mountRevision: 0,
        argumentCount: 0,
        arguments: [],
      },
      {
        name: "onRetry",
        callbackRevision: 1,
        mountRevision: 0,
        argumentCount: 1,
        arguments: [null],
      },
      {
        name: "onRetry",
        callbackRevision: 2,
        mountRevision: 1,
        argumentCount: 1,
        arguments: [null],
      },
    ]);
  expect(page.url()).toBe(url);
  await toggle(host, "Include optional callbacks", false);
  await expect(button(display, "Retry")).toHaveCount(0);
  await captureStreaming(page, display, "ownership-after", info);
});

test("streaming status S9: native elapsed updates stay separate from the static live announcement", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  await emit(host, "prompt", "The provider is preparing a response.");
  const row = display.locator("[data-streaming-typing-row]");
  const elapsed = display.getByTestId("streaming-status-elapsed");
  await display.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect
    .poll(() => elapsed.evaluate((node) => node.checkVisibility({ checkOpacity: true })))
    .toBe(false);
  await expect(elapsed).toHaveAttribute("aria-live", "off");
  const cold = await elapsed.textContent();
  await observeRealTime(page, 1200);
  await expect(elapsed).toHaveText(cold);
  await captureStreaming(page, display, "elapsed-before", info);
  await row.hover();
  await expect
    .poll(() => elapsed.evaluate((node) => node.checkVisibility({ checkOpacity: true })))
    .toBe(true);
  const hovered = await elapsed.textContent();
  await expect.poll(() => elapsed.textContent()).not.toBe(hovered);
  const advanced = await elapsed.textContent();
  await page.mouse.move(0, 0);
  await expect
    .poll(() => elapsed.evaluate((node) => node.checkVisibility({ checkOpacity: true })))
    .toBe(false);
  const unhovered = await elapsed.textContent();
  await observeRealTime(page, 1200);
  await expect(elapsed).toHaveText(unhovered);
  await emit(host, "stalled", "Do not reuse this stall as a thinking lifecycle.");
  const live = display.getByTestId("stalled-announcement");
  const label = display.getByTestId("stalled-message");
  await expect(row).toHaveCount(0);
  await expect(live).toHaveAttribute("role", "status");
  const announcement = await live.textContent();
  const stalled = await label.textContent();
  await expect.poll(() => label.textContent()).not.toBe(stalled);
  await expect(live).toHaveText(announcement);
  expect(
    await label.evaluate(
      (node) =>
        node.closest(
          '[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]',
        ) === null,
    ),
  ).toBe(true);
  await info.attach("elapsed-observations.json", {
    body: JSON.stringify(
      {
        cold,
        hovered,
        advanced,
        unhovered,
        stalled,
        currentStall: await label.textContent(),
        announcement,
        currentAnnouncement: await live.textContent(),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await button(host, "Receive new chunk").click();
  await expect(label).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-hidden", "false");
  await expect(display.getByTestId("streaming-status-phase")).toHaveText(
    "The provider is preparing a response.",
  );
  await display.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await captureStreaming(page, display, "elapsed-after", info);
  // A stable sampled value does not prove timer disposal or internal subscription counts.
});

test("streaming status S10: detached failure owner cannot preserve disclosure into a fresh mount", async ({
  page,
}, info) => {
  const host = await openStreaming(page);
  const display = frame(host);
  await errorState(host);
  const details = button(display, "Details");
  await details.press("Enter");
  const oldOwner = await host.getByTestId("streaming-status-leaf").elementHandle();
  const oldDetails = await display.getByTestId("failure-raw-details").elementHandle();
  try {
    await captureStreaming(page, display, "lifetime-before", info);
    await toggle(host, "Mount streaming status", false);
    await expect(host.getByTestId("streaming-status-leaf")).toHaveCount(0);
    expect(await oldOwner.evaluate((node) => node.isConnected)).toBe(false);
    expect(await oldDetails.evaluate((node) => node.isConnected)).toBe(false);
    await field(host, "Failure details").fill("Diagnostic supplied while the leaf was absent.");
    await toggle(host, "Mount streaming status", true);
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect(display.getByTestId("failure-raw-details")).toHaveCount(0);
    await details.press("Space");
    await expect(display.getByTestId("failure-raw-details")).toHaveText(
      "Diagnostic supplied while the leaf was absent.",
    );
    expect(await oldOwner.evaluate((node) => node.isConnected)).toBe(false);
    await button(host, "Remount streaming status").click();
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect(display.getByTestId("failure-raw-details")).toHaveCount(0);
    await expect.poll(async () => (await caller(host)).observations.count).toBe(0);
    await captureStreaming(page, display, "lifetime-after", info);
  } finally {
    await oldOwner.dispose();
    await oldDetails.dispose();
  }
  // This observes DOM ownership and local disclosure reset, not unobserved timer cleanup.
});
