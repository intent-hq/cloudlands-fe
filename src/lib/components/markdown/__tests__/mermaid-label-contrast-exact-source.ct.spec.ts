import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import MermaidLabelContrastHost from './MermaidLabelContrastHost.svelte';
import { COMMIT_CHAIN_SOURCE, S3_LOGBOOK_SOURCE } from './mermaid-label-contrast.fixtures';

const cases: {
  name: string;
  source: string;
  labels: string[];
  fills: Record<string, string>;
}[] = [
  {
    name: 'commit chain',
    source: COMMIT_CHAIN_SOURCE,
    labels: [
      'Commit #4 (latest)',
      'Commit #3',
      'Commit #2',
      'Commit #1 (first)',
      'Tree of files',
      'File: app.js',
      'File: readme.md',
    ],
    fills: { C4: '#dbeafe', C3: '#dbeafe', C2: '#dbeafe', C1: '#dbeafe' },
  },
  {
    name: 'S3 logbook',
    source: S3_LOGBOOK_SOURCE,
    labels: [
      '☁️ S3 (the logbook — the ONE source of truth)',
      'Push #1',
      'Push #2',
      'Push #3',
      'Push #4 (newest)',
      'Machine A (disk = cache)',
      'Machine B (disk = cache)',
      'Machine C (disk = cache)',
      'Developer pushes',
      'Developer fetches',
    ],
    fills: { S3: '#fef3c7', M1: '#dcfce7', M2: '#dcfce7', M3: '#dcfce7' },
  },
];

async function readLabels(component: Locator) {
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  return component.locator('svg.flowchart').evaluate((svg) => {
    const context = document.createElement('canvas').getContext('2d')!;
    const rgba = (paint: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = paint === 'none' ? 'transparent' : paint;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (channels: number[]) => {
      const linear = channels.slice(0, 3).map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    return [...svg.querySelectorAll('g.node, g.cluster')].flatMap((owner) => {
      const label = owner.querySelector(':scope > .label, :scope > .cluster-label');
      if (!label) return [];
      const shape = owner.querySelector(
        ':scope > .label-container:not(.flowchart-node-outline), :scope > rect:not(.flowchart-node-outline)',
      )!;
      const fill = rgba(getComputedStyle(shape).fill);
      const background = luminance(fill);
      const leaves = [...label.querySelectorAll('text, tspan, foreignObject *')].filter((leaf) =>
        [...leaf.childNodes].some((child) => child.nodeType === 3 && child.textContent?.trim()),
      );
      const outlines = [...owner.querySelectorAll(':scope > .flowchart-node-outline')];
      return [
        {
          id: owner.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? owner.id,
          text: label.textContent ?? '',
          fill: `#${fill
            .slice(0, 3)
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('')}`,
          alpha: fill[3],
          // A text range can exist and have perfect contrast yet be covered by a
          // later filled decoration. Check final painted interiors separately.
          outlineAlphas: outlines.map((outline) => {
            const style = getComputedStyle(outline);
            return rgba(style.fill)[3] * Number(style.fillOpacity) * Number(style.opacity);
          }),
          labels: leaves.map((leaf) => {
            const style = getComputedStyle(leaf);
            const html = leaf.namespaceURI === 'http://www.w3.org/1999/xhtml';
            const foreground = rgba(html ? style.color : style.fill);
            const alpha = (foreground[3] / 255) * (html ? 1 : Number(style.fillOpacity));
            const painted = foreground
              .slice(0, 3)
              .map((value, i) => value * alpha + fill[i] * (1 - alpha));
            const light = luminance(painted);
            const range = document.createRange();
            range.selectNodeContents(leaf);
            const bounds = range.getBoundingClientRect();
            let visible = bounds.width > 0 && bounds.height > 0;
            for (let current: Element | null = leaf; current; current = current.parentElement) {
              const ancestor = getComputedStyle(current);
              visible &&=
                ancestor.display !== 'none' &&
                ancestor.visibility === 'visible' &&
                Number(ancestor.opacity) === 1;
            }
            return {
              visible,
              contrast: (Math.max(light, background) + 0.05) / (Math.min(light, background) + 0.05),
              lighterThanSurface: light > background,
            };
          }),
        },
      ];
    });
  });
}

for (const fixture of cases) {
  test(`exact test note ${fixture.name} labels remain painted through theme changes`, async ({
    mount,
  }) => {
    const component = await mount(MermaidLabelContrastHost, {
      props: { exactSource: fixture.source, theme: 'dark' },
    });
    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light') {
        const renderer = component.locator('.mermaid-renderer');
        const generation = await renderer.getAttribute('data-render-generation');
        await component.update({ props: { exactSource: fixture.source, theme } });
        await expect(renderer).not.toHaveAttribute('data-render-generation', generation!);
      }
      const rows = await readLabels(component);
      const normalize = (value: string) => value.replace(/\s+/g, '');
      expect(rows.map(({ text }) => normalize(text)).sort()).toEqual(
        fixture.labels.map(normalize).sort(),
      );
      for (const [id, fill] of Object.entries(fixture.fills)) {
        const row = rows.find((row) => row.id === id || row.id.endsWith(`-${id}`));
        expect(row, id).toBeDefined();
        expect(row!.fill, id).toBe(fill);
      }
      for (const row of rows) {
        const authoredFill = Object.entries(fixture.fills).find(
          ([id]) => row.id === id || row.id.endsWith(`-${id}`),
        )?.[1];
        if (authoredFill) expect(row.fill, row.text).toBe(authoredFill);
        expect(row.alpha, row.text).toBe(255);
        expect(row.labels.length, row.text).toBeGreaterThan(0);
        for (const alpha of row.outlineAlphas) expect(alpha, row.text).toBe(0);
        for (const label of row.labels) {
          expect(label.visible, row.text).toBe(true);
          expect(label.contrast, row.text).toBeGreaterThanOrEqual(4.5);
          if (theme === 'dark' && !authoredFill) {
            expect(label.lighterThanSurface, row.text).toBe(true);
          }
        }
      }
    }
  });
}
