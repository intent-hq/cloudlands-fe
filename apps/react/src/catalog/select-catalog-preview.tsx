// Source: ChoiceCatalogPreview.svelte (select branch) and select/select-focus.preview.svelte.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from '@/components/ui/select';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import './choice-catalog-preview.css';

const items = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'long', label: 'A very long select option for compact layout verification' },
];
const longItems = Array.from({ length: 18 }, (_, index) => ({
  value: `option-${String(index + 1).padStart(2, '0')}`,
  label: `Catalog option ${String(index + 1).padStart(2, '0')}`,
}));

function SelectExample({
  label,
  value: initialValue = 'apple',
  open: initiallyOpen = false,
  options = items,
  disabled,
  invalid,
  placeholder,
  className,
  wrapperClass,
  showContent = true,
  output = false,
}: {
  label: string;
  value?: string;
  open?: boolean;
  options?: typeof items;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  wrapperClass?: string;
  showContent?: boolean;
  output?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <Select
        value={value}
        onValueChange={setValue}
        open={open}
        onOpenChange={setOpen}
        items={options}
        disabled={disabled}
        invalid={invalid}
      >
        <SelectTrigger aria-label={label} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        {showContent && (
          <SelectContent portal={false} wrapperClass={wrapperClass}>
            <SelectGroup>
              {options.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        )}
      </Select>
      {output && (
        <output className="sr-only" aria-label="Select value">
          {value}
        </output>
      )}
    </>
  );
}

export function SelectCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  return (
    <div
      className="choice-catalog-preview grid w-full min-w-0 max-w-md gap-4"
      data-catalog-renderer-fixture={fixture.id}
    >
      {fixture.id === 'select-state-matrix' ? (
        <>
          <div
            className="relative z-20"
            data-catalog-rendered-state="closed selected focus-visible"
          >
            <SelectExample label="Catalog select" placeholder="Choose fruit" output />
          </div>
          <div
            className="relative z-10 pb-32"
            data-catalog-state="select-open"
            data-catalog-rendered-state="open"
          >
            <SelectExample label="Open catalog select" open />
          </div>
          <div className="grid gap-2" data-catalog-rendered-state="compact-28 medium-32 large-36">
            <SelectExample
              label="Compact catalog select"
              className="h-(--control-height-small)"
              showContent={false}
            />
            <SelectExample
              label="Medium catalog select"
              value="banana"
              className="h-(--control-height-medium)"
              showContent={false}
            />
            <SelectExample
              label="Large catalog select"
              value="long"
              className="h-(--control-height-large)"
              showContent={false}
            />
          </div>
          <div data-catalog-rendered-state="disabled">
            <SelectExample label="Disabled select" disabled showContent={false} />
          </div>
          <div data-catalog-rendered-state="invalid">
            <SelectExample label="Invalid select" invalid showContent={false} />
          </div>
        </>
      ) : (
        <>
          <div data-catalog-rendered-state="long-content portal reduced-motion">
            <SelectExample label="Long content select" value="long" />
          </div>
          <div data-catalog-rendered-state="empty">
            <SelectExample label="Empty select" value="" options={[]} placeholder="No options" />
          </div>
          <div
            data-catalog-state="select-long-list"
            data-catalog-rendered-state="long-list scrolling"
          >
            <SelectExample
              label="Long-list catalog select"
              value="option-01"
              open
              options={longItems}
              wrapperClass="max-h-32 overflow-y-auto"
            />
          </div>
        </>
      )}
    </div>
  );
}

const focusItems = [
  items[0]!,
  items[1]!,
  { value: 'cherry', label: 'A very long cherry option label used to verify truncation' },
];
export function SelectFocusPreview({
  portal = false,
  staticPosition = false,
}: {
  portal?: boolean;
  staticPosition?: boolean;
}) {
  const [value, setValue] = useState('apple');
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full p-4" data-testid="select-focus-preview">
      <Button>Outside action</Button>
      <Select
        value={value}
        onValueChange={setValue}
        open={open}
        onOpenChange={setOpen}
        items={focusItems}
        staticPosition={staticPosition}
      >
        <SelectTrigger aria-label="Choose fruit">
          <SelectValue placeholder="Choose fruit" />
        </SelectTrigger>
        <SelectContent portal={portal}>
          <Input aria-label="Filter fruit" />
          <SelectGroup>
            {focusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <output data-testid="select-value">{value}</output>
      <output data-testid="select-open">{String(open)}</output>
    </div>
  );
}
