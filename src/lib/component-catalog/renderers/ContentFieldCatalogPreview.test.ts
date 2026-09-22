// @vitest-environment jsdom
// @ui-invariant
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { cardMetadata } from '$lib/components/ui/card';
import { cardFixtures } from '$lib/components/ui/card/card.fixtures';
import { copyInputFixtures } from '$lib/components/ui/copy-input/copy-input.fixtures';
import { spinnerMetadata } from '$lib/components/ui/indicators';
import { spinnerFixtures } from '$lib/components/ui/indicators/spinner.fixtures';
import { inputMetadata } from '$lib/components/ui/input';
import { inputFixtures } from '$lib/components/ui/input/input.fixtures';
import { inputGroupFixtures } from '$lib/components/ui/input-group/input-group.fixtures';
import { inputMessageFixtures } from '$lib/components/ui/input-message/input-message.fixtures';
import { labelMetadata } from '$lib/components/ui/label';
import { labelFixtures } from '$lib/components/ui/label/label.fixtures';
import { listMetadata } from '$lib/components/ui/list';
import { listFixtures } from '$lib/components/ui/list/list.fixtures';
import { separatorMetadata } from '$lib/components/ui/separator';
import { separatorFixtures } from '$lib/components/ui/separator/separator.fixtures';
import { skeletonMetadata } from '$lib/components/ui/skeleton';
import { skeletonFixtures } from '$lib/components/ui/skeleton/skeleton.fixtures';
import { tableFixtures } from '$lib/components/ui/table/table.fixtures';
import { textareaMetadata } from '$lib/components/ui/textarea';
import { textareaFixtures } from '$lib/components/ui/textarea/textarea.fixtures';
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
  ['loading-indicator', spinnerFixtures[0]],
] as const;
// Every renderer branch, so a raw control or physical palette class added to
// any of them is caught by the DOM invariant matrix.
const controlCases = [
  ...cases,
  ['copy-input', copyInputFixtures[0]],
  ['input-group', inputGroupFixtures[0]],
  ['input-message', inputMessageFixtures[0]],
  ['table', tableFixtures[0]],
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

    const skeleton = render(ContentFieldCatalogPreview, {
      props: { componentId: 'skeleton', fixture: skeletonFixtures[0] },
    });
    expect(skeleton.getByRole('status', { name: 'Loading preview' })).toBeTruthy();
    cleanup();

    const loadingIndicator = render(ContentFieldCatalogPreview, {
      props: { componentId: 'loading-indicator', fixture: spinnerFixtures[0] },
    });
    expect(
      Array.from(loadingIndicator.container.querySelectorAll('[data-loader-variant]')).map((row) =>
        row.getAttribute('data-loader-variant'),
      ),
    ).toEqual(['bloom', 'pulse', 'twist']);
    expect(
      Array.from(loadingIndicator.container.querySelectorAll('[data-loader-size]')).map((row) =>
        Number(row.getAttribute('data-loader-size')),
      ),
    ).toEqual([16, 24, 32]);
    const paused = loadingIndicator.container.querySelector('[data-loader-paused]');
    const pausedMark = paused?.querySelector('[data-slot="intent-mark-loader"]');
    expect(pausedMark?.getAttribute('data-playing')).toBe('false');
    expect(pausedMark?.getAttribute('width')).toBe('16');
    expect(pausedMark?.querySelectorAll('[data-mark-arm]')).toHaveLength(5);
    expect(
      loadingIndicator.container
        .querySelector('[data-loader-context="button"]')
        ?.querySelector('[data-slot="intent-mark-loader"]'),
    ).not.toBeNull();
    expect(
      loadingIndicator.container
        .querySelector('[data-loader-context="list-row"]')
        ?.querySelector('[data-slot="intent-mark-loader"]')
        ?.getAttribute('width'),
    ).toBe('14');
  });

  it.each(controlCases)(
    'renders %s controls only through canonical components and semantic colors',
    (componentId, fixture) => {
      const { container } = render(ContentFieldCatalogPreview, { props: { componentId, fixture } });
      const controls = Array.from(
        container.querySelectorAll<HTMLElement>('button, input, textarea, select'),
      );
      const rawControls = controls.filter((control) => !control.hasAttribute('data-slot'));
      expect(rawControls.map((control) => control.outerHTML)).toEqual([]);

      const paletteClasses = Array.from(container.querySelectorAll('[class]'))
        .flatMap((element) => Array.from(element.classList))
        .filter((className) =>
          /(?:bg|border|text)-(?:white|black|red|blue|green|gray|zinc|slate|neutral|stone|amber|yellow|purple|violet|indigo|sky|cyan|teal|emerald|lime|orange|rose|pink)-/.test(
            className,
          ),
        );
      expect(paletteClasses).toEqual([]);
    },
  );

  it('keeps public exports, aliases, callers, and dynamic imports aligned to source discovery', () => {
    const inventory = buildUiComponentInventory();
    for (const record of metadata) {
      const discovered = inventory.components.find(
        ({ publicImport }) => publicImport === record.publicImport,
      );
      expect(discovered, record.publicImport).toBeTruthy();
      const expectedExports =
        record === spinnerMetadata
          ? [
              'IntentMarkLoader',
              ...(discovered?.exports.filter((name) => name !== 'IntentMarkLoader') ?? []),
            ]
          : discovered?.exports;
      expect(record.exports, record.publicImport).toEqual(expectedExports);
      expect(record.legacyImports, record.publicImport).toEqual(discovered?.legacyImports);
      expect(record.callers, record.publicImport).toEqual(discovered?.callers);
      expect(record.dynamicImports, record.publicImport).toEqual(discovered?.dynamicImports);
    }
  });
});
