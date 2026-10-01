import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, selectSource, settled, sameSaved, type Host } from './paragraph-browser';

for (const action of ['Shift+ArrowLeft', 'Control+z', 'typing after history timeout'])
  test(`deferred boundary input preserves subsequent ${action}`, async ({ mount, page }, info) => {
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
    await mount(Pair);
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    const root = page.getByTestId('bounded').getByTestId('proof');
    const original = await root.evaluate((el) => (el as Host).proof.service.region(0));
    await root.evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = () => new Promise((resolve) => (h.release = resolve));
    });
    for (const side of ['native', 'bounded']) {
      await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
      await selectSource(page, side, 4096);
      await page.keyboard.press('Delete');
      if (action === 'typing after history timeout') {
        await page.clock.setFixedTime(new Date('2026-10-01T12:00:01Z'));
        await page.keyboard.type('NEW');
      } else await page.keyboard.press(action);
      await settled(page);
    }
    const waiting = await root.evaluate((el) => (el as Host).proof.snapshot());
    expect(waiting.pendingInputs).toBeGreaterThanOrEqual(2);
    await root.evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = undefined;
      h.release();
    });
    await settled(page);
    await expect
      .poll(() => root.evaluate((el) => (el as Host).proof.service.pendingInputs))
      .toBe(0);
    const expected =
      action === 'Control+z'
        ? original
        : original.slice(0, 4096) +
          (action === 'typing after history timeout' ? 'NEW' : '') +
          original.slice(4097);
    expect((await root.evaluate((el) => (el as Host).proof.service.region(0))) === expected).toBe(
      true,
    );
    await sameSaved(page);
    const after = await root.evaluate((el) => (el as Host).proof.snapshot());
    expect(after.journalEvents).toBe(action === 'typing after history timeout' ? 2 : 1);
    expect(after.maxResidentInputBytes).toBeLessThanOrEqual(4096);
    expect(after.backingInputBytes).toBe(0);
    expect(after.retainedEditorStates).toBe(0);
    if (action === 'typing after history timeout') {
      for (const key of ['Control+z', 'Control+z', 'Control+Shift+z', 'Control+Shift+z']) {
        for (const side of ['native', 'bounded']) {
          await focus(page, side);
          await page.keyboard.press(key);
        }
        await sameSaved(page);
      }
    }
    await info.attach('deferred-input.json', {
      body: JSON.stringify({ waiting, after }, null, 2),
      contentType: 'application/json',
    });
  });

for (const backward of [false, true])
  test(`deferred Enter after ${backward ? 'Backspace' : 'Delete'} preserves the split and both history events`, async ({
    mount,
    page,
  }, info) => {
    const startTime = new Date('2026-10-01T12:00:00Z').getTime();
    await page.clock.setFixedTime(startTime);
    await mount(Pair);
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    const root = page.getByTestId('bounded').getByTestId('proof');
    const original = await root.evaluate((el) => (el as Host).proof.service.region(0));
    const position = backward ? 2048 : 4096;
    if (backward) await root.evaluate((el) => (el as Host).proof.seek(4096));
    await root.evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = () => new Promise((resolve) => (h.release = resolve));
    });
    for (const side of ['native', 'bounded']) {
      await page.clock.setFixedTime(startTime);
      await selectSource(page, side, position);
      await page.keyboard.press(backward ? 'Backspace' : 'Delete');
      await page.clock.setFixedTime(startTime + 1000);
      await page.keyboard.press('Enter');
      await settled(page);
    }
    const waiting = await root.evaluate((el) => (el as Host).proof.snapshot());
    await root.evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = undefined;
      h.release();
    });
    await settled(page);
    await expect
      .poll(() => root.evaluate((el) => (el as Host).proof.service.pendingInputs))
      .toBe(0);
    const from = position - Number(backward);
    const deletion = original.slice(0, from) + original.slice(from + 1);
    const split = original.slice(0, from) + '\n\n' + original.slice(from + 1);
    const after = await root.evaluate((el) => (el as Host).proof.snapshot());
    await info.attach('deferred-enter.json', {
      body: JSON.stringify({ waiting, after }, null, 2),
      contentType: 'application/json',
    });
    expect((await root.evaluate((el) => (el as Host).proof.service.region(0))) === split).toBe(
      true,
    );
    expect(waiting.error).toBe('');
    expect(waiting.pendingInputs).toBe(2);
    expect(after.journalEvents).toBe(2);
    expect(await root.evaluate((el) => (el as Host).proof.editor!.state.doc.childCount)).toBe(2);
    expect(after.activeBytes).toBeLessThanOrEqual(16384);
    expect(after.maxSourceRead).toBeLessThanOrEqual(4096);
    expect(after.maxResidentInputBytes).toBeLessThanOrEqual(4096);
    expect(after.backingInputBytes).toBe(0);
    await sameSaved(page);
    for (const [key, expected] of [
      ['Control+z', deletion],
      ['Control+z', original],
      ['Control+Shift+z', deletion],
      ['Control+Shift+z', split],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
      }
      expect((await root.evaluate((el) => (el as Host).proof.service.region(0))) === expected).toBe(
        true,
      );
      await sameSaved(page);
    }
  });
