// Source: ChoiceCatalogPreview.svelte, combobox and compatibility wrapper branches.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { Combobox, type ComboboxOption, type ComboboxGroup } from '@/components/ui/combobox';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { GroupedCombobox, type OptionGroup } from '@/components/ui/grouped-combobox';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import './choice-catalog-preview.css';

const options: ComboboxOption[] = [
  { value: 'ada', label: 'Ada Lovelace' },
  { value: 'grace', label: 'Grace Hopper' },
  { value: 'long', label: 'A very long option label that remains readable in compact layouts' },
];
const groups: ComboboxGroup[] = [{ key: 'people', label: 'People', options }];
const wrapperOptions = options.map(({ value, label }) => ({ value, label }));
const wrapperGroups: OptionGroup[] = [{ key: 'people', label: 'People', options: wrapperOptions }];
const longOptions: ComboboxOption[] = Array.from({ length: 18 }, (_, index) => ({
  value: `option-${String(index + 1).padStart(2, '0')}`,
  label: `Catalog option ${String(index + 1).padStart(2, '0')}`,
}));

export function PickerCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const [value, setValue] = useState<string | string[]>('grace');
  const [openValue, setOpenValue] = useState<string | string[]>('grace');
  const [open, setOpen] = useState(true);
  const [multiValue, setMultiValue] = useState<string | string[]>(['ada', 'grace']);
  const [longOpen, setLongOpen] = useState(true);
  const [searchableValue, setSearchableValue] = useState('grace');
  const [groupedValue, setGroupedValue] = useState('grace');
  return (
    <div
      className="choice-catalog-preview grid w-full min-w-0 max-w-md gap-4"
      data-catalog-renderer-fixture={fixture.id}
    >
      {componentId === 'combobox' &&
        (fixture.id === 'combobox-state-matrix' ? (
          <>
            <div data-catalog-rendered-state="closed selected keyboard-focus">
              <Combobox
                value={value}
                onChange={setValue}
                options={options}
                portal={false}
                ariaLabel="Catalog combobox"
                inputClass="outline-1 outline-offset-2 outline-focus-ring outline-solid"
              />
              <output className="sr-only" aria-label="Combobox value">
                {JSON.stringify(value)}
              </output>
            </div>
            <div
              className="pb-32"
              data-catalog-state="combobox-open"
              data-catalog-rendered-state="open"
            >
              <Combobox
                value={openValue}
                onChange={setOpenValue}
                open={open}
                onOpenChange={setOpen}
                options={options}
                portal={false}
                ariaLabel="Open catalog combobox"
              />
            </div>
            <div data-catalog-state="combobox-multi" data-catalog-rendered-state="multi-selected">
              <Combobox
                value={multiValue}
                onChange={setMultiValue}
                options={options}
                multiple
                portal={false}
                ariaLabel="Multi-select catalog combobox"
              />
              <output className="sr-only" aria-label="Multi-select combobox value">
                {JSON.stringify(multiValue)}
              </output>
            </div>
            <div className="grid gap-2" data-catalog-rendered-state="compact-28 medium-32 large-36">
              <Combobox
                value="ada"
                options={options}
                portal={false}
                ariaLabel="Compact catalog combobox"
                inputClass="h-(--control-height-small)"
              />
              <Combobox
                value="grace"
                options={options}
                portal={false}
                ariaLabel="Medium catalog combobox"
                inputClass="h-(--control-height-medium)"
              />
              <Combobox
                value="long"
                options={options}
                portal={false}
                ariaLabel="Large catalog combobox"
                inputClass="h-(--control-height-large)"
              />
            </div>
            <div data-catalog-rendered-state="disabled">
              <Combobox options={options} disabled portal={false} ariaLabel="Disabled combobox" />
            </div>
            <div data-catalog-rendered-state="invalid">
              <Combobox options={options} invalid portal={false} ariaLabel="Invalid combobox" />
            </div>
            <div data-catalog-rendered-state="loading">
              <Combobox options={options} loading portal={false} ariaLabel="Loading combobox" />
            </div>
          </>
        ) : (
          <>
            <div data-catalog-rendered-state="grouped long-content portal focus-restored reduced-motion">
              <Combobox
                value={value}
                onChange={setValue}
                groups={groups}
                portal={false}
                ariaLabel="Grouped catalog combobox"
              />
            </div>
            <div data-catalog-rendered-state="empty">
              <Combobox
                options={[]}
                portal={false}
                ariaLabel="Empty combobox"
                emptyText="No matching people"
              />
            </div>
            <div
              data-catalog-state="combobox-long-list"
              data-catalog-rendered-state="long-list scrolling"
            >
              <Combobox
                value="option-01"
                open={longOpen}
                onOpenChange={setLongOpen}
                options={longOptions}
                portal={false}
                ariaLabel="Long-list catalog combobox"
              />
            </div>
          </>
        ))}
      {componentId === 'searchable-select' && (
        <>
          <div data-catalog-rendered-state="default selected search long-content">
            <SearchableSelect
              value={searchableValue}
              onChange={setSearchableValue}
              options={wrapperOptions}
              staticPosition
            />
          </div>
          <div data-catalog-rendered-state="disabled">
            <SearchableSelect options={wrapperOptions} disabled />
          </div>
        </>
      )}
      {componentId === 'grouped-combobox' && (
        <>
          <div data-catalog-rendered-state="default selected collapsed expanded">
            <GroupedCombobox
              value={groupedValue}
              onChange={setGroupedValue}
              groups={wrapperGroups}
              defaultCollapsed={false}
            />
          </div>
          <div data-catalog-rendered-state="disabled">
            <GroupedCombobox groups={wrapperGroups} disabled />
          </div>
        </>
      )}
    </div>
  );
}
