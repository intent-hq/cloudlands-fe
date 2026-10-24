import { expect, test } from '../../../../test/ct-test';
import StreamingTypingOperationalGeometryHost from './StreamingTypingOperationalGeometryHost.svelte';

test.setTimeout(120_000);

test('runs the mark only while active and holds neutral for reduced motion', async ({
  mount,
  page,
}) => {
  const component = await mount(StreamingTypingOperationalGeometryHost);
  const mark = component.locator('[data-slot="intent-mark-loader"]');
  await expect(mark).toHaveAttribute('data-motion-state', 'playing');
  expect(
    await mark.evaluate((node) =>
      Array.from(node.querySelectorAll<SVGPathElement>('[data-mark-arm]')).map(
        (arm) => arm.style.transform !== '' && arm.style.willChange === '',
      ),
    ),
  ).toEqual([true, true, true, true, true]);
  expect(await mark.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  await mark.evaluate(
    (node) => ((window as typeof window & { thinkingRoot?: Element }).thinkingRoot = node),
  );
  await component.update({ props: { mode: 'permission' } });
  await expect(mark).toHaveAttribute('data-playing', 'false');
  await expect(mark).toHaveAttribute('data-motion-state', 'settling');
  await component.update({ props: { mode: 'streaming' } });
  await expect(mark).toHaveAttribute('data-playing', 'true');
  await expect(mark).toHaveAttribute('data-motion-state', 'playing');
  expect(
    await mark.evaluate(
      (node) => (window as typeof window & { thinkingRoot?: Element }).thinkingRoot === node,
    ),
  ).toBe(true);

  await component.update({ props: { mode: 'error' } });
  await expect(mark).toHaveAttribute('data-motion-state', 'settling');
  await expect(component.getByRole('alert')).toContainText("Couldn't complete this response");
  await component.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(component.getByTestId('failure-raw-details')).toHaveText(
    'Provider stopped the response',
  );
  await expect(mark).toHaveCount(0);
  await component.update({ props: { mode: 'processing' } });
  await expect(component.locator('[data-slot="intent-mark-loader"]')).toHaveAttribute(
    'data-motion-state',
    'playing',
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMark = component.locator('[data-slot="intent-mark-loader"]');
  await expect(reducedMark).toHaveAttribute('data-motion-state', 'neutral');
  expect(await reducedMark.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(
    0,
  );
});

test('updates localized phases, omits missing detail, and truncates without overflow', async ({
  mount,
}) => {
  const component = await mount(StreamingTypingOperationalGeometryHost, {
    props: {
      mode: 'processing',
      phaseMessage: 'Solicitud enviada al modelo…',
      width: 160,
      zoom: 2,
    },
  });

  await expect(component.getByTestId('streaming-status-thinking-label')).toHaveText('Thinking');
  const lifecycle = component.getByTestId('streaming-status-phase');
  await expect(lifecycle).toHaveText('Solicitud enviada al modelo…');
  const truncation = await lifecycle.evaluate((node) => {
    const style = getComputedStyle(node);
    const row = node.closest('[data-streaming-typing-row]')!;
    return {
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      clipped: node.scrollWidth > node.clientWidth,
      rowContained: row.scrollWidth <= row.clientWidth,
    };
  });
  expect(truncation).toEqual({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    clipped: true,
    rowContained: true,
  });

  await component.update({
    props: {
      mode: 'streaming',
      phaseMessage: 'Transmitiendo respuesta…',
      width: 160,
      zoom: 2,
    },
  });
  await expect(component.getByTestId('streaming-status-phase')).toHaveText(
    'Transmitiendo respuesta…',
  );

  await component.update({
    props: { mode: 'streaming', phaseMessage: null, width: 160, zoom: 2 },
  });
  await expect(component.getByTestId('streaming-status-phase')).toHaveCount(0);
  await expect(component.getByRole('status')).toHaveAccessibleName('Loading');
});
