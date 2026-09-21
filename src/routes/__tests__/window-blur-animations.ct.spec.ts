import { expect, test } from '../../test/ct-test';
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

test('leaves finite animations running while blurred', async ({ mount, page }) => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await mount(WindowBlurAnimationProbe);
  const loop = page.getByTestId('ambient-animation-probe');
  const oneShot = page.getByTestId('one-shot-animation-probe');
  const describe = (locator: typeof loop) =>
    locator.evaluate((node) => {
      const animation = node.getAnimations()[0];
      return {
        marked: node.hasAttribute('data-window-animation-paused'),
        iterations: animation?.effect?.getTiming().iterations,
        state: animation?.playState,
        time: Number(animation?.currentTime),
      };
    });

  await expect(oneShot).toBeVisible();
  expect((await describe(loop)).iterations).toBe(Infinity);
  expect((await describe(oneShot)).iterations).toBe(1);
  await expect.poll(async () => (await describe(oneShot)).state).toBe('running');

  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect.poll(async () => (await describe(loop)).state).toBe('paused');
  expect((await describe(loop)).marked).toBe(true);
  const blurred = await describe(oneShot);
  expect(blurred.marked).toBe(false);
  expect(blurred.state).toBe('running');
  await expect.poll(async () => (await describe(oneShot)).time).toBeGreaterThan(blurred.time);
  expect((await describe(oneShot)).marked).toBe(false);

  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(async () => (await describe(loop)).state).toBe('running');
  const focused = await describe(oneShot);
  expect(focused.marked).toBe(false);
  expect(focused.state).toBe('running');
});

for (const activation of ['mounted', 'class-change'] as const) {
  test(`leaves delayed finite animations ${activation} while blurred running`, async ({
    mount,
    page,
  }) => {
    await mount(WindowBlurAnimationProbe);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-window-blurred', '');
      const style = document.createElement('style');
      style.textContent = `
        @keyframes delayed-motion { to { opacity: .5; } }
        .delayed-probe, .delayed-probe::before, .delayed-probe::after {
          content: ''; display: block; width: 10px; height: 10px;
          animation: delayed-motion 1s linear 60s both;
        }
      `;
      document.head.append(style);
    });
    if (activation === 'class-change') {
      await page.evaluate(() => {
        const node = document.createElement('div');
        node.id = 'delayed-probe';
        document.body.append(node);
      });
    }
    await page.evaluate((mode) => {
      const node =
        mode === 'mounted'
          ? document.createElement('div')
          : document.getElementById('delayed-probe')!;
      node.id = 'delayed-probe';
      node.className = 'delayed-probe';
      if (mode === 'mounted') document.body.append(node);
    }, activation);
    const probe = page.locator('#delayed-probe');
    const marked = () =>
      probe.evaluate((node) => node.hasAttribute('data-window-animation-paused'));
    const animations = () =>
      probe.evaluate((node) =>
        node.getAnimations({ subtree: true }).map((animation) => ({
          state: animation.playState,
          time: Number(animation.currentTime),
        })),
      );
    await expect.poll(async () => (await animations()).length).toBe(3);
    const before = await animations();
    expect(before.map((animation) => animation.state)).toEqual(['running', 'running', 'running']);
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    });
    const after = await animations();
    expect(after.map((animation) => animation.state)).toEqual(['running', 'running', 'running']);
    for (const [index, animation] of after.entries()) {
      expect(animation.time).toBeGreaterThan(before[index].time);
    }
    expect(await marked()).toBe(false);
    await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
    await expect
      .poll(async () => (await animations()).map((animation) => animation.state))
      .toEqual(['running', 'running', 'running']);
    expect(await marked()).toBe(false);
  });
}

test('lets a short finite animation finish while blurred and does not replay it on focus', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await mount(WindowBlurAnimationProbe);
  const loop = page.getByTestId('ambient-animation-probe');
  const shortOneShot = page.getByTestId('short-one-shot-animation-probe');
  const loopPlayState = () => loop.evaluate((node) => node.getAnimations()[0]?.playState);
  const describeShortOneShot = () =>
    shortOneShot.evaluate((node) => {
      const animation = node.getAnimations()[0];
      return {
        marked: node.hasAttribute('data-window-animation-paused'),
        count: node.getAnimations().length,
        state: animation?.playState,
        time: Number(animation?.currentTime),
      };
    });

  await expect(shortOneShot).toBeVisible();
  await expect.poll(loopPlayState).toBe('paused');
  await expect.poll(async () => (await describeShortOneShot()).state).toBe('finished');
  const finishedWhileBlurred = await describeShortOneShot();
  expect(finishedWhileBlurred.marked).toBe(false);
  expect(finishedWhileBlurred.count).toBe(1);

  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(loopPlayState).toBe('running');
  expect(await describeShortOneShot()).toEqual(finishedWhileBlurred);
});

test('marks only the loop when a loop and a one-shot start while blurred', async ({
  mount,
  page,
}) => {
  await mount(WindowBlurAnimationProbe);
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
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
      @keyframes late-motion { to { opacity: .5; } }
      #late-loop { width: 10px; height: 10px; animation: late-motion 10s linear infinite; }
      #late-one-shot { width: 10px; height: 10px; animation: late-motion 10s linear both; }
    `;
    document.head.append(style);
    for (const id of ['late-loop', 'late-one-shot']) {
      const node = document.createElement('div');
      node.id = id;
      document.body.append(node);
    }
  });
  const describe = (id: string) =>
    page.locator(`#${id}`).evaluate((node) => {
      const animation = node.getAnimations()[0];
      return {
        marked: node.hasAttribute('data-window-animation-paused'),
        state: animation?.playState,
        time: Number(animation?.currentTime),
      };
    });
  await expect.poll(async () => (await describe('late-loop')).state).toBe('paused');
  expect((await describe('late-loop')).marked).toBe(true);
  const oneShot = await describe('late-one-shot');
  expect(oneShot.marked).toBe(false);
  expect(oneShot.state).toBe('running');
  await expect
    .poll(async () => (await describe('late-one-shot')).time)
    .toBeGreaterThan(oneShot.time);
  expect((await describe('late-one-shot')).marked).toBe(false);
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(async () => (await describe('late-loop')).state).toBe('running');
  expect((await describe('late-one-shot')).state).toBe('running');
});

for (const activation of ['class-change', 'stylesheet'] as const) {
  test(`unmarks a paused loop replaced by a finite animation via ${activation} while blurred`, async ({
    mount,
    page,
  }) => {
    const component = await mount(WindowBlurAnimationProbe);
    const probe = page.getByTestId('ambient-animation-probe');
    const describe = () =>
      probe.evaluate((node) => {
        const animations = node.getAnimations();
        const animation = animations[0];
        return {
          marked: node.hasAttribute('data-window-animation-paused'),
          count: animations.length,
          iterations: animation?.effect?.getTiming().iterations,
          state: animation?.playState,
          time: Number(animation?.currentTime),
        };
      });

    await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
    await expect.poll(async () => (await describe()).state).toBe('paused');
    expect((await describe()).marked).toBe(true);

    if (activation === 'class-change') {
      await component.update({ props: { loopReplacedByOneShot: true } });
    } else {
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = `
          @keyframes swapped-motion { to { transform: translateX(1rem); } }
          [data-testid='ambient-animation-probe'] {
            animation: swapped-motion 300ms linear both !important;
          }
        `;
        document.head.append(style);
      });
    }
    await expect.poll(async () => (await describe()).iterations).toBe(1);
    await expect.poll(async () => (await describe()).marked).toBe(false);
    await expect.poll(async () => (await describe()).state).toBe('finished');
    const finishedWhileBlurred = await describe();
    expect(finishedWhileBlurred.count).toBe(1);

    await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    });
    expect(await describe()).toEqual(finishedWhileBlurred);
  });
}
