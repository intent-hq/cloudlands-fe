// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cardFixtures, cardMetadata } from '$lib/components/ui/card';
import { spinnerFixtures, spinnerMetadata } from '$lib/components/ui/indicators';
import { inputFixtures, inputMetadata } from '$lib/components/ui/input';
import { labelFixtures, labelMetadata } from '$lib/components/ui/label';
import { listFixtures, listMetadata } from '$lib/components/ui/list';
import { separatorFixtures, separatorMetadata } from '$lib/components/ui/separator';
import { skeletonFixtures, skeletonMetadata } from '$lib/components/ui/skeleton';
import { textareaFixtures, textareaMetadata } from '$lib/components/ui/textarea';
import { buildUiComponentInventory } from '../../../../scripts/ui-component-inventory';
import ContentFieldCatalogPreview from './ContentFieldCatalogPreview.svelte';

const cases = [
  ['card', cardFixtures[0]],
  ['list', listFixtures[0]],
  ['input', inputFixtures[0]],
  ['textarea', textareaFixtures[0]],
  ['label', labelFixtures[0]],
  ['separator', separatorFixtures[0]],
  ['skeleton', skeletonFixtures[0]],
  ['spinner', spinnerFixtures[0]],
] as const;
const metadata = [
  cardMetadata,
  listMetadata,
  inputMetadata,
  textareaMetadata,
  labelMetadata,
  separatorMetadata,
  skeletonMetadata,
  spinnerMetadata,
];

afterEach(cleanup);

describe('ContentFieldCatalogPreview', () => {
  it.each(cases)(
    'renders every declared %s fixture state through canonical components',
    (componentId, fixture) => {
      const { container } = render(ContentFieldCatalogPreview, { props: { componentId, fixture } });
      expect(
        container
          .querySelector('[data-catalog-renderer-fixture]')
          ?.getAttribute('data-catalog-renderer-fixture'),
      ).toBe(fixture.id);
      const renderedStates = Array.from(
        container.querySelectorAll('[data-catalog-rendered-state]'),
      ).flatMap((element) => element.getAttribute('data-catalog-rendered-state')?.split(' ') ?? []);
      expect(new Set(renderedStates)).toEqual(new Set(fixture.states));
    },
  );

  it('instantiates real accessible field, content, separator, and loading states', () => {
    const input = render(ContentFieldCatalogPreview, {
      props: { componentId: 'input', fixture: inputFixtures[0] },
    });
    expect(input.getByRole('textbox', { name: 'Project name' })).toBeTruthy();
    expect(input.getByRole('textbox', { name: 'Invalid input' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    cleanup();

    const list = render(ContentFieldCatalogPreview, {
      props: { componentId: 'list', fixture: listFixtures[0] },
    });
    expect(list.getByRole('button', { name: /Selected item/ }).getAttribute('data-selected')).toBe(
      'true',
    );
    expect(list.getByText('No catalog items')).toBeTruthy();
    cleanup();

    const separator = render(ContentFieldCatalogPreview, {
      props: { componentId: 'separator', fixture: separatorFixtures[0] },
    });
    expect(separator.getByRole('separator').getAttribute('data-orientation')).toBe('vertical');
    cleanup();

    const spinner = render(ContentFieldCatalogPreview, {
      props: { componentId: 'spinner', fixture: spinnerFixtures[0] },
    });
    expect(spinner.getAllByRole('status', { name: 'Loading' })).toHaveLength(6);
  });

  it('contains no raw controls or physical palette utilities', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
      ),
      'utf8',
    );
    expect(source).not.toMatch(/<(?:button|input|textarea|select)(?:\s|>)/);
    expect(source).not.toMatch(
      /(?:bg|border|text)-(?:white|black|red|blue|green|gray|zinc|slate|neutral|stone|amber|yellow|purple|violet|indigo|sky|cyan|teal|emerald|lime|orange|rose|pink)-/,
    );
  });

  it('keeps public exports, aliases, callers, and dynamic imports aligned to source discovery', () => {
    const inventory = buildUiComponentInventory();
    for (const record of metadata) {
      const discovered = inventory.components.find(
        ({ publicImport }) => publicImport === record.publicImport,
      );
      expect(discovered, record.publicImport).toBeTruthy();
      expect(record.exports, record.publicImport).toEqual(discovered?.exports);
      expect(record.legacyImports, record.publicImport).toEqual(discovered?.legacyImports);
      expect(record.callers, record.publicImport).toEqual(discovered?.callers);
      expect(record.dynamicImports, record.publicImport).toEqual(discovered?.dynamicImports);
    }
  });
});
