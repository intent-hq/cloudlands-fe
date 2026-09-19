import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DIAGRAM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const artifactRoot = process.env.DIAGRAM_SOAK_ARTIFACT_DIR;
const widths = [960, 640, 420, 320] as const;
const appearances = [
  { id: 'light', mode: 'light', colorTheme: 'Default' },
  { id: 'dark', mode: 'dark', colorTheme: 'Default' },
  { id: 'nord', mode: 'light', colorTheme: 'Nord' },
] as const;
const caseIds = Object.keys(DIAGRAM_WORKBENCH_CASES);

test.skip(!baseUrl || !artifactRoot, 'Set UI_PREVIEW_BASE_URL and DIAGRAM_SOAK_ARTIFACT_DIR.');
test.describe.configure({ mode: 'serial', timeout: 30 * 60_000 });

async function openMatrixState(
  page: Page,
  appearance: (typeof appearances)[number],
  width: number,
) {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${caseIds[0]}&theme=${appearance.mode}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  const scene = page.getByTestId('catalog-scene');
  if (!(await scene.isVisible({ timeout: 1_000 }).catch(() => false))) await page.reload();
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 120_000 });
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
    { timeout: 120_000 },
  );
  const control = page.getByTestId('catalog-color-theme-control');
  if (!(await control.textContent())?.includes(appearance.colorTheme)) {
    await control.click();
    await page.getByRole('option', { name: appearance.colorTheme, exact: true }).click();
  }
  await expect(control).toContainText(appearance.colorTheme);
  await page.locator('.catalog-topbar').evaluate((topbar) => {
    (topbar as HTMLElement).hidden = true;
  });
  await expect(page.locator('.catalog-topbar')).toBeHidden();
  await page.waitForFunction(
    ({ mermaidCount, customCount }) => {
      const unexpectedError = [...document.querySelectorAll('[role="alert"]')].some(
        (error) => error.closest('[data-diagram-case]')?.id !== 'mermaid-invalid-source',
      );
      return (
        document.querySelectorAll('.mermaid-renderer').length === mermaidCount &&
        document.querySelectorAll('.diagram-renderer').length === customCount &&
        !document.querySelector('.mermaid-loading') &&
        !unexpectedError
      );
    },
    {
      mermaidCount: Object.values(DIAGRAM_WORKBENCH_CASES).filter(({ kind }) => kind === 'mermaid')
        .length,
      customCount: Object.values(DIAGRAM_WORKBENCH_CASES).filter(
        ({ id, kind }) => kind === 'custom' && id !== 'custom-empty-content',
      ).length,
    },
    { timeout: 120_000 },
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await waitForStableGeometry(page);
}

async function waitForStableGeometry(page: Page) {
  let previous: string | undefined;
  for (let frame = 0; frame < 120; frame += 1) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const current = await page.evaluate(() =>
      [...document.querySelectorAll<SVGGraphicsElement | HTMLElement>('.diagram-stage *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return [
            element.tagName,
            element.getAttribute('class'),
            element.getAttribute('d'),
            rect.x.toFixed(3),
            rect.y.toFixed(3),
            rect.width.toFixed(3),
            rect.height.toFixed(3),
          ].join('|');
        })
        .join('\n'),
    );
    if (current === previous) return;
    previous = current;
  }
  expect(false, 'diagram geometry did not stabilize across painted frames').toBe(true);
}

async function captureStable(locator: Locator, file: string) {
  await expect(locator.page().locator('.catalog-topbar')).toBeHidden();
  let previous = await locator.screenshot({ animations: 'disabled' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await locator
      .page()
      .evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    const current = await locator.screenshot({ animations: 'disabled' });
    if (current.equals(previous)) {
      await writeFile(file, current);
      return;
    }
    previous = current;
  }
  expect(false, `${file} did not produce two consecutive stable frames`).toBe(true);
}

async function inspectGeometry(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const transparent = 'rgba(0, 0, 0, 0)';
    const intersects = (a: DOMRect, b: DOMRect, padding = 0) =>
      a.left < b.right + padding &&
      a.right > b.left - padding &&
      a.top < b.bottom + padding &&
      a.bottom > b.top - padding;
    const fits = (outer: DOMRect, inner: DOMRect, tolerance = 1) =>
      inner.left >= outer.left - tolerance &&
      inner.top >= outer.top - tolerance &&
      inner.right <= outer.right + tolerance &&
      inner.bottom <= outer.bottom + tolerance;
    const distanceToPath = (path: SVGGeometryElement, x: number, y: number) => {
      const length = path.getTotalLength();
      const matrix = path.getScreenCTM() ?? new DOMMatrix();
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index <= 600; index += 1) {
        const point = path.getPointAtLength((length * index) / 600).matrixTransform(matrix);
        distance = Math.min(distance, Math.hypot(x - point.x, y - point.y));
      }
      return distance;
    };
    const pathSegments = (path: SVGGeometryElement) => {
      const length = path.getTotalLength();
      const steps = Math.max(2, Math.ceil(length / 12));
      const matrix = path.getScreenCTM() ?? new DOMMatrix();
      const points = Array.from({ length: steps + 1 }, (_, index) => {
        const point = path.getPointAtLength((length * index) / steps).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      });
      return points.slice(0, -1).map((start, index) => ({
        start,
        end: points[index + 1],
        startDistance: (length * index) / steps,
        endDistance: (length * (index + 1)) / steps,
        totalLength: length,
      }));
    };
    const segmentsCross = (
      first: ReturnType<typeof pathSegments>[number],
      second: ReturnType<typeof pathSegments>[number],
    ) => {
      const ax = first.end.x - first.start.x;
      const ay = first.end.y - first.start.y;
      const bx = second.end.x - second.start.x;
      const by = second.end.y - second.start.y;
      const denominator = ax * by - ay * bx;
      if (Math.abs(denominator) < 0.05) return false;
      const dx = second.start.x - first.start.x;
      const dy = second.start.y - first.start.y;
      const firstRatio = (dx * by - dy * bx) / denominator;
      const secondRatio = (dx * ay - dy * ax) / denominator;
      if (firstRatio <= 0 || firstRatio >= 1 || secondRatio <= 0 || secondRatio >= 1) return false;
      const firstDistance =
        first.startDistance + (first.endDistance - first.startDistance) * firstRatio;
      const secondDistance =
        second.startDistance + (second.endDistance - second.startDistance) * secondRatio;
      return (
        firstDistance > 14 &&
        firstDistance < first.totalLength - 14 &&
        secondDistance > 14 &&
        secondDistance < second.totalLength - 14
      );
    };

    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      issues.push('document: horizontal overflow');
    }

    for (const root of document.querySelectorAll<HTMLElement>('[data-diagram-case]')) {
      const id = root.dataset.diagramCase ?? 'unknown';
      const stage = root.querySelector<HTMLElement>('.diagram-stage');
      if (!stage) {
        issues.push(`${id}: missing stage`);
        continue;
      }
      if (getComputedStyle(stage).backgroundColor !== transparent) {
        issues.push(`${id}: non-transparent stage`);
      }

      const mermaid = root.querySelector<HTMLElement>('.mermaid-renderer');
      if (mermaid) {
        const svg = mermaid.querySelector<SVGSVGElement>('.mermaid-svg > svg');
        if (!svg && !root.querySelector('.mermaid-error, .mermaid-empty')) {
          issues.push(`${id}: missing Mermaid output`);
          continue;
        }
        if (!svg) continue;
        if (getComputedStyle(svg).backgroundColor !== transparent) {
          issues.push(`${id}: non-transparent Mermaid canvas`);
        }
        const mermaidLabels = [
          ...svg.querySelectorAll<HTMLElement>('foreignObject span.edgeLabel'),
        ].filter((label) => label.innerText.trim().length > 0);
        for (const label of mermaidLabels) {
          const viewport = label.closest('foreignObject')?.getBoundingClientRect();
          if (viewport && !fits(viewport, label.getBoundingClientRect())) {
            issues.push(`${id}: clipped Mermaid edge label ${label.innerText.trim()}`);
          }
        }
        const mermaidLabelRects = mermaidLabels.map((label) => label.getBoundingClientRect());
        mermaidLabelRects.forEach((label, index) => {
          mermaidLabelRects.slice(index + 1).forEach((other, otherIndex) => {
            if (intersects(label, other, 1)) {
              issues.push(`${id}: Mermaid labels ${index}/${index + otherIndex + 1} overlap`);
            }
          });
        });
        for (const edge of svg.querySelectorAll<SVGGeometryElement>(
          '.flowchart-link, .edgePaths path, .messageLine0, .messageLine1, .actor-line',
        )) {
          const style = getComputedStyle(edge);
          const strokeWidth = Number.parseFloat(style.strokeWidth);
          if (style.stroke !== 'none' && (strokeWidth < 1 || strokeWidth > 1.25)) {
            issues.push(`${id}: connector is ${style.strokeWidth}`);
          }
        }
        continue;
      }

      const renderer = root.querySelector<HTMLElement>('.diagram-renderer');
      if (!renderer) continue;
      const nodes = [...renderer.querySelectorAll<HTMLElement>('.diagram-node-html')];
      const labels = [
        ...renderer.querySelectorAll<SVGForeignObjectElement>('.edge-label-container'),
      ];
      const paths = [...renderer.querySelectorAll<SVGPathElement>('.diagram-edge .edge-path')];
      const nodeRects = nodes.map((node) => node.getBoundingClientRect());
      const labelRects = labels.map((label) => label.getBoundingClientRect());

      nodes.forEach((node, index) => {
        const text = [...node.querySelectorAll<HTMLElement>('.node-label, .node-kind-label')];
        if (text.some((element) => !fits(nodeRects[index], element.getBoundingClientRect(), 1))) {
          issues.push(`${id}: clipped node ${index}`);
        }
        nodeRects.slice(index + 1).forEach((other, otherIndex) => {
          if (intersects(nodeRects[index], other, 1)) {
            issues.push(`${id}: nodes ${index}/${index + otherIndex + 1} overlap`);
          }
        });
      });

      labels.forEach((label, index) => {
        const content = label.querySelector<HTMLElement>('.edge-label-html');
        const edgeId = label.dataset.edgeId ?? '';
        const edge = renderer.querySelector<SVGGeometryElement>(
          `.diagram-edge[data-edge-id="${CSS.escape(edgeId)}"] .edge-path`,
        );
        if (!content || !fits(labelRects[index], content.getBoundingClientRect(), 1)) {
          issues.push(`${id}: clipped edge label ${edgeId}`);
        }
        if (edge) {
          const bounds = labelRects[index];
          const distance = distanceToPath(
            edge,
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          );
          if (distance > 1.1) issues.push(`${id}: detached edge label ${edgeId} (${distance})`);
        }
        nodeRects.forEach((node, nodeIndex) => {
          if (intersects(labelRects[index], node, 1)) {
            issues.push(`${id}: edge label ${edgeId} overlaps node ${nodeIndex}`);
          }
        });
        labelRects.slice(index + 1).forEach((other, otherIndex) => {
          if (intersects(labelRects[index], other, 1)) {
            issues.push(
              `${id}: labels ${edgeId}/${labels[index + otherIndex + 1]?.dataset.edgeId} overlap`,
            );
          }
        });
      });

      paths.forEach((edge) => {
        const strokeWidth = Number.parseFloat(getComputedStyle(edge).strokeWidth);
        if (strokeWidth < 1 || strokeWidth > 1.25) {
          issues.push(`${id}: custom connector is ${strokeWidth}px`);
        }
      });
      const segmentSets = paths.map(pathSegments);
      if (!renderer.classList.contains('compact-diagram'))
        segmentSets.forEach((segments, index) => {
          segmentSets.slice(index + 1).forEach((otherSegments, otherIndex) => {
            const sameTerminals =
              Math.hypot(
                segments[0].start.x - otherSegments[0].start.x,
                segments[0].start.y - otherSegments[0].start.y,
              ) <= 1 &&
              Math.hypot(
                segments.at(-1)!.end.x - otherSegments.at(-1)!.end.x,
                segments.at(-1)!.end.y - otherSegments.at(-1)!.end.y,
              ) <= 1;
            if (
              !sameTerminals &&
              segments.some((segment) =>
                otherSegments.some((other) => segmentsCross(segment, other)),
              )
            ) {
              const firstId = paths[index].closest<SVGGElement>('.diagram-edge')?.dataset.edgeId;
              const secondId =
                paths[index + otherIndex + 1].closest<SVGGElement>('.diagram-edge')?.dataset.edgeId;
              issues.push(`${id}: routes ${firstId}/${secondId} cross away from terminals`);
            }
          });
        });
      const content = renderer.querySelector<HTMLElement>('.diagram-content');
      const footer = renderer.querySelector<HTMLElement>('.diagram-footer');
      if (
        content &&
        footer &&
        content.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 1
      ) {
        issues.push(`${id}: content overlaps footer`);
      }
    }
    return issues;
  });
}

async function captureInteractionStates(page: Page, passDirectory: string) {
  await openMatrixState(page, appearances[1], 320);
  const binding = page.locator('#custom-bindings').getByRole('button', {
    name: /open review retry criteria note binding/i,
  });
  await page.keyboard.press('Tab');
  await binding.focus();
  await expect(binding).toBeFocused();
  await expect(binding).toHaveCSS('outline-style', 'solid');
  await captureStable(page.locator('#custom-bindings'), path.join(passDirectory, 'focus.png'));

  const walkthrough = page.locator('#custom-walkthrough');
  await walkthrough.locator('[data-diagram-step-index="2"]').click();
  const fitButton = walkthrough.locator('.diagram-fit-button');
  if ((await fitButton.getAttribute('aria-pressed')) !== 'true') await fitButton.click();
  await expect(walkthrough.locator('[data-diagram-step-index="2"]')).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(fitButton).toHaveAttribute('aria-pressed', 'true');
  await captureStable(walkthrough, path.join(passDirectory, 'walkthrough-step-3-fit.png'));

  const flow = page.locator('#mermaid-flow');
  await flow.locator('.mermaid-svg-container').hover();
  const sourceButton = flow.getByRole('button', { name: 'View source' });
  await sourceButton.click();
  await expect(sourceButton).toHaveAttribute('aria-pressed', 'true');
  await expect(flow.locator('pre')).toBeVisible();
  await captureStable(flow, path.join(passDirectory, 'mermaid-source.png'));
}

async function runPass(page: Page, pass: number) {
  const passDirectory = path.resolve(artifactRoot!, `pass-${pass}`);
  await mkdir(passDirectory, { recursive: true });
  const inventory: Array<{ caseId: string; appearance: string; width: number; file: string }> = [];
  const issueInventory: Array<{ appearance: string; width: number; issues: string[] }> = [];

  for (const appearance of appearances) {
    for (const width of widths) {
      await openMatrixState(page, appearance, width);
      const directory = path.join(passDirectory, appearance.id, String(width));
      await mkdir(directory, { recursive: true });
      const issues = await inspectGeometry(page);
      issueInventory.push({ appearance: appearance.id, width, issues });
      for (const caseId of caseIds) {
        const file = path.join(directory, `${caseId}.png`);
        await captureStable(page.locator(`#${caseId}`), file);
        inventory.push({ caseId, appearance: appearance.id, width, file });
      }
      expect.soft(issues, `${appearance.id}/${width} geometry`).toEqual([]);
    }
  }

  await captureInteractionStates(page, passDirectory);
  await writeFile(
    path.join(passDirectory, 'inventory.json'),
    `${JSON.stringify({ pass, widths, appearances, caseCount: caseIds.length, inventory }, null, 2)}\n`,
  );
  await writeFile(
    path.join(passDirectory, 'issues.json'),
    `${JSON.stringify(issueInventory, null, 2)}\n`,
  );
  expect(inventory).toHaveLength(caseIds.length * widths.length * appearances.length);
}

test('full visual and geometry soak pass 1 is clean', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1200 });
  await runPass(page, 1);
});

test('full visual and geometry soak pass 2 confirms the clean result', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1200 });
  await runPass(page, 2);
});
