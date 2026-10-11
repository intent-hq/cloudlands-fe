// Source: ChoiceCatalogPreview.svelte (dropdown branch).
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { Dropdown } from '@/components/ui/dropdown';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
const options = [
  { value: 'ada', label: 'Ada Lovelace' },
  { value: 'grace', label: 'Grace Hopper' },
  { value: 'long', label: 'A very long option label that remains readable in compact layouts' },
];
export function DropdownCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const [value, setValue] = useState<string | string[]>('grace');
  const [open, setOpen] = useState(true);
  return (
    <div
      className="choice-catalog-preview grid w-full min-w-0 max-w-md gap-4"
      data-catalog-renderer-fixture={fixture.id}
    >
      <div className="pb-40" data-catalog-rendered-state="closed open selected search long-content">
        <Dropdown
          value={value}
          onChange={setValue}
          open={open}
          onOpenChange={setOpen}
          options={options}
          portal={false}
          staticPosition
        />
      </div>
      <div data-catalog-rendered-state="disabled">
        <Dropdown options={options} disabled portal={false} />
      </div>
    </div>
  );
}
