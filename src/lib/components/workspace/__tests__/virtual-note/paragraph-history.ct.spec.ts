import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, selectSource, settled, sameSaved, logical, type Host } from './paragraph-browser';

test('one paragraph: distant chronological undo survives cache eviction and destroyed views', async ({
  mount,
  page,
}, info) => {
  await mount(Pair);
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const root = page.getByTestId('bounded').getByTestId('proof');
  const original = await root.evaluate((el) => (el as Host).proof.service.region(0));
  for (const [position, text] of [
    [100, 'AAA'],
    [50000, 'BBB'],
  ] as const) {
    await root.evaluate((el, pos) => (el as Host).proof.seek(pos), position);
    for (const side of ['native', 'bounded']) {
      await selectSource(page, side, position);
      await page.keyboard.type(text);
      await settled(page);
    }
    await sameSaved(page);
  }
  const expected =
    original.slice(0, 100) + 'AAA' + original.slice(100, 49997) + 'BBB' + original.slice(49997);
  expect((await root.evaluate((el) => (el as Host).proof.service.region(0))) === expected).toBe(
    true,
  );
  const before = await root.evaluate((el) => (el as Host).proof.snapshot());
  const visits = await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    const visits = [];
    for (let position = 4096; position < 50000; position += 4096) {
      const old = p.editor!;
      await p.seek(position, false);
      visits.push({ oldDestroyed: old.isDestroyed, ...p.snapshot() });
    }
    return visits;
  });
  expect(
    visits.every(
      (v) =>
        v.oldDestroyed &&
        v.mounted === 1 &&
        v.activeBytes <= 16384 &&
        v.cachePages <= 4 &&
        v.cacheBytes <= 16384,
    ),
  ).toBe(true);
  for (const key of ['Control+z', 'Control+z', 'Control+Shift+z', 'Control+Shift+z']) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press(key);
    }
    await sameSaved(page);
  }
  expect((await root.evaluate((el) => (el as Host).proof.service.region(0))) === expected).toBe(
    true,
  );
  const final = await root.evaluate((el) => (el as Host).proof.snapshot());
  expect(final.journalEvents).toBe(2);
  expect(final.maxSourceRead).toBeLessThanOrEqual(4096);
  expect(final.maxContextPayloadBytes).toBeLessThanOrEqual(5);
  expect(final.sourceReplicaPayloadBytes).toBeLessThan(65536);
  expect(final.maxJournalRead).toBeLessThanOrEqual(4096);
  expect(final.rendererJournalPages).toBe(0);
  expect(final.retainedEditorStates).toBe(0);
  expect(final.mounted).toBe(1);
  expect(final.destroyed).toBeGreaterThan(10);
  expect(final.continuationMetadataBytes).toBeLessThan(128);
  expect(
    final.tokenProvenancePayloadBytes +
      final.provenancePayloadBytes +
      final.markProvenancePayloadBytes,
  ).toBeLessThan(1024 * 1024);
  expect(final.pendingNavigationRequests).toBe(0);
  await info.attach('paragraph-bounds.json', {
    body: JSON.stringify({ before, visits, final }, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('paragraph-continuation.png') });
});

test('one paragraph: delayed continuation during composition preserves input and undo', async ({
  mount,
  page,
}, info) => {
  await mount(Pair);
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const root = page.getByTestId('bounded').getByTestId('proof');
  const cdp = await page.context().newCDPSession(page);
  const observations = [];
  for (const side of ['native', 'bounded']) {
    await selectSource(page, side, 3580);
    if (side === 'bounded')
      await root.evaluate((el) => {
        const h = el as Host & { release: () => void; pending: Promise<boolean> };
        h.proof.delayFetch = () =>
          new Promise((resolve) => {
            h.release = resolve;
          });
        h.pending = h.proof.seek(50000);
      });
    await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
    await expect(page.getByTestId(side).locator('.tiptap')).toContainText('日本');
    if (side === 'bounded') {
      observations.push(
        await root.evaluate(async (el) => {
          const h = el as Host & { release: () => void; pending: Promise<boolean> };
          const during = h.proof.snapshot();
          h.release();
          h.proof.delayFetch = undefined;
          return { during, accepted: await h.pending, after: h.proof.snapshot() };
        }),
      );
      expect(observations[0].accepted).toBe(false);
      expect(observations[0].during.pendingWindowRequests).toBe(1);
      expect(observations[0].during.pendingNavigationRequests).toBe(1);
      expect(observations[0].during.inFlightBytes).toBe(0);
      expect(observations[0].after.created).toBe(observations[0].during.created);
    }
    await cdp.send('Input.insertText', { text: '日本語' });
    await settled(page);
  }
  await sameSaved(page);
  const after = await logical(page, 'bounded');
  await root.evaluate((el) => (el as Host).proof.seek(50000, false));
  for (const key of ['Control+z', 'Control+Shift+z']) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press(key);
    }
    await sameSaved(page);
  }
  expect(await logical(page, 'bounded')).toEqual(after);
  await info.attach('paragraph-composition.json', {
    body: JSON.stringify(observations, null, 2),
    contentType: 'application/json',
  });
  await cdp.detach();
});
