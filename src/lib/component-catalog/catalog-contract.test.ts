// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import axe from 'axe-core';
import { tick } from 'svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from '$lib/i18n/format';
import { canonicalPatternManifest } from '$lib/components/patterns/manifest';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { canonicalComponentManifest } from '$lib/components/ui/manifest';
import CatalogFixtureList from './CatalogFixtureList.svelte';
import PatternCatalogPreview from './renderers/PatternCatalogPreview.svelte';
import { getCatalogEntry } from './catalog';
import type { CatalogRendererId } from './catalog-renderers';
import { waitForCaptureStability } from './capture-stability';
import { CATALOG_REFERENCE_NOW } from './catalog-clock';
import { defaultTestTimeoutMs } from '../../../scripts/vitest-timeouts.mjs';
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
const CONTRACT_DESCRIBE = 'catalog accessibility contracts';
const contractBudgetMs = defaultTestTimeoutMs() * 6;
const renderWaitMs = contractBudgetMs - 10_000;

const intentionalAxeAllowlist: Record<string, ReadonlyArray<{ rule: string; reason: string }>> = {
  'pattern:action-menu:action-menu-states': [
    {
      rule: 'region',
      reason:
        'The open menu state portals its menu to the document body, outside the preview landmark, as every app popup does.',
    },
  ],
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

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

// Freeze Date (only Date: imports, capture stability and cleanup keep real timers) so a
// fixture stamped from the catalog clock and the component measuring it read the same
// instant however slowly the case renders. Unfrozen, the toast catalog's "18s" attention
// toast read "20s" on a busy machine (2026-10-23 verify:changed).
beforeEach(() => {
  vi.setSystemTime(new Date(CATALOG_REFERENCE_NOW));
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
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
    { timeout: renderWaitMs },
  );
  await tick();
  await waitForCaptureStability(document.body, { timeoutMs: 2_000 });

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

// Regression for the "18s" → "20s" drift: time passing between seeding the toast fixture
// and reading it must not change the rendered age.
describe('catalog toast fixture clock', () => {
  const toastCase = cases.find(({ key }) => key === 'primitive:toast:toast-state-matrix');
  const toastBudgetMs = contractBudgetMs;
  // The attention toast's age re-renders on the shared one-second ticker: one tick is
  // enough to read "19s" on an unfrozen clock.
  const slowRenderMs = 1_200;

  it(
    'keeps the attention toast at 18s while a slow render lets real time pass',
    async () => {
      expect(toastCase, 'toast-state-matrix must stay in the contract cases').toBeDefined();
      const rendered = renderCase(toastCase!);
      const selector =
        '#toast-catalog-region-agent-attention [data-toast-layout="agent-attention"] ' +
        '[data-slot="tooltip-trigger"]';
      const age = () => rendered.baseElement.querySelector(selector)?.textContent?.trim();
      await waitFor(() => expect(age()).toBeDefined(), {
        timeout: renderWaitMs,
      });
      expect(age()).toBe('18s');
      await new Promise((resolve) => setTimeout(resolve, slowRenderMs));
      await tick();
      expect(age()).toBe('18s');
    },
    toastBudgetMs + slowRenderMs,
  );
});

describe.sequential(CONTRACT_DESCRIBE, () => {
  for (const testCase of cases) {
    it.each([testCase])('$key', verifyCatalogContract, contractBudgetMs);
  }
});
