// @vitest-environment jsdom
// Intentionally update after reviewed fixture/contract changes with:
// NODE_OPTIONS=--max-old-space-size=4096 pnpm vitest run src/lib/component-catalog/catalog-contract.test.ts --maxWorkers=1 -u
// Always review the generated snapshot diff before staging it; unrelated churn is not acceptable.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import axe from 'axe-core';
import { tick } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from '$lib/i18n/format';
import { canonicalPatternManifest } from '$lib/components/patterns/manifest';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { canonicalComponentManifest } from '$lib/components/ui/manifest';
import CatalogFixtureList from './CatalogFixtureList.svelte';
import PatternCatalogPreview from './renderers/PatternCatalogPreview.svelte';
import { getCatalogEntry } from './catalog';
import type { CatalogRendererId } from './catalog-renderers';
import { waitForCaptureStability } from './capture-stability';
import {
  catalogContractBudgetMs,
  renderWaitMs,
  snapshotLineCounts,
  snapshotLinesFor,
} from './catalog-contract-budget';
import { defaultTestTimeoutMs, isCiEnv } from '../../../scripts/vitest-timeouts.mjs';
import '../../app.css';

// Pin this suite's timestamp timezone and relative-time reference, keeping real timers.
vi.mock(import('$lib/i18n/format'), async (importOriginal) => {
  const actual = await importOriginal();
  const { CATALOG_REFERENCE_NOW } = await import('./catalog-clock');
  const { getActiveLocale } = await import('$lib/i18n/locale');
  return {
    ...actual,
    formatRelativeTime(
      input: Parameters<typeof actual.formatRelativeTime>[0],
      options?: Parameters<typeof actual.formatRelativeTime>[1],
    ) {
      return actual.formatRelativeTime(input, {
        ...options,
        now: options?.now ?? new Date(CATALOG_REFERENCE_NOW),
      });
    },
    formatCompactRelativeTime(
      input: Parameters<typeof actual.formatCompactRelativeTime>[0],
      options?: Parameters<typeof actual.formatCompactRelativeTime>[1],
    ) {
      return actual.formatCompactRelativeTime(input, {
        ...options,
        now: options?.now ?? new Date(CATALOG_REFERENCE_NOW),
      });
    },
    formatDateTime(input: Parameters<typeof actual.formatDateTime>[0]) {
      const date = input instanceof Date ? input : new Date(input);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(getActiveLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(date);
    },
  };
});

type ContractCase = {
  key: string;
  kind: 'pattern' | 'primitive' | 'product';
  id: string;
  fixture: UiComponentFixture;
};

const cases: ContractCase[] = [
  ...canonicalComponentManifest
    .filter(({ category, id }) => category === 'primitive' || id === 'toast' || id === 'list')
    .flatMap(({ id, fixtures }) =>
      fixtures.map((fixture) => ({
        key: `primitive:${id}:${fixture.id}`,
        kind: 'primitive' as const,
        id,
        fixture,
      })),
    ),
  ...canonicalComponentManifest
    .filter(({ id }) => id === 'combobox' || id === 'sidebar')
    .flatMap(({ id, fixtures }) =>
      fixtures
        .filter(({ states }) => states.includes('keyboard-focus'))
        .map((fixture) => ({
          key: `primitive:${id}:${fixture.id}`,
          kind: 'primitive' as const,
          id,
          fixture,
        })),
    ),
  ...canonicalPatternManifest.flatMap(({ id, fixtures }) =>
    fixtures.map((fixture) => ({
      key: `pattern:${id}:${fixture.id}`,
      kind: 'pattern' as const,
      id,
      fixture,
    })),
  ),
  ...(getCatalogEntry('modals')?.fixtures.map((fixture) => ({
    key: `product:modals:${fixture.id}`,
    kind: 'product' as const,
    id: 'modals',
    fixture,
  })) ?? []),
  ...(getCatalogEntry('popovers')?.fixtures.map((fixture) => ({
    key: `product:popovers:${fixture.id}`,
    kind: 'product' as const,
    id: 'popovers',
    fixture,
  })) ?? []),
  ...(getCatalogEntry('rows')?.fixtures.map((fixture) => ({
    key: `product:rows:${fixture.id}`,
    kind: 'product' as const,
    id: 'rows',
    fixture,
  })) ?? []),
  ...(getCatalogEntry('fields')?.fixtures.map((fixture) => ({
    key: `product:fields:${fixture.id}`,
    kind: 'product' as const,
    id: 'fields',
    fixture,
  })) ?? []),
  ...(getCatalogEntry('screen-states')?.fixtures.map((fixture) => ({
    key: `product:screen-states:${fixture.id}`,
    kind: 'product' as const,
    id: 'screen-states',
    fixture,
  })) ?? []),
].sort((left, right) => left.key.localeCompare(right.key));
// Each entry's budget follows its committed DOM snapshot size, so heavy fixtures
// get time in proportion to what they render (see catalog-contract-budget.ts).
const CONTRACT_DESCRIBE = 'catalog DOM, token, and accessibility contracts';
// A filesystem path, not `new URL(…, import.meta.url)`: Vite rewrites that into a dev-server URL.
const snapshotPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__snapshots__',
  'catalog-contract.test.ts.snap',
);
const snapshotLines = snapshotLineCounts(
  existsSync(snapshotPath) ? readFileSync(snapshotPath, 'utf8') : '',
  CONTRACT_DESCRIBE,
);
const unsizedKeys = cases
  .filter(({ key }) => snapshotLinesFor(snapshotLines, key) === undefined)
  .map(({ key }) => key);
const budgets = new Map(
  cases.map(({ key }) => [
    key,
    catalogContractBudgetMs(snapshotLinesFor(snapshotLines, key), defaultTestTimeoutMs()),
  ]),
);
const budgetMs = ({ key }: ContractCase) => budgets.get(key)!;

const intentionalAxeAllowlist: Record<string, ReadonlyArray<{ rule: string; reason: string }>> = {
  'pattern:collection:collection-states': [
    {
      rule: 'nested-interactive',
      reason:
        'The fixture intentionally embeds a row action in a selectable row to cover that supported composition.',
    },
  ],
  'pattern:settings:schema-controls': [
    {
      rule: 'landmark-unique',
      reason:
        'The state matrix intentionally renders repeated copies of the same settings navigation landmark.',
    },
  ],
};
const axeRules = {
  // jsdom cannot calculate visual contrast for isolated fixtures.
  'color-contrast': { enabled: false },
};
const stableAttributes =
  /^(?:aria-|data-)|^(?:class|disabled|for|href|id|open|role|tabindex|type)$/;

function normalizeValue(value: string): string {
  return value
    .replace(/\bsvelte-[a-z0-9]+\b/g, 'svelte-<scope>')
    .replace(/\bbits-[a-z0-9-]+/g, 'bits-<id>')
    .replace(/\bc[0-9]+(?=[-\s"']|$)/g, 'c<id>')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenReferences(element: Element): string[] {
  const references = new Set<string>();
  const styles = getComputedStyle(element);
  for (let index = 0; index < styles.length; index += 1) {
    const property = styles.item(index);
    const value = styles.getPropertyValue(property);
    for (const match of value.matchAll(/var\((--[a-z0-9-]+)/gi)) references.add(match[1]);
  }
  return [...references].sort();
}

function stableDom(root: Element): string {
  const lines: string[] = [];
  const visit = (node: Node, depth: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeValue(node.textContent ?? '');
      if (text) lines.push(`${'  '.repeat(depth)}${JSON.stringify(text)}`);
      return;
    }
    if (!(node instanceof Element)) return;
    const attributes = [...node.attributes]
      .filter(({ name }) => stableAttributes.test(name))
      .map(({ name, value }) => {
        const normalized =
          name === 'class'
            ? normalizeValue(value).split(' ').filter(Boolean).sort().join(' ')
            : normalizeValue(value);
        return `${name}=${JSON.stringify(normalized)}`;
      })
      .sort();
    const tokens = tokenReferences(node);
    const suffix = [...attributes, ...(tokens.length ? [`tokens=${JSON.stringify(tokens)}`] : [])];
    lines.push(
      `${'  '.repeat(depth)}<${node.tagName.toLowerCase()}${suffix.length ? ` ${suffix.join(' ')}` : ''}>`,
    );
    node.childNodes.forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
  return lines.join('\n');
}

function renderCase(testCase: ContractCase) {
  if (testCase.kind === 'pattern') {
    return render(PatternCatalogPreview, {
      props: { componentId: testCase.id as CatalogRendererId, fixture: testCase.fixture },
    });
  }
  const entry = getCatalogEntry(testCase.id);
  expect(entry, `${testCase.id} must have a catalog entry`).toBeDefined();
  return render(CatalogFixtureList, {
    props: { entry: { ...entry!, fixtures: [testCase.fixture] } },
  });
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  globalThis.ResizeObserver = originalResizeObserver;
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

async function verifyCatalogContract(testCase: ContractCase) {
  const rendered = renderCase(testCase);
  // Lazy renderer imports can outlast a tick and an otherwise stable empty preview.
  await waitFor(
    () => {
      expect(
        rendered.container.querySelector(
          `[data-catalog-renderer-fixture="${testCase.fixture.id}"], ` +
            `[data-catalog-fixture-id="${testCase.fixture.id}"] [data-catalog-rendered-state]`,
        ),
      ).not.toBeNull();
    },
    { timeout: renderWaitMs(budgetMs(testCase)) },
  );
  await tick();
  await waitForCaptureStability(document.body, { timeoutMs: 2_000 });

  // A stale snapshot must not prevent the independent accessibility check from running.
  expect
    .soft({
      declaredStates: testCase.fixture.states,
      dom: stableDom(document.body),
    })
    .toMatchSnapshot();

  rendered.container.setAttribute('role', 'main');
  const result = await axe.run(document.body, { rules: axeRules });
  const allowed = intentionalAxeAllowlist[testCase.key] ?? [];
  expect(allowed.every(({ reason }) => reason.trim().length > 0)).toBe(true);
  const violations = result.violations.map(({ id, nodes }) => ({
    id,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
  expect(violations.map(({ id }) => id).sort(), JSON.stringify(violations, null, 2)).toEqual(
    allowed.map(({ rule }) => rule).sort(),
  );
}

describe('catalog relative-time reference', () => {
  it.each(['2026-09-29T13:59:59.000Z', '2026-09-29T14:00:01.000Z', '2030-03-15T12:00:00.000Z'])(
    'keeps fixture time stable when the host date is %s',
    async (hostDate) => {
      const actual = await vi.importActual<typeof import('$lib/i18n/format')>('$lib/i18n/format');
      // Mock Date only: catalog imports, capture stability and cleanup use real timers.
      vi.setSystemTime(new Date(hostDate));
      try {
        expect(vi.isFakeTimers()).toBe(false);
        expect(new Date().toISOString()).toBe(hostDate);
        const fixtureDate = '2026-01-02T14:00:00.000Z';
        expect(formatRelativeTime(fixtureDate)).toBe('8 months ago');
        const options = { now: new Date('2026-01-02T14:05:00.000Z'), style: 'narrow' as const };
        expect(formatRelativeTime(fixtureDate, options)).toBe(
          actual.formatRelativeTime(fixtureDate, options),
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

// A real-clock fixture timestamp drifted from "18s" to "20s" when rendering was slow
// (2026-10-23 verify:changed). Fixture times must not depend on the host clock.
describe('catalog toast fixture clock', () => {
  const toastCase = cases.find(({ key }) => key === 'primitive:toast:toast-state-matrix');

  it.each(['2026-09-01T12:00:05.000Z', '2030-03-15T12:00:00.000Z'])(
    'renders the attention toast age as 18s when the host date is %s',
    async (hostDate) => {
      expect(toastCase).toBeDefined();
      // Mock Date only: the preview's lazy imports and toasts use real timers.
      vi.setSystemTime(new Date(hostDate));
      try {
        const rendered = renderCase(toastCase!);
        const selector =
          '#toast-catalog-region-agent-attention [data-toast-layout="agent-attention"] ' +
          '[data-slot="tooltip-trigger"]';
        const age = await waitFor(
          () => {
            const element = rendered.baseElement.querySelector(selector);
            expect(element).not.toBeNull();
            return element!.textContent?.trim();
          },
          { timeout: renderWaitMs(budgetMs(toastCase!)) },
        );
        expect(age).toBe('18s');
      } finally {
        vi.useRealTimers();
      }
    },
    budgetMs(toastCase!),
  );
});

describe('catalog generated identity normalization', () => {
  it.each([
    ['c123', 'c<id>'],
    ['c123 c124', 'c<id> c<id>'],
    ['c123\tc124\nc125', 'c<id> c<id> c<id>'],
    ['"c123"', '"c<id>"'],
    ["'c123'", "'c<id>'"],
    [
      'id="c123" aria-labelledby="c123 c124-label"',
      'id="c<id>" aria-labelledby="c<id> c<id>-label"',
    ],
    ['c123-trigger', 'c<id>-trigger'],
    ['c123-group-0 c124-group-1', 'c<id>-group-0 c<id>-group-1'],
    ['c123label', 'c123label'],
  ])('normalizes %s without changing its semantic suffix', (value, expected) => {
    expect(normalizeValue(value)).toBe(expected);
  });
});

describe('catalog contract budgets', () => {
  // Without these, an unreadable snapshot or a drift from vitest's title format
  // would silently put every entry on the fallback budget.
  it.runIf(existsSync(snapshotPath))('sizes most entries from the committed snapshot', () => {
    expect(unsizedKeys.length).toBeLessThan(cases.length / 2);
  });

  // CI never writes new snapshots, so there every entry must resolve to its snapshot.
  it.runIf(isCiEnv())('sizes every entry from its committed snapshot', () => {
    expect(unsizedKeys).toEqual([]);
  });
});

describe.sequential(CONTRACT_DESCRIBE, () => {
  // One `it.each` per case keeps the `$key` titles, and so the snapshot keys, unchanged.
  for (const testCase of cases) {
    it.each([testCase])('$key', verifyCatalogContract, budgetMs(testCase));
  }
});
