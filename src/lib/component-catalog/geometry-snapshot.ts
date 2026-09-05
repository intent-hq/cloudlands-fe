import { test } from '@playwright/experimental-ct-svelte';
import type { Component } from 'svelte';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This helper executes in Playwright's Node test process.
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This helper executes in Playwright's Node test process.
import { basename, dirname } from 'node:path';
import type { GeometryProbeResult } from './geometry-probe';
import type { PreviewDefinition } from './preview-definition';

type GeometrySnapshot = Record<string, Record<string, GeometryProbeResult>>;

export interface GeometrySnapshotSuiteOptions<Props extends Record<string, unknown>> {
  scene: string;
  component: Component<Props>;
  definition: PreviewDefinition<Props>;
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

function geometryDifferences(
  state: string,
  width: number,
  expected: GeometryProbeResult | undefined,
  actual: GeometryProbeResult,
): string[] {
  const differences: string[] = [];
  const expectedFields = flatten(expected);
  const actualFields = flatten(actual);
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
  return differences;
}

function readSnapshot(snapshotPath: string): GeometrySnapshot {
  try {
    return JSON.parse(readFileSync(snapshotPath, 'utf8')) as GeometrySnapshot;
  } catch (error) {
    throw new Error(`Unable to read geometry snapshot ${snapshotPath}.`, { cause: error });
  }
}

function withSnapshotLock(snapshotPath: string, update: () => void): void {
  const lockPath = `${snapshotPath}.lock`;
  const deadline = Date.now() + 10_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    update();
  } finally {
    closeSync(descriptor);
    unlinkSync(lockPath);
  }
}

function updateSnapshotCell(
  snapshotPath: string,
  states: string[],
  widths: number[],
  state: string,
  width: number,
  geometry: GeometryProbeResult,
): void {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  withSnapshotLock(snapshotPath, () => {
    let existing: GeometrySnapshot = {};
    try {
      existing = JSON.parse(readFileSync(snapshotPath, 'utf8')) as GeometrySnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const next = Object.fromEntries(
      states.map((stateName) => [
        stateName,
        Object.fromEntries(
          widths.flatMap((configuredWidth) => {
            const value = existing[stateName]?.[String(configuredWidth)];
            return value ? [[String(configuredWidth), value]] : [];
          }),
        ),
      ]),
    ) as GeometrySnapshot;
    next[state][String(width)] = geometry;
    writeFileSync(snapshotPath, `${JSON.stringify(sorted(next), null, 2)}\n`);
  });
}

/**
 * Defines one retryable CT test per preview state/width. The calling spec must statically import
 * both the preview component and its named definition so Playwright registers them in the browser.
 * No preview loader or CT bootstrap registration is required.
 *
 * @example
 * import Preview, { preview } from './example.preview.svelte';
 * defineGeometrySnapshotSuite({
 *   scene: 'example', component: Preview, definition: preview, states: ['default'],
 *   widths: [420], snapshotPath: '/absolute/example.geometry.json',
 * });
 */
export function defineGeometrySnapshotSuite<Props extends Record<string, unknown>>(
  options: GeometrySnapshotSuiteOptions<Props>,
): void {
  const name = basename(options.snapshotPath, '.json');
  const widths = options.widths ?? [420];
  const stateNames = options.states ?? Object.keys(readSnapshot(options.snapshotPath));
  for (const stateName of stateNames) {
    for (const width of widths) {
      test(`${name} ${stateName} ${width}px geometry snapshot`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1200 });
        const componentRef: unknown = options.component;
        const definitionRef: unknown = options.definition;
        const actual = await page.evaluate(
          async ({ componentRef, definitionRef, scene, state, requestedWidth, selector }) => {
            const ctWindow = window as typeof window & {
              __INTENT_GEOMETRY_CT__: {
                collectGeometry: typeof import('./geometry-probe').collectGeometry;
                waitForCaptureStability: typeof import('./capture-stability').waitForCaptureStability;
              };
              __pwUnwrapObject: (value: unknown) => Promise<unknown>;
              playwrightMount: (
                component: unknown,
                root: HTMLElement,
                hooksConfig?: unknown,
              ) => Promise<void>;
              playwrightUnmount: (root: HTMLElement) => Promise<void>;
            };
            const [component, definition] = (await Promise.all([
              ctWindow.__pwUnwrapObject(componentRef),
              ctWindow.__pwUnwrapObject(definitionRef),
            ])) as [Component<Record<string, unknown>>, PreviewDefinition<Record<string, unknown>>];
            if (definition.id !== scene)
              throw new Error(
                `Preview “${definition.id}” does not match geometry scene “${scene}”.`,
              );
            const previewState = definition.states[state];
            if (!previewState) throw new Error(`Preview “${scene}” has no state “${state}”.`);

            const root = document.getElementById('root');
            if (!root) throw new Error('Playwright CT root is unavailable.');
            root.className =
              'preview-focus mx-auto max-w-full rounded-md border border-border bg-card p-6';
            root.style.width = `${requestedWidth}px`;
            const cleanup = previewState.setup?.();
            let mounted = false;
            try {
              await ctWindow.playwrightMount(
                { __pw_type: 'object-component', type: component, props: previewState.props },
                root,
              );
              mounted = true;
              const { collectGeometry, waitForCaptureStability } = ctWindow.__INTENT_GEOMETRY_CT__;
              await waitForCaptureStability(root);
              return collectGeometry(root, selector ? { selector } : {});
            } finally {
              if (mounted) await ctWindow.playwrightUnmount(root);
              cleanup?.();
            }
          },
          {
            componentRef,
            definitionRef,
            scene: options.scene,
            state: stateName,
            requestedWidth: width,
            selector: options.selector,
          },
        );
        if (process.env.SANDBOX_GEOMETRY_UPDATE === '1') {
          updateSnapshotCell(options.snapshotPath, stateNames, widths, stateName, width, actual);
          return;
        }
        const expected = readSnapshot(options.snapshotPath)[stateName]?.[String(width)];
        const differences = geometryDifferences(stateName, width, expected, actual);
        if (differences.length)
          throw new Error(`Geometry snapshot mismatch:\n${differences.join('\n')}`);
      });
    }
  }
}
