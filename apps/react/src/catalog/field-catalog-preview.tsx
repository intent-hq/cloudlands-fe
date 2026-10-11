// Source: ContentFieldCatalogPreview.svelte (copy-input and input-group branches).
// i18n-ignore (reference catalog fixture content)
import { Button } from '@/components/ui/button';
import { CopyInput } from '@/components/ui/copy-input';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function FieldCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const leading = <span aria-hidden="true">@</span>;
  const trailing = (
    <Button variant="ghost" size="xs">
      Apply
    </Button>
  );
  return (
    <div
      className="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4 overflow-hidden"
      data-catalog-renderer-fixture={fixture.id}
    >
      {componentId === 'input-group' ? (
        <>
          <div
            className="grid gap-3"
            data-catalog-rendered-state="rest leading-addon trailing-addon default-size light dark reduced-motion"
          >
            <InputGroup leading={leading} trailing={trailing}>
              <InputGroupInput aria-label="Grouped value" placeholder="workspace" noFocusStyle />
            </InputGroup>
          </div>
          <div data-catalog-rendered-state="hover">
            <InputGroup leading={leading} trailing={trailing} data-state="hover">
              <InputGroupInput aria-label="Hover group" placeholder="workspace" noFocusStyle />
            </InputGroup>
          </div>
          <div data-catalog-rendered-state="focus">
            <InputGroup leading={leading} trailing={trailing} data-state="focus">
              <InputGroupInput aria-label="Focus group" placeholder="workspace" noFocusStyle />
            </InputGroup>
          </div>
          <div data-catalog-rendered-state="error">
            <InputGroup leading={leading} trailing={trailing} error="Choose a valid value">
              <InputGroupInput
                aria-label="Invalid group"
                aria-invalid="true"
                placeholder="workspace"
                noFocusStyle
              />
            </InputGroup>
          </div>
          <div data-catalog-rendered-state="disabled">
            <InputGroup leading={leading} trailing={trailing} disabled>
              <InputGroupInput
                aria-label="Disabled group"
                placeholder="workspace"
                disabled
                noFocusStyle
              />
            </InputGroup>
          </div>
          <div data-catalog-rendered-state="compact">
            <InputGroup leading={leading} trailing={trailing} size="compact">
              <InputGroupInput
                aria-label="Compact group"
                placeholder="workspace"
                size="compact"
                noFocusStyle
              />
            </InputGroup>
          </div>
        </>
      ) : (
        <>
          <div
            className="grid gap-3"
            data-catalog-rendered-state="rest default-size light dark reduced-motion copied"
          >
            <CopyInput value="intent://workspace/system-design" label="Workspace link" />
          </div>
          <div data-catalog-rendered-state="hover">
            <CopyInput value="Hover value" />
          </div>
          <div data-catalog-rendered-state="focus">
            <CopyInput value="Focus value" />
          </div>
          <div data-catalog-rendered-state="error-feedback">
            <CopyInput value="Clipboard failure feedback" />
          </div>
          <div data-catalog-rendered-state="disabled">
            <CopyInput value="Disabled value" disabled />
          </div>
          <div data-catalog-rendered-state="button-variant">
            <CopyInput value="Button variant" variant="button" />
          </div>
          <div data-catalog-rendered-state="left-aligned">
            <CopyInput value="Left aligned action" align="left" />
          </div>
          <div data-catalog-rendered-state="compact">
            <CopyInput value="Compact value" size="compact" />
          </div>
        </>
      )}
    </div>
  );
}
