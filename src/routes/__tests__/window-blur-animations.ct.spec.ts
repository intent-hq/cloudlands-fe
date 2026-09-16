import { expect, test } from '@playwright/experimental-ct-svelte';
import IntentMarkLoader from '$lib/components/ui/indicators/IntentMarkLoader.svelte';
import WindowBlurAnimationProbe from './WindowBlurAnimationProbe.svelte';

test.afterEach(async ({ page }) => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
});

test('pauses ambient animations while the window-blurred attribute is present', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await mount(WindowBlurAnimationProbe);
  const probe = page.getByTestId('ambient-animation-probe');
  const playState = () => probe.evaluate((node) => node.getAnimations()[0]?.playState);

  await expect(probe).toBeVisible();
  const initial = await probe.evaluate((node) => ({
    animation: getComputedStyle(node).animationName,
    count: node.getAnimations().length,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  expect(initial.animation).not.toBe('none');
  expect(initial.count).toBe(1);
  expect(initial.reducedMotion).toBe(false);
  await expect.poll(playState).toBe('running');
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect.poll(playState).toBe('paused');
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(playState).toBe('running');
});

test('stops the main-thread mark pose driver while the window-blurred attribute is present', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await mount(IntentMarkLoader, { props: { variant: 'bloom', size: 128, playing: true } });
  const root = page.getByRole('status', { name: 'Loading' });
  const animationCount = () =>
    root.evaluate((node) => node.getAnimations({ subtree: true }).length);
  const poseWritesOver = (windowMs: number) =>
    root.evaluate(
      (node, duration) =>
        new Promise<number>((resolve) => {
          const arm = node.querySelector<SVGPathElement>('[data-mark-arm]')!;
          let writes = 0;
          let last = arm.style.transform;
          const observer = new MutationObserver(() => {
            if (arm.style.transform === last) return;
            last = arm.style.transform;
            writes += 1;
          });
          observer.observe(arm, { attributes: true, attributeFilter: ['style'] });
          window.setTimeout(() => {
            observer.disconnect();
            resolve(writes);
          }, duration);
        }),
      windowMs,
    );

  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await expect.poll(() => poseWritesOver(200)).toBeGreaterThan(0);
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  await expect.poll(animationCount).toBe(0);
  expect(await poseWritesOver(500)).toBe(0);
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await expect.poll(() => poseWritesOver(200)).toBeGreaterThan(0);
});

test('focus changes do not recalculate styles across a static transcript', async ({
  mount,
  page,
}) => {
  await mount(WindowBlurAnimationProbe);
  await page.evaluate(() => {
    const transcript = document.createElement('section');
    for (let i = 0; i < 2_000; i++) {
      const row = document.createElement('p');
      row.textContent = `Transcript row ${i}`;
      transcript.append(row);
    }
    document.body.append(transcript);
    // Flush insertion before measuring the focus change itself.
    transcript.getBoundingClientRect();
  });

  const cdp = await page.context().newCDPSession(page);
  const recalculations: number[] = [];
  cdp.on('Tracing.dataCollected', ({ value }) => {
    for (const event of value) {
      if (event.name === 'UpdateLayoutTree') recalculations.push(event.args.elementCount ?? 0);
    }
  });
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline',
    transferMode: 'ReportEvents',
  });
  try {
    for (const blurred of [true, false]) {
      await page.evaluate(async (value) => {
        document.documentElement.toggleAttribute('data-window-blurred', value);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        document.body.getBoundingClientRect();
      }, blurred);
    }
  } finally {
    const complete = new Promise<void>((resolve) =>
      cdp.once('Tracing.tracingComplete', () => resolve()),
    );
    await cdp.send('Tracing.end');
    await complete;
    await cdp.detach();
  }
  await test.info().attach('focus-style-recalculations', {
    body: JSON.stringify({ recalculations }),
    contentType: 'application/json',
  });
  expect(recalculations.length).toBeGreaterThan(0);
  // The animation may restyle; thousands of unchanged transcript rows must not.
  expect(Math.max(...recalculations)).toBeLessThan(100);
});

test('restores authored pause state and leaves subsequent CSS changes in control', async ({
  mount,
  page,
}) => {
  await mount(WindowBlurAnimationProbe);
  const probe = page.getByTestId('ambient-animation-probe');
  const playState = () => probe.evaluate((node) => node.getAnimations()[0]?.playState);
  await probe.evaluate((node) => {
    node.style.animationPlayState = 'paused';
  });
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect.poll(playState).toBe('paused');
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(playState).toBe('paused');
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  // A component cannot resume an already-started animation while the window is blurred.
  await probe.evaluate((node) => {
    node.style.animationPlayState = 'running';
  });
  await expect.poll(playState).toBe('paused');
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(playState).toBe('running');
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect.poll(playState).toBe('paused');
  // Component changes while blurred must survive removal of the window override.
  await probe.evaluate((node) => {
    node.style.animationPlayState = 'paused';
  });
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(playState).toBe('paused');
});

test('pauses newly mounted animations and pseudo-elements while blurred', async ({
  mount,
  page,
}) => {
  await mount(WindowBlurAnimationProbe);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-window-blurred', '');
  });
  await expect
    .poll(() =>
      page
        .getByTestId('ambient-animation-probe')
        .evaluate((node) => node.getAnimations()[0]?.playState),
    )
    .toBe('paused');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes added-motion { to { opacity: .5; } }
      #added-animation, #added-animation::before, #added-animation::after {
        content: ''; display: block; width: 10px; height: 10px;
        animation: added-motion 10s linear infinite;
      }
    `;
    document.head.append(style);
    const node = document.createElement('div');
    node.id = 'added-animation';
    document.body.append(node);
  });
  const states = () =>
    page
      .locator('#added-animation')
      .evaluate((node) =>
        node.getAnimations({ subtree: true }).map((animation) => animation.playState),
      );
  await expect.poll(states).toEqual(['paused', 'paused', 'paused']);
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(states).toEqual(['running', 'running', 'running']);
});

test('teardown resumes retained targets and removes the focus observer', async ({
  mount,
  page,
}) => {
  const component = await mount(WindowBlurAnimationProbe);
  await page.getByTestId('ambient-animation-probe').evaluate((node) => {
    const retained = node.cloneNode(true) as HTMLElement;
    retained.id = 'retained-animation';
    retained.removeAttribute('data-testid');
    document.body.append(retained);
  });
  const state = () =>
    page.locator('#retained-animation').evaluate((node) => node.getAnimations()[0]?.playState);
  await expect.poll(state).toBe('running');
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect.poll(state).toBe('paused');
  await component.unmount();
  await expect.poll(state).toBe('running');
  await page.evaluate(async () => {
    document.documentElement.removeAttribute('data-window-blurred');
    await Promise.resolve();
    document.documentElement.setAttribute('data-window-blurred', '');
  });
  await expect.poll(state).toBe('running');
});
