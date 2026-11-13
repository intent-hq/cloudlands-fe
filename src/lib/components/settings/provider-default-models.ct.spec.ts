import { test, expect } from '../../../test/ct-test';
import Preview from './provider-default-models.preview.svelte';

for (const scenario of [
  { name: 'wide light', width: 1000, narrowPane: false, dark: false },
  { name: 'narrow pane in wide dark window', width: 1000, narrowPane: true, dark: true },
  { name: 'small window', width: 320, narrowPane: false, dark: false },
]) {
  test(`default model controls align and remain operable: ${scenario.name}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      scenario.dark,
    );
    const root = await mount(Preview, { props: { narrowPane: scenario.narrowPane } });
    await page.evaluate(() => document.fonts.ready);
    const rows = root.locator('[data-slot="settings-field-row"]');
    await expect(rows).toHaveCount(3);
    const edges = await rows.evaluateAll((elements) =>
      elements.map((row) => {
        const rect = row.getBoundingClientRect();
        const trigger = row
          .querySelector('button[aria-haspopup="listbox"]')!
          .getBoundingClientRect();
        return {
          right: trigger.right,
          rowRight: rect.right,
          left: trigger.left,
          rowLeft: rect.left,
        };
      }),
    );
    for (const edge of edges) {
      expect(Math.abs(edge.right - edge.rowRight)).toBeLessThan(1);
      expect(Math.abs(edge.right - edges[0].right)).toBeLessThan(1);
      expect(edge.left).toBeGreaterThanOrEqual(edge.rowLeft);
    }
    const reset = root.getByRole('button', { name: 'Reset all to default' });
    const main = root.locator('#default-agent-model button[aria-haspopup="listbox"]');
    const a = (await reset.boundingBox())!;
    const b = (await main.boundingBox())!;
    expect(a.x + a.width <= b.x || a.y + a.height <= b.y).toBe(true);
    await expect(main.locator('[data-slot="button-surface"]')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    expect(await root.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    // Real selection, not a geometry-only mock: the provider default clears
    // only that action.
    const commit = root.locator('#background-agent-commit button[aria-haspopup="listbox"]');
    const defaults = root.getByTestId('defaults-state');
    await expect(defaults).toContainText('"commit":"claude-code:claude-code-preview-deep"');
    await commit.click();
    await page.getByRole('option', { name: /Provider default/ }).click();
    await expect(defaults).toContainText(
      '"defaultModel":"","overrides":{"commit":"","pr":"","review":"","fast":""}',
    );
    await expect(commit).toHaveAttribute('aria-expanded', 'false');
    await commit.click();
    await expect(page.getByRole('option', { name: /Provider default/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(commit).toBeFocused();
  });
}

for (const action of ['commit', 'pr']) {
  test(`quick-action ${action} effort supports the provider default model and keyboard reset`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 1000 });
    const root = await mount(Preview, { props: { commitModel: '' } });
    const trigger = root.locator(`#background-agent-${action} button[aria-haspopup="listbox"]`);
    const output = root.getByTestId('defaults-state');
    await trigger.click();
    const effort = page.getByTestId('effort-picker-trigger');
    await effort.focus();
    await effort.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(output).toContainText(`"quickEffortOverrides":{"${action}":"high"}`);
    await expect(output).toContainText('"overrides":{"commit":"","pr":"","review":"","fast":""}');
    await expect(effort).toBeFocused();
    await effort.press('Enter');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(output).toContainText('"quickEffortOverrides":{}');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('Auggie catalog effort remains available for ordinary agents but not quick actions', async ({
  mount,
  page,
}) => {
  const root = await mount(Preview, {
    props: {
      quickActionProvider: 'auggie',
      quickActionDefaultModel: 'auggie-preview-balanced',
      quickActionEffort: 'medium',
      commitModel: '',
    },
  });
  const main = root.locator('#default-agent-model button[aria-haspopup="listbox"]');
  await main.click();
  await expect(page.getByTestId('effort-picker-trigger')).toBeVisible();
  await page.keyboard.press('Escape');
  for (const action of ['commit', 'pr']) {
    const trigger = root.locator(`#background-agent-${action} button[aria-haspopup="listbox"]`);
    await expect(trigger).not.toContainText('Medium');
    await trigger.click();
    await expect(page.getByTestId('effort-picker-trigger')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await expect(root.getByTestId('quick-action-effort-route-note')).toHaveCount(2);
  await expect(root.getByTestId('defaults-state')).toContainText('"quickEffort":"medium"');
  await expect(root.getByTestId('defaults-state')).toContainText('"quickEffortOverrides":{}');
});

test('the first edit retires a legacy shared default without changing other actions', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  const root = await mount(Preview, {
    props: {
      quickActionDefaultModel: 'codex-preview-balanced',
      quickActionEffort: 'medium',
      commitModel: '',
    },
  });
  const output = root.getByTestId('defaults-state');
  const commit = root.locator('#background-agent-commit button[aria-haspopup="listbox"]');
  const pr = root.locator('#background-agent-pr button[aria-haspopup="listbox"]');
  await expect(commit).toHaveText(await pr.innerText());
  await expect(commit).not.toContainText('Default (');
  await pr.click();
  await page.getByRole('option', { name: /Provider default/ }).click();
  await expect(output).toContainText(
    '"defaultModel":"","overrides":{"commit":"codex-preview-balanced","pr":"","review":"codex-preview-balanced","fast":"","walkthrough":"codex-preview-balanced"}',
  );
  await expect(output).toContainText(
    '"quickEffort":"","quickEffortOverrides":{"commit":"medium","pr":"medium","review":"medium","walkthrough":"medium"}',
  );
  await expect(pr).toContainText('Default (');
  await expect(commit).not.toContainText('Default (');
});
