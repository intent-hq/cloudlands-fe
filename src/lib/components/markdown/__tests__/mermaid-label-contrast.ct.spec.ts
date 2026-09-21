import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import MermaidLabelContrastHost from './MermaidLabelContrastHost.svelte';

async function expectReadableLabels(component: Locator, htmlLabels: boolean) {
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  const rows = await component.locator('svg.flowchart').evaluate((svg) => {
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
    // Fixture semantics are the independent backdrop oracle, not DOM ancestry or
    // production membership/contrast helpers (Dagre may flatten subgraphs).
    const backdrops: Record<string, string> = {
      Client: getComputedStyle(svg).backgroundColor,
      Gateway: '#fef3c7',
      Queue: '#fef3c7',
      Worker: '#fef3c7',
      Store: '#fef3c7',
      'Runtime boundary': getComputedStyle(svg).backgroundColor,
      'Worker boundary': '#fef3c7',
    };
    return [...svg.querySelectorAll('g.node, g.cluster')].flatMap((owner) => {
      const label = owner.querySelector(':scope > .label, :scope > .cluster-label');
      const name = label?.textContent?.trim().replace(/\s+/g, ' ');
      if (!label || !name || !(name in backdrops)) return [];
      const shape = owner.querySelector(':scope > .label-container, :scope > rect')!;
      const shapeStyle = getComputedStyle(shape);
      const fill = rgba(shapeStyle.fill);
      const backdrop = rgba(backdrops[name]);
      const alpha = (fill[3] / 255) * Number(shapeStyle.fillOpacity) * Number(shapeStyle.opacity);
      const effective = fill
        .slice(0, 3)
        .map((channel, i) => channel * alpha + backdrop[i] * (1 - alpha));
      const backgroundLuminance = luminance(effective);
      const leaves = [...label.querySelectorAll('text, tspan, foreignObject *')].filter((leaf) =>
        [...leaf.childNodes].some((child) => child.nodeType === 3 && child.textContent?.trim()),
      );
      return [
        {
          name,
          fill,
          outlineAlphas: [...owner.querySelectorAll(':scope > .flowchart-node-outline')].map(
            (outline) => {
              const style = getComputedStyle(outline);
              return rgba(style.fill)[3] * Number(style.fillOpacity) * Number(style.opacity);
            },
          ),
          labels: leaves.map((leaf) => {
            const style = getComputedStyle(leaf);
            const html = leaf.namespaceURI === 'http://www.w3.org/1999/xhtml';
            const foreground = rgba(html ? style.color : style.fill);
            const textAlpha = (foreground[3] / 255) * (html ? 1 : Number(style.fillOpacity));
            const painted = foreground
              .slice(0, 3)
              .map((channel, i) => channel * textAlpha + effective[i] * (1 - textAlpha));
            const textLuminance = luminance(painted);
            const range = document.createRange();
            range.selectNodeContents(leaf);
            const bounds = range.getBoundingClientRect();
            return {
              html,
              foreground,
              contrast:
                (Math.max(textLuminance, backgroundLuminance) + 0.05) /
                (Math.min(textLuminance, backgroundLuminance) + 0.05),
              visible:
                style.visibility === 'visible' &&
                Number(style.opacity) === 1 &&
                bounds.width > 0 &&
                bounds.height > 0,
            };
          }),
        },
      ];
    });
  });
  expect(rows.map(({ name }) => name).sort()).toEqual([
    'Client',
    'Gateway',
    'Queue',
    'Runtime boundary',
    'Store',
    'Worker',
    'Worker boundary',
  ]);
  for (const row of rows) {
    expect(row.labels.length, row.name).toBeGreaterThan(0);
    for (const alpha of row.outlineAlphas) expect(alpha, row.name).toBe(0);
    for (const label of row.labels) {
      expect(label.visible, row.name).toBe(true);
      expect(label.html, row.name).toBe(htmlLabels);
      expect(label.contrast, row.name).toBeGreaterThanOrEqual(4.5);
      if (row.name === 'Queue' || row.name === 'Worker') {
        expect(label.foreground).toEqual([255, 255, 255, 255]);
      }
      if (row.name === 'Worker boundary' && htmlLabels) {
        expect(label.foreground).toEqual([18, 52, 86, 255]);
      }
    }
  }
  const fills = Object.fromEntries(rows.map(({ name, fill }) => [name, fill]));
  expect(fills.Client).toEqual([219, 234, 254, 255]);
  expect(fills.Gateway).toEqual([220, 252, 231, 255]);
  expect(fills['Runtime boundary']).toEqual([254, 243, 199, 255]);
  expect(fills.Queue).toEqual([23, 37, 84, 255]);
  expect(fills.Worker).toEqual([23, 37, 84, 255]);
  expect(fills.Store[3]).toBe(0);
  expect(fills['Worker boundary'][3]).toBe(0);
}

for (const htmlLabels of [true, false]) {
  test(`keeps authored node/header contrast through live themes (HTML=${htmlLabels})`, async ({
    mount,
  }) => {
    const component = await mount(MermaidLabelContrastHost, {
      props: { theme: 'dark', htmlLabels },
    });
    await expectReadableLabels(component, htmlLabels);
    const generation = await component
      .locator('.mermaid-renderer')
      .getAttribute('data-render-generation');
    await component.update({ props: { theme: 'light', htmlLabels } });
    await expect(component.locator('.mermaid-renderer')).not.toHaveAttribute(
      'data-render-generation',
      generation!,
    );
    await expectReadableLabels(component, htmlLabels);
  });
}
