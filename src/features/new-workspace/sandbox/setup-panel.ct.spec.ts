import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import ScenarioContractHost from './ScenarioContractHost.svelte';

const consoleErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});

test.afterEach(({ page }, testInfo) => {
  const errors = consoleErrors.get(page) ?? [];
  const unexpected = errors.filter(
    (error) =>
      !(
        testInfo.title.includes('setup-branch-fetch-failure') &&
        error.includes('Failed to fetch branches')
      ),
  );
  expect(unexpected, `Unexpected console errors in ${testInfo.title}`).toEqual([]);
});

const SCENARIOS = [
  'setup-empty',
  'setup-new-folder',
  'setup-suggestions',
  'setup-collapsed-summary',
  'setup-card-new-folder',
  'setup-menu-new-folder',
  'setup-issue-prefill',
  'setup-issue-preserve',
  'setup-options-open',
  'setup-options-modified',
  'setup-branch-fetch-failure',
  'setup-readiness-missing',
];

const SURFACE_CONTRACTS = [
  { theme: 'light', width: 900 },
  { theme: 'light', width: 1280 },
  { theme: 'dark', width: 900 },
  { theme: 'dark', width: 1280 },
] as const;

for (const { theme, width } of SURFACE_CONTRACTS) {
  test(`setup panel keeps its copy on an opaque readable surface in ${theme} at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const component = await mount(ScenarioContractHost, {
      props: { scenarioId: 'setup-suggestions' },
    });
    const panel = component.getByTestId('project-setup-panel');

    const surface = await panel.evaluate((node) => {
      const parseColor = (color: string) => {
        const channels = color.match(/[0-9.]+/g)?.map(Number);
        if (!channels || channels.length < 3) throw new Error(`Unsupported color: ${color}`);
        return channels;
      };
      const luminance = ([red, green, blue]: number[]) =>
        0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const normalize = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const style = getComputedStyle(node);
      const background = parseColor(style.backgroundColor);
      const foreground = parseColor(style.color);
      const backgroundLuminance = luminance(background.slice(0, 3).map(normalize));
      const foregroundLuminance = luminance(foreground.slice(0, 3).map(normalize));
      return {
        alpha: background[3] ?? 1,
        contrast:
          (Math.max(backgroundLuminance, foregroundLuminance) + 0.05) /
          (Math.min(backgroundLuminance, foregroundLuminance) + 0.05),
      };
    });

    expect(surface.alpha).toBe(1);
    expect(surface.contrast).toBeGreaterThanOrEqual(4.5);
  });
}

for (const testCase of SCENARIOS) {
  test(`setup panel: ${testCase}`, async ({ mount, page }) => {
    const scenarioId =
      testCase === 'setup-card-new-folder' || testCase === 'setup-menu-new-folder'
        ? 'setup-empty'
        : testCase === 'setup-issue-prefill'
          ? 'setup-suggestions'
          : testCase === 'setup-issue-preserve'
            ? 'setup-suggestions-existing-intent'
            : testCase;
    const component = await mount(ScenarioContractHost, { props: { scenarioId } });

    switch (testCase) {
      case 'setup-empty':
        await expect(component.getByText('Recent', { exact: true })).toHaveCount(0);
        await expect(component.getByText('Your GitHub repos', { exact: true })).toHaveCount(0);
        break;
      case 'setup-new-folder':
        await expect(component.getByTestId('starting-point-section')).toHaveCount(0);
        await expect(component.getByTestId('options-section')).toBeVisible();
        break;
      case 'setup-suggestions':
        await expect(
          component.getByText('intent-hq/intent', { exact: true }).first(),
        ).toBeVisible();
        await expect(component.getByText('Your GitHub repos', { exact: true })).toBeVisible();
        await component.getByText('intent-hq/intent', { exact: true }).first().click();
        await component.getByRole('button', { name: 'Expand project setup' }).click();
        await expect(component.getByTestId('starting-point-section')).toBeVisible();
        await expect(component.getByText('main', { exact: true }).first()).toBeVisible();
        await expect(
          component.getByRole('button', { name: /Make setup suggestions deterministic/ }),
        ).toBeVisible();
        break;
      case 'setup-collapsed-summary': {
        let summary = component.getByRole('button', { name: 'Expand project setup' });
        await expect(summary).toContainText('intent-hq/intent');
        await expect(summary).toContainText('Ready');
        await summary.click();
        await expect(component.getByTestId('selected-project')).toContainText('intent-hq/intent');
        await component.getByRole('button', { name: 'Set up your project' }).click();
        await expect(summary).toBeVisible();
        await component.unmount();
        const restored = await mount(ScenarioContractHost, {
          props: { scenarioId: 'setup-collapsed-summary' },
        });
        summary = restored.getByRole('button', { name: 'Expand project setup' });
        await expect(summary).toContainText('intent-hq/intent');
        await expect(restored.getByTestId('selected-project')).toHaveCount(0);
        break;
      }
      case 'setup-card-new-folder':
        await component.getByRole('button', { name: /Start a new project/ }).click();
        await page.getByRole('textbox', { name: 'Folder name' }).fill('from-card');
        await page.getByRole('button', { name: 'Select folder…' }).click();
        await expect(component).toHaveAttribute('data-source-kind', 'newFolder');
        break;
      case 'setup-menu-new-folder':
        await component.getByTestId('prompt-actions-trigger').click();
        await page.getByRole('menuitem', { name: 'Start a new project' }).click();
        await page.getByRole('textbox', { name: 'Folder name' }).fill('from-menu');
        await page.getByRole('button', { name: 'Select folder…' }).click();
        await expect(component).toHaveAttribute('data-source-kind', 'newFolder');
        break;
      case 'setup-issue-prefill':
      case 'setup-issue-preserve':
        await component.getByText('intent-hq/intent', { exact: true }).first().click();
        await component.getByRole('button', { name: 'Expand project setup' }).click();
        await component
          .getByRole('button', { name: /Make setup suggestions deterministic/ })
          .click();
        await expect(component.locator('.tiptap-editor')).toContainText(
          testCase === 'setup-issue-prefill'
            ? '#4321 Make setup suggestions deterministic'
            : 'Retained draft text for browser verification',
        );
        await expect(component.getByText('intent-hq/intent#4321', { exact: true })).toBeVisible();
        break;
      case 'setup-options-open':
        await expect(component.getByTestId('options-section')).toHaveAttribute('open', '');
        await expect(component.getByTestId('options-section').locator('summary')).toContainText(
          'Default',
        );
        break;
      case 'setup-options-modified':
        await expect(component.getByTestId('options-section')).toHaveAttribute('open', '');
        await expect(component.getByTestId('options-section').locator('summary')).toContainText(
          'Modified',
        );
        break;
      case 'setup-branch-fetch-failure':
        await component.getByRole('button', { name: 'Select a branch' }).click();
        await expect(
          page.getByText('Network error. Check connection or enter branch manually.'),
        ).toBeVisible();
        await expect(page.getByPlaceholder('Search or enter branch name...')).toBeEditable();
        break;
      case 'setup-readiness-missing':
        await expect(component.getByTestId('readiness-section')).toContainText('Needs attention');
        await expect(component.locator('[data-capability="git"]')).toBeVisible();
        await expect(
          component.locator('[data-coordinator-state="connect-provider"]'),
        ).toBeVisible();
        break;
    }
  });
}
