import { test, expect, openFixture } from '../lib/functional.mjs';

async function openQueue(page) {
  const fixture = await openFixture(page, 'message-composer', 'queued-messages');
  await page.bringToFront();
  await page.evaluate(() => globalThis.document.fonts.ready);
  // Both endpoints must be visible before mouse-down. Scrolling the target
  // during dragTo can move the pressed source away before native drag starts.
  await fixture.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => globalThis.document.hasFocus())).toBe(true);
  const first = fixture.getByRole('button', {
    name: 'Summarize the implementation plan',
    exact: true,
  });
  const second = fixture.getByRole('button', { name: 'Then identify the main risks', exact: true });
  await expect(first).toBeInViewport({ ratio: 1 });
  await expect(second).toBeInViewport({ ratio: 1 });
  const rows = fixture.locator('[data-message-composer-queue-list] [role="button"]');
  const callbacks = fixture.locator('[data-queue-changes]');
  await expect(callbacks).toHaveAttribute('data-queue-changes', '[]');
  await fixture.evaluate((node) => {
    const refs = Array.from(node.querySelectorAll('[data-queued-id] [role="button"]'));
    const events = [];
    const listener = (event) => {
      events.push({
        type: event.type,
        trusted: event.isTrusted,
        key: event.key,
        targetId: event.target.closest?.('[data-queued-id]')?.dataset.queuedId,
        types: Array.from(event.dataTransfer?.types ?? []),
        sourceId:
          event.type === 'drop'
            ? event.dataTransfer?.getData('text/message-composer-queue-id')
            : undefined,
      });
    };
    const types = ['keydown', 'dragstart', 'dragover', 'drop', 'dragend'];
    for (const type of types) node.addEventListener(type, listener);
    globalThis.composerQueueObservation = { refs, events, node, types, listener };
  });
  return { fixture, first, second, rows, callbacks, before: await fixture.boundingBox() };
}

async function recordQueue(queue, info) {
  const observed = await queue.fixture.evaluate((node) => {
    const observation = globalThis.composerQueueObservation;
    const rows = Array.from(node.querySelectorAll('[data-queued-id] [role="button"]'));
    for (const type of observation.types) {
      observation.node.removeEventListener(type, observation.listener);
    }
    return {
      events: observation.events,
      retained: rows.every((row) => observation.refs.includes(row)),
      order: rows.map((row) => row.closest('[data-queued-id]').dataset.queuedId),
      activeId: globalThis.document.activeElement?.closest('[data-queued-id]')?.dataset.queuedId,
      windowFocused: globalThis.document.hasFocus(),
      callbacks: JSON.parse(node.querySelector('[data-queue-changes]').dataset.queueChanges),
    };
  });
  await info.attach('queue-native-delivery-and-geometry', {
    body: JSON.stringify({
      ...observed,
      before: queue.before,
      after: await queue.fixture.boundingBox(),
    }),
    contentType: 'application/json',
  });
  await info.attach('composer-reordered-queue', {
    body: await queue.fixture.screenshot(),
    contentType: 'image/png',
  });
  expect(observed.retained, 'Reordering must retain both row elements').toBe(true);
  expect(observed.windowFocused).toBe(true);
  expect(observed.events.every((event) => event.trusted)).toBe(true);
  return observed;
}

const moved = ['catalog-2', 'catalog-1'];
const original = ['catalog-1', 'catalog-2'];

function expectNativeDrop(observed) {
  for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
    expect(
      observed.events.some((event) => event.type === type && event.trusted),
      type,
    ).toBe(true);
  }
  expect(observed.events).toContainEqual({
    type: 'drop',
    trusted: true,
    targetId: 'catalog-2',
    types: ['text/message-composer-queue-id'],
    sourceId: 'catalog-1',
  });
}

test('composer queue: native keyboard and pointer reorder preserve rows and focus', async ({
  page,
}, info) => {
  const queue = await openQueue(page);
  const { first, second, rows, callbacks } = queue;
  try {
    await first.press('Alt+ArrowDown');
    await expect(rows.first()).toHaveAccessibleName('Then identify the main risks');
    await expect(first).toBeFocused();
    await first.press('Alt+ArrowUp');
    await expect(rows.first()).toHaveAccessibleName('Summarize the implementation plan');
    await expect(first).toBeFocused();
    await first.dragTo(second);
    await expect(rows.first()).toHaveAccessibleName('Then identify the main risks');
    await expect(rows).toHaveCount(2);
    await expect(callbacks).toHaveAttribute(
      'data-queue-changes',
      JSON.stringify([moved, original, moved]),
    );
  } finally {
    const observed = await recordQueue(queue, info);
    if (info.errors.length === 0) expectNativeDrop(observed);
  }
});

test('composer queue: independent keyboard reorders keep the moved row focused in both directions', async ({
  page,
}, info) => {
  const queue = await openQueue(page);
  const { first, second, rows, callbacks } = queue;
  try {
    await first.press('Alt+ArrowDown');
    await expect(rows.first()).toHaveAccessibleName('Then identify the main risks');
    await expect(first).toBeFocused();
    await first.press('Alt+ArrowUp');
    await expect(rows.first()).toHaveAccessibleName('Summarize the implementation plan');
    await expect(first).toBeFocused();
    await second.press('Alt+ArrowUp');
    await expect(rows.first()).toHaveAccessibleName('Then identify the main risks');
    await expect(second).toBeFocused();
    await second.press('Alt+ArrowDown');
    await expect(rows.first()).toHaveAccessibleName('Summarize the implementation plan');
    await expect(second).toBeFocused();
    await second.press('Alt+ArrowDown');
    await expect(second).toBeFocused();
    await expect(rows).toHaveCount(2);
    await expect(callbacks).toHaveAttribute(
      'data-queue-changes',
      JSON.stringify([moved, original, moved, original]),
    );
  } finally {
    await recordQueue(queue, info);
  }
});

test('composer queue: independent native pointer drop reaches the row and changes the callback order', async ({
  page,
}, info) => {
  const queue = await openQueue(page);
  const { first, second, rows, callbacks } = queue;
  try {
    await first.dragTo(second);
    await expect(rows.first()).toHaveAccessibleName('Then identify the main risks');
    await expect(rows).toHaveCount(2);
    await expect(callbacks).toHaveAttribute('data-queue-changes', JSON.stringify([moved]));
  } finally {
    const observed = await recordQueue(queue, info);
    if (info.errors.length === 0) expectNativeDrop(observed);
  }
});
