import { test } from '@playwright/experimental-ct-svelte';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This helper executes in Playwright's Node test process.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This helper executes in Playwright's Node test process.
import { basename, dirname } from 'node:path';
import CatalogScene from './CatalogScene.svelte';
import type { GeometryProbeResult } from './geometry-probe';

type GeometrySnapshot = Record<string, Record<string, GeometryProbeResult>>;

export interface GeometrySnapshotSuiteOptions {
  preview: () => Promise<unknown>;
  states?: string[];
  widths?: number[];
  selector?: string;
  snapshotPath: string;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sorted(child)]),
  );
}

function flatten(result: GeometryProbeResult | undefined): Map<string, number> {
  const fields = new Map<string, number>();
  if (!result) return fields;
  for (const [field, value] of Object.entries(result.root)) fields.set(`root.${field}`, value);
  for (const [key, measurement] of Object.entries(result.probes)) {
    for (const [field, value] of Object.entries(measurement)) fields.set(`${key}.${field}`, value);
  }
  return fields;
}

function display(value: number | undefined): string {
  return value === undefined ? '<missing>' : String(value);
}

function geometrySnapshotDifferences(
  expected: GeometrySnapshot,
  actual: GeometrySnapshot,
): string[] {
  const differences: string[] = [];
  const states = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const state of [...states].sort()) {
    const expectedWidths = expected[state] ?? {};
    const actualWidths = actual[state] ?? {};
    const widths = new Set([...Object.keys(expectedWidths), ...Object.keys(actualWidths)]);
    for (const width of [...widths].sort((left, right) => Number(left) - Number(right))) {
      const expectedFields = flatten(expectedWidths[width]);
      const actualFields = flatten(actualWidths[width]);
      const paths = new Set([...expectedFields.keys(), ...actualFields.keys()]);
      for (const path of [...paths].sort()) {
        const expectedValue = expectedFields.get(path);
        const actualValue = actualFields.get(path);
        if (
          expectedValue === undefined ||
          actualValue === undefined ||
          Math.abs(expectedValue - actualValue) > 1
        ) {
          differences.push(
            `${state}/${width}/${path} ${display(expectedValue)}→${display(actualValue)}`,
          );
        }
      }
    }
  }
  return differences;
}

export function defineGeometrySnapshotSuite(options: GeometrySnapshotSuiteOptions): void {
  const name = basename(options.snapshotPath, '.json');
  test(`${name} geometry snapshot`, async ({ mount, page }) => {
    const slug = name.replace(/\.geometry$/, '');
    const widths = options.widths ?? [420];
    let stateNames = options.states;
    if (!stateNames) {
      const catalog = await mount(CatalogScene, { props: { slug, requestedWidth: widths[0] } });
      try {
        await page.locator(`[data-preview-slug="${slug}"][data-preview-ready="true"]`).waitFor();
        stateNames = (
          await catalog.locator('nav[aria-label="Preview states"] a').allTextContents()
        ).slice(1);
      } finally {
        await catalog.unmount();
      }
    }
    const actual: GeometrySnapshot = {};

    for (const stateName of stateNames) {
      actual[stateName] = {};
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1200 });
        const component = await mount(CatalogScene, {
          props: {
            slug,
            requestedState: stateName,
            requestedWidth: width,
            requestedFit: 'component',
          },
        });
        try {
          await page.locator(`[data-preview-slug="${slug}"][data-preview-ready="true"]`).waitFor();
          actual[stateName][String(width)] = await page.evaluate((requestedSelector) => {
            const result = window.__INTENT_PREVIEW__?.probe({
              ...(requestedSelector ? { selector: requestedSelector } : {}),
            });
            if (!result) throw new Error('The mounted preview has no active geometry probe.');
            const { slug: _slug, state: _state, width: _width, ...geometry } = result;
            return geometry;
          }, options.selector);
        } finally {
          await component.unmount();
        }
      }
    }

    if (process.env.SANDBOX_GEOMETRY_UPDATE === '1') {
      mkdirSync(dirname(options.snapshotPath), { recursive: true });
      writeFileSync(options.snapshotPath, `${JSON.stringify(sorted(actual), null, 2)}\n`);
      return;
    }

    let expected: GeometrySnapshot;
    try {
      expected = JSON.parse(readFileSync(options.snapshotPath, 'utf8')) as GeometrySnapshot;
    } catch (error) {
      throw new Error(`Unable to read geometry snapshot ${options.snapshotPath}.`, {
        cause: error,
      });
    }
    const differences = geometrySnapshotDifferences(expected, actual);
    if (differences.length)
      throw new Error(`Geometry snapshot mismatch:\n${differences.join('\n')}`);
  });
}
