// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FieldsCatalogPreview from './FieldsCatalogPreview.svelte';
import { fieldControls, fieldStates } from './field-controls';

afterEach(cleanup);

describe('FieldsCatalogPreview', () => {
  it('renders every composed control and state with a stable preview tag', () => {
    const fixture = {
      id: 'field-state-matrix',
      title: 'Composed field state matrix',
      states: [...fieldStates],
    };
    const { container } = render(FieldsCatalogPreview, {
      props: { componentId: 'fields', fixture },
    });

    for (const control of fieldControls) {
      for (const state of fieldStates) {
        expect(
          container.querySelector(`[data-field-preview="${control.id}-${state}"]`),
          `${control.id}-${state}`,
        ).toBeTruthy();
      }
    }
    expect(container.querySelectorAll('[data-field-preview]')).toHaveLength(
      fieldControls.length * fieldStates.length,
    );
  });
});
