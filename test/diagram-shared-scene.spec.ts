import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL ?? 'http://127.0.0.1:5173';

for (const motion of ['full', 'reduced']) {
  test(`preserves shared Architecture paint and authored Connect membership · ${motion}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: motion === 'full' ? 'no-preference' : 'reduce' });
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=960&motion=${motion}`,
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 30_000,
    });
    const root = page.locator('#custom-architecture .diagram-renderer');
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    await root.screenshot({ path: testInfo.outputPath('orient.png') });
    const samples = await root.evaluate(async (element) => {
      const start = performance.now();
      const paint = (node: Element | null) => {
        if (!node) return { present: false, visible: false, opacity: 0, finite: false, box: null };
        let opacity = 1;
        let visible = true;
        for (let parent: Element | null = node; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          opacity *= Number(style.opacity);
          if (style.visibility === 'hidden' || style.display === 'none') visible = false;
        }
        const box = node.getBoundingClientRect();
        const rootBox = element.getBoundingClientRect();
        return {
          present: true,
          visible,
          opacity,
          box: { x: box.x - rootBox.x, y: box.y - rootBox.y },
          finite:
            [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
            (box.width > 0 || box.height > 0),
        };
      };
      const read = (stage: string) => {
        const path = element.querySelector<SVGPathElement>(
          '.diagram-edge[data-edge-id="a1"] path.edge-path',
        );
        const length = path?.getTotalLength() ?? 0;
        return {
          stage,
          elapsed: performance.now() - start,
          state: element.getAttribute('data-diagram-state'),
          phase: element.getAttribute('data-diagram-motion-phase'),
          settled: element.getAttribute('data-diagram-settled') === 'true',
          nodes: [...element.querySelectorAll('[data-node-id]')]
            .map((node) => node.getAttribute('data-node-id'))
            .sort(),
          edges: [...element.querySelectorAll('.diagram-edge')]
            .map((edge) => edge.getAttribute('data-edge-id'))
            .sort(),
          shared: ['user', 'renderer'].map((id) => ({
            id,
            ...paint(element.querySelector(`[data-node-id="${id}"]`)),
          })),
          route: { ...paint(path), length },
        };
      };
      const frames = [read('before')];
      element.querySelector<HTMLButtonElement>('[data-diagram-step-index="1"]')!.click();
      frames.push(read('sync'));
      await Promise.resolve();
      frames.push(read('microtask'));
      let settledFrames = 0;
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const frame = read('raf');
        frames.push(frame);
        settledFrames = frame.settled ? settledFrames + 1 : 0;
      } while (settledFrames < 3 && performance.now() - start < 4_000);
      return frames;
    });
    const evidencePath = testInfo.outputPath('shared-scene-frames.json');
    await writeFile(evidencePath, JSON.stringify(samples, null, 2));
    await testInfo.attach('shared-scene-frames', {
      path: evidencePath,
      contentType: 'application/json',
    });
    await root.screenshot({ path: testInfo.outputPath('connect.png') });
    const final = samples.at(-1)!;
    expect(final).toMatchObject({ state: 'connect', settled: true });
    expect.soft(final.nodes).toEqual(['daemon', 'notes', 'renderer', 'user']);
    expect.soft(final.edges).toEqual(['a1', 'a2', 'a3']);
    for (const frame of samples) {
      const evidence = JSON.stringify(frame);
      for (const node of frame.shared) {
        expect(node.present && node.visible && node.finite, evidence).toBe(true);
        expect(node.opacity, evidence).toBeGreaterThan(0.01);
      }
      expect(frame.route.present && frame.route.visible && frame.route.finite, evidence).toBe(true);
      expect(frame.route.opacity, evidence).toBeGreaterThan(0.01);
      expect(frame.route.length, evidence).toBeGreaterThan(0);
    }
    if (motion === 'full') {
      const before = samples[0];
      const afterClick = samples.find((sample) => sample.stage === 'sync')!;
      for (let index = 0; index < before.shared.length; index += 1) {
        const start = before.shared[index].box!;
        const current = afterClick.shared[index].box!;
        expect(Math.hypot(current.x - start.x, current.y - start.y)).toBeLessThanOrEqual(1);
      }
      expect(samples.some((sample) => sample.phase === 'camera' && !sample.settled)).toBe(true);
      expect(samples.some((sample) => sample.phase === 'scene' && !sample.settled)).toBe(true);
    }
  });

  test(`keeps camera start-pose through growth, shrink and interruption · ${motion}`, async ({
    page,
  }, testInfo) => {
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=960&motion=${motion}`,
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 30_000,
    });
    const root = page.locator('#custom-architecture .diagram-renderer');
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const transitions = await root.evaluate(async (element) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const read = () => {
        const outer = element.getBoundingClientRect();
        const viewport = element
          .querySelector('.diagram-scroll-container')!
          .getBoundingClientRect();
        const animations = element
          .getAnimations({ subtree: true })
          .filter((animation) =>
            Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
          );
        return {
          state: element.getAttribute('data-diagram-state'),
          phase: element.getAttribute('data-diagram-motion-phase'),
          settled: element.getAttribute('data-diagram-settled') === 'true',
          height: viewport.height,
          drawingHeight: element.querySelector('.diagram-content')!.getBoundingClientRect().height,
          animations: animations.length,
          nodes: ['user', 'renderer'].map((id) => {
            const node = element.querySelector(`[data-node-id="${id}"]`)!;
            const box = node.getBoundingClientRect();
            let opacity = 1;
            for (let parent: Element | null = node; parent; parent = parent.parentElement)
              opacity *= Number(getComputedStyle(parent).opacity);
            return {
              id,
              x: box.x - outer.x,
              y: box.y - outer.y,
              width: box.width,
              height: box.height,
              opacity,
            };
          }),
        };
      };
      const click = (index: number) => {
        const before = read();
        element.querySelector<HTMLButtonElement>(`[data-diagram-step-index="${index}"]`)!.click();
        return { before, after: read() };
      };
      const changes = [];
      for (const [step, interrupt] of [
        [1, false],
        [0, false],
        [1, true],
      ] as const) {
        const clicks = [click(step)];
        const frames = [clicks[0].after];
        const deadline = performance.now() + 4_000;
        let settled = 0;
        do {
          await nextFrame();
          const frame = read();
          frames.push(frame);
          if (interrupt && frames.length === 4) {
            clicks.push(click(0));
            frames.push(clicks.at(-1)!.after);
            settled = 0;
          } else {
            settled = frame.settled ? settled + 1 : 0;
          }
        } while ((settled < 3 || frames.length < 6) && performance.now() < deadline);
        changes.push({ step, interrupt, clicks, frames });
      }
      return changes;
    });
    await testInfo.attach('camera-resize-frames', {
      body: JSON.stringify(transitions),
      contentType: 'application/json',
    });
    const original = transitions[0].clicks[0].before;
    const grown = transitions[0].frames.at(-1)!;
    expect(grown.drawingHeight).toBeGreaterThan(original.drawingHeight);
    expect(grown.height).toBeCloseTo(original.height, 0);
    for (const change of transitions) {
      const final = change.frames.at(-1)!;
      expect(final).toMatchObject({ settled: true, animations: 0 });
      for (const frame of change.frames) {
        expect(frame.height).toBeCloseTo(original.height, 0);
        for (const node of frame.nodes) {
          expect([node.x, node.y, node.width, node.height].every(Number.isFinite)).toBe(true);
          expect(node.width).toBeGreaterThan(0);
          expect(node.height).toBeGreaterThan(0);
          expect(node.opacity).toBeGreaterThan(0.01);
        }
        if (motion === 'reduced') expect(frame.animations).toBe(0);
      }
      if (motion === 'full') {
        for (const click of change.clicks) {
          for (let index = 0; index < click.before.nodes.length; index += 1) {
            const before = click.before.nodes[index];
            const after = click.after.nodes[index];
            expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(1);
          }
        }
        if (change.interrupt) expect(change.clicks[1].before.phase).toBe('camera');
      }
      if (change.step === 0 || change.interrupt) {
        expect(final.state).toBe('orient');
        expect(final.height).toBeCloseTo(original.height, 0);
        for (let index = 0; index < final.nodes.length; index += 1) {
          expect(final.nodes[index].x).toBeCloseTo(original.nodes[index].x, 0);
          expect(final.nodes[index].y).toBeCloseTo(original.nodes[index].y, 0);
        }
      }
    }
  });
}
