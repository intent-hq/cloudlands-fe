import { test } from '../../test/ct-test';
import type { Component } from 'svelte';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This helper executes in Playwright's Node test process.
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This helper executes in Playwright's Node test process.
import { basename, dirname } from 'node:path';
import type { GeometryProbeResult } from './geometry-probe';
import type { PreviewCaptureReadiness } from './preview-definition';

type GeometryCells = Record<string, Record<string, GeometryProbeResult>>;

/** Raw baseline file: state cells plus the reserved `$meta` key. */
export type GeometrySnapshot = Record<string, unknown>;

interface GeometrySnapshotMeta {
  generatedOn: string;
}

export interface GeometrySnapshotSuiteOptions<Props extends Record<string, unknown>> {
  scene: string;
  component: Component<Props>;
  states?: string[];
  widths?: number[];
  selector?: string;
  captureReadiness?: PreviewCaptureReadiness;
  snapshotPath: string;
}

/** Reserved top-level baseline key; never a state name. */
export const GEOMETRY_SNAPSHOT_META_KEY = '$meta';
export const GEOMETRY_UPDATE_ENV = 'SANDBOX_GEOMETRY_UPDATE';
export const GEOMETRY_UPDATE_ALLOW_NON_LINUX_ENV = 'SANDBOX_GEOMETRY_UPDATE_ALLOW_NON_LINUX';
const BASELINE_PLATFORM = 'linux';

/**
 * Refuses a baseline update on any host but Linux unless the escape hatch is set. Baselines are
 * verified only on Linux CI, so a golden regenerated elsewhere fails there (cloudlands-fe#2533).
 */
export function assertGeometryUpdateHost({
  platform,
  env,
}: {
  platform: string;
  env: Record<string, string | undefined>;
}): void {
  if (env[GEOMETRY_UPDATE_ENV] !== '1') return;
  if (platform === BASELINE_PLATFORM || env[GEOMETRY_UPDATE_ALLOW_NON_LINUX_ENV] === '1') return;
  throw new Error(
    `${GEOMETRY_UPDATE_ENV}=1 is not supported on "${platform}": geometry baselines are verified ` +
      `only on Linux CI, where Inter text shaping differs from other hosts, so a baseline ` +
      `regenerated here would fail there. Run the update on a Linux host (an Intent workspace ` +
      `on the daemon host). Set ${GEOMETRY_UPDATE_ALLOW_NON_LINUX_ENV}=1 only for local ` +
      `experiments whose output must never be committed.`,
  );
}

export function snapshotStateNames(snapshot: GeometrySnapshot): string[] {
  return Object.keys(snapshot).filter((key) => key !== GEOMETRY_SNAPSHOT_META_KEY);
}

function snapshotMeta(snapshot: GeometrySnapshot): Partial<GeometrySnapshotMeta> | undefined {
  const meta = snapshot[GEOMETRY_SNAPSHOT_META_KEY];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const { generatedOn } = meta as { generatedOn?: unknown };
  return { generatedOn: typeof generatedOn === 'string' ? generatedOn : undefined };
}

/** Returns the verify-mode failure for a baseline not generated on Linux, or `undefined`. */
export function baselinePlatformError(
  snapshotPath: string,
  snapshot: GeometrySnapshot,
): string | undefined {
  const generatedOn = snapshotMeta(snapshot)?.generatedOn;
  if (generatedOn === BASELINE_PLATFORM) return undefined;
  const origin =
    generatedOn === undefined
      ? `does not record the platform it was generated on (missing "${GEOMETRY_SNAPSHOT_META_KEY}.generatedOn")`
      : `was generated on "${generatedOn}"`;
  return `Geometry baseline ${snapshotPath} ${origin}; baselines must be regenerated on Linux (see AGENTS.md § geometry baselines).`;
}

function snapshotCell(
  snapshot: GeometrySnapshot,
  state: string,
  width: number,
): GeometryProbeResult | undefined {
  const cells = snapshot[state];
  if (!cells || typeof cells !== 'object') return undefined;
  return (cells as Record<string, GeometryProbeResult | undefined>)[String(width)];
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
    const cells = Object.fromEntries(
      states.map((stateName) => [
        stateName,
        Object.fromEntries(
          widths.flatMap((configuredWidth) => {
            const value = snapshotCell(existing, stateName, configuredWidth);
            return value ? [[String(configuredWidth), value]] : [];
          }),
        ),
      ]),
    ) as GeometryCells;
    cells[state][String(width)] = geometry;
    const meta: GeometrySnapshotMeta = { generatedOn: process.platform };
    const next: GeometrySnapshot = { ...cells, [GEOMETRY_SNAPSHOT_META_KEY]: meta };
    writeFileSync(snapshotPath, `${JSON.stringify(sorted(next), null, 2)}\n`);
  });
}

/**
 * Defines one retryable CT test per preview state/width. The calling spec must statically import
 * the preview component so Playwright registers it in the browser. The shared CT hook resolves the
 * matching preview definition lazily in the browser; no per-scene bootstrap registration is needed.
 * The CT harness loads the repo-bundled `Inter Variable` font, each geometry frame selects it,
 * and capture stability waits for `document.fonts.ready`, keeping text geometry independent of
 * fonts installed on the host without changing unrelated CT rendering.
 *
 * @example
 * import Preview from './example.preview.svelte';
 * defineGeometrySnapshotSuite({
 *   scene: 'example', component: Preview, states: ['default'],
 *   widths: [420], snapshotPath: '/absolute/example.geometry.json',
 * });
 */
export function defineGeometrySnapshotSuite<Props extends Record<string, unknown>>(
  options: GeometrySnapshotSuiteOptions<Props>,
): void {
  assertGeometryUpdateHost({ platform: process.platform, env: process.env });
  const update = process.env[GEOMETRY_UPDATE_ENV] === '1';
  const name = basename(options.snapshotPath, '.json');
  const widths = options.widths ?? [420];
  const stateNames = options.states ?? snapshotStateNames(readSnapshot(options.snapshotPath));
  for (const stateName of stateNames) {
    for (const width of widths) {
      test(`${name} ${stateName} ${width}px geometry snapshot`, async ({ mount, page }) => {
        if (!update) {
          const platformError = baselinePlatformError(
            options.snapshotPath,
            readSnapshot(options.snapshotPath),
          );
          if (platformError) throw new Error(platformError);
        }
        await page.setViewportSize({ width, height: 1200 });
        const root = page.locator('#root');
        await root.evaluate((element, requestedWidth) => {
          element.setAttribute(
            'class',
            'preview-focus mx-auto max-w-full rounded-md border border-border bg-card p-6',
          );
          element.style.setProperty(
            '--font-ui',
            "'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          );
          element.style.fontFamily = 'var(--font-ui)';
          element.style.width = `${requestedWidth}px`;
        }, width);
        const component = await mount(options.component, {
          hooksConfig: {
            geometrySnapshot: {
              scene: options.scene,
              state: stateName,
            },
          },
        });
        let actual: GeometryProbeResult;
        try {
          actual = await root.evaluate(
            async (element, { selector, readiness }) => {
              const rootElement = element as HTMLElement;
              const geometryWindow = window as typeof window & {
                __INTENT_GEOMETRY_CT__: {
                  collectGeometry: typeof import('./geometry-probe').collectGeometry;
                  waitForCaptureStability: typeof import('./capture-stability').waitForCaptureStability;
                };
              };
              await geometryWindow.__INTENT_GEOMETRY_CT__.waitForCaptureStability(rootElement, {
                readiness,
                readinessTimeoutMs: readiness?.readinessTimeoutMs,
              });
              return geometryWindow.__INTENT_GEOMETRY_CT__.collectGeometry(
                rootElement,
                selector ? { selector } : {},
              );
            },
            { selector: options.selector, readiness: options.captureReadiness },
          );
        } finally {
          await component.unmount();
        }
        if (update) {
          updateSnapshotCell(options.snapshotPath, stateNames, widths, stateName, width, actual);
          return;
        }
        const expected = snapshotCell(readSnapshot(options.snapshotPath), stateName, width);
        const differences = geometryDifferences(stateName, width, expected, actual);
        if (differences.length)
          throw new Error(`Geometry snapshot mismatch:\n${differences.join('\n')}`);
      });
    }
  }
}
