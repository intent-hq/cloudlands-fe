import { expect } from '@playwright/experimental-ct-svelte';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Fail a Playwright CT spec on caught console errors (intent-hq/intent#5276).
 *
 * `page.pageErrors()` only reports uncaught exceptions. A fixture that mounts
 * a real code path against a missing bridge or mock — queue hydration without
 * `window.electronAPI`, `WorkspaceActionsMenu` without a `workspace:get`
 * handler — catches the failure and logs it through `console.error`, so the
 * geometry assertions pass while the fixture silently exercises its fallback
 * path. `failOnConsoleErrors(test)` records every `console.error` emitted
 * during a test and asserts none remain in `afterEach`.
 *
 * A test that deliberately provokes a caught error (a negative harness check)
 * waits for it with `expect.poll(() => peekConsoleErrors(page))`, then drains
 * the recorded errors with `takeConsoleErrors(page)` and asserts on them
 * itself; anything left over still fails the test.
 */

interface GuardableTest {
  beforeEach(hook: (fixtures: { page: Page }, testInfo: TestInfo) => Promise<void>): void;
  afterEach(hook: (fixtures: { page: Page }, testInfo: TestInfo) => Promise<void>): void;
}

const errorsByPage = new WeakMap<Page, string[]>();

export function failOnConsoleErrors(test: GuardableTest): void {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    errorsByPage.set(page, errors);
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  });
  test.afterEach(async ({ page }) => {
    expect(takeConsoleErrors(page)).toEqual([]);
  });
}

/** The console errors recorded so far for `page`, left in place. */
export function peekConsoleErrors(page: Page): readonly string[] {
  return [...(errorsByPage.get(page) ?? [])];
}

/** Remove and return the console errors recorded so far for `page`. */
export function takeConsoleErrors(page: Page): string[] {
  const errors = errorsByPage.get(page);
  return errors ? errors.splice(0, errors.length) : [];
}
