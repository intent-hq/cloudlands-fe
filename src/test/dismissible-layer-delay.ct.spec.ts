import { expect, test } from './ct-test';
import { expectDismissibleLayerArmed } from './dismissible-layer';
import { readDismissibleLayerState } from './dismissible-layer-state';
import SelectHarness from '../lib/components/ui/select/select.test-harness.svelte';

// The CT_DELAY_DISMISSIBLE_LAYER proof only means something while bits-ui arms
// layers through setTimeout(…, 1). This file turns the delay on (the worker
// option the env switch sets; Playwright allows it only at file level) and
// checks, against real bits-ui, that arming really waits for it. If bits-ui
// moves arming to another timer, this fails instead of letting proof runs
// pass without widening the race.
const delayMs = 3_000;
test.use({ _ctDismissibleLayerDelayMs: delayMs });

test('bits-ui arms the layer only after the delayed 1 ms timer', async ({ mount, page }) => {
  const root = await mount(SelectHarness, { props: { portal: true, searchable: true } });
  const trigger = root.getByRole('combobox', { name: 'Choose fruit' });
  await trigger.focus();
  const openedAt = Date.now();
  await trigger.press('Enter');
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const early = await listbox.evaluate(readDismissibleLayerState);
  expect(early).toMatch(
    /^the bits-ui layer <div .*has not registered its outside-pointer listeners/,
  );
  expect(early).toContain('data-select-content');

  await expectDismissibleLayerArmed(listbox, { timeout: delayMs + 5_000 });
  expect(Date.now() - openedAt).toBeGreaterThanOrEqual(delayMs - 500);
  await root.getByRole('button', { name: 'Outside action' }).click();
  await expect(listbox).toHaveCount(0);
});
