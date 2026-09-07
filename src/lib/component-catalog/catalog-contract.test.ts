// @vitest-environment jsdom
// Intentionally update after reviewed fixture/contract changes with:
// NODE_OPTIONS=--max-old-space-size=4096 pnpm vitest run src/lib/component-catalog/catalog-contract.test.ts --maxWorkers=1 -u
// Always review the generated snapshot diff before staging it; unrelated churn is not acceptable.
import { cleanup, render } from '@testing-library/svelte';
import axe from 'axe-core';
import { tick } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { canonicalPatternManifest } from '$lib/components/patterns/manifest';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { canonicalComponentManifest } from '$lib/components/ui/manifest';
import CatalogFixtureList from './CatalogFixtureList.svelte';
import CatalogPatternContract from './CatalogPatternContract.test.svelte';
import { getCatalogEntry } from './catalog';
import { waitForCaptureStability } from './capture-stability';
import '../../app.css';

type ContractCase = {
  key: string;
  kind: 'pattern' | 'primitive';
  id: string;
  fixture: UiComponentFixture;
};

const cases: ContractCase[] = [
  ...canonicalComponentManifest
    .filter(({ category, id }) => category === 'primitive' || id === 'toast')
    .flatMap(({ id, fixtures }) =>
      fixtures.map((fixture) => ({
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
].sort((left, right) => left.key.localeCompare(right.key));

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
  'primitive:select:select-content': [
    {
      rule: 'aria-allowed-attr',
      reason:
        'The invalid-state fixture intentionally exercises the select trigger aria-invalid contract.',
    },
  ],
  'primitive:select:select-state-matrix': [
    {
      rule: 'aria-allowed-attr',
      reason:
        'The invalid-state fixture intentionally exercises the select trigger aria-invalid contract.',
    },
  ],
  'primitive:skeleton:skeleton-state-matrix': [
    {
      rule: 'aria-prohibited-attr',
      reason:
        'The fixture intentionally labels a decorative skeleton while checking its loading-state contract.',
    },
  ],
};
const axeRules = {
  // jsdom cannot calculate visual contrast or page-level landmark coverage for isolated fixtures.
  'color-contrast': { enabled: false },
  region: { enabled: false },
};
const stableAttributes =
  /^(?:aria-|data-)|^(?:class|disabled|for|href|id|open|role|tabindex|type)$/;

function normalizeValue(value: string): string {
  return value
    .replace(/\bsvelte-[a-z0-9]+\b/g, 'svelte-<scope>')
    .replace(/\bbits-[a-z0-9-]+/g, 'bits-<id>')
    .replace(/\bc[0-9]+(?=-)/g, 'c<id>')
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
    return render(CatalogPatternContract, {
      props: { patternId: testCase.id, fixture: testCase.fixture },
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

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe.sequential('catalog DOM, token, and accessibility contracts', () => {
  it.each(cases)('$key', async (testCase) => {
    renderCase(testCase);
    await tick();
    await waitForCaptureStability(document.body, { timeoutMs: 2_000 });

    expect({
      declaredStates: testCase.fixture.states,
      dom: stableDom(document.body),
    }).toMatchSnapshot();

    const result = await axe.run(document.body, { rules: axeRules });
    const allowed = intentionalAxeAllowlist[testCase.key] ?? [];
    expect(allowed.every(({ reason }) => reason.trim().length > 0)).toBe(true);
    expect(result.violations.map(({ id }) => id).sort()).toEqual(
      allowed.map(({ rule }) => rule).sort(),
    );
  });
});
