// Source: src/lib/component-catalog/renderers/FieldsCatalogPreview.svelte.
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { FieldPreviewCell } from './field-preview-cell';
import { fieldControls, fieldStates } from './field-controls';
import './fields-catalog-preview.css';

export interface FieldsCatalogPreviewProps {
  componentId?: string;
  fixture: UiComponentFixture;
}

export function FieldsCatalogPreview({ fixture }: FieldsCatalogPreviewProps) {
  return (
    <div
      className="fields-catalog-preview fields-matrix"
      data-catalog-renderer-fixture={fixture.id}
      data-catalog-rendered-state={fixture.states.join(' ')}
    >
      {fieldControls.map((control) => (
        <section key={control.id} className="field-family" aria-labelledby={`fields-${control.id}`}>
          <h3 id={`fields-${control.id}`} className="family-title">
            {control.label}
          </h3>
          <div className="state-grid">
            {fieldStates.map((state) => (
              <FieldPreviewCell
                key={state}
                control={control.id}
                state={state}
                label={control.label}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
