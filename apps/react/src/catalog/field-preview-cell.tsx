// Source: src/lib/component-catalog/renderers/FieldPreviewCell.svelte.
// i18n-ignore (verbatim internal reference catalog fixture content)
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import * as CheckboxGroup from '@/components/ui/checkbox-group';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { CopyInput } from '@/components/ui/copy-input';
import { FileInput } from '@/components/ui/file-input';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { InputMessage } from '@/components/ui/input-message';
import { Label } from '@/components/ui/label';
import * as RadioGroup from '@/components/ui/radio-group';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SizeProvider } from '@/components/ui/size-context';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormField, FormRow } from '@/components/patterns/form';
import { SettingsFieldRow } from '@/components/patterns/settings';
import { cn } from '@/lib/utils';
import type { FieldControlId, FieldState } from './field-controls';
import './fields-catalog-preview.css';

export interface FieldPreviewCellProps {
  control: FieldControlId;
  state: FieldState;
  label: string;
}

const options: ComboboxOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
];
const selectItems = options.map(({ value, label }) => ({ value, label }));

export function FieldPreviewCell({ control, state, label }: FieldPreviewCellProps) {
  const id = `field-${control}-${state}`;
  const labelId = `${id}-label`;
  const messageId = `${id}-message`;
  const invalid = state === 'invalid';
  const disabled = state === 'disabled';
  const readOnly = state === 'read-only';
  const required = state === 'required';
  const compact = state === 'compact-density';
  const forcedState = state === 'hover' ? 'hover' : state === 'focus-visible' ? 'focus' : undefined;
  const hasValue = state !== 'empty-placeholder';
  const message = invalid
    ? 'This field needs attention.'
    : state === 'help-text'
      ? 'Helpful context for this field.'
      : undefined;
  const fieldLabel =
    state === 'long-label'
      ? `${label} with a deliberately long label that wraps without obscuring the control`
      : label;
  const describedBy = message ? messageId : undefined;

  const wirePreviewField = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      let active = true;
      queueMicrotask(() => {
        if (!active) return;
        const target = node.querySelector<HTMLElement>(
          '[role="group"], [role="radiogroup"], input:not([type="file"]):not([aria-hidden="true"]), textarea, button',
        );
        target?.setAttribute('aria-labelledby', labelId);
        if (describedBy) target?.setAttribute('aria-describedby', describedBy);
      });
      return () => {
        active = false;
      };
    },
    [labelId, describedBy],
  );

  const prefix = <span aria-hidden="true">@</span>;
  const suffix = <span aria-hidden="true">.dev</span>;
  const clearAction = (
    <Button variant="ghost" size="compact" aria-label="Clear value">
      ×
    </Button>
  );

  // Svelte's unbound bindable values stay editable locally. React default values
  // preserve that behavior; a different fixture state resets its control subtree.
  return (
    <SizeProvider size={compact ? 'compact' : 'default'}>
      <article
        key={id}
        className={cn('fields-catalog-cell field-cell', state === 'zoom-200' && 'zoom-preview')}
        data-field-preview={`${control}-${state}`}
        data-field-state={state}
        data-readonly={readOnly || undefined}
      >
        {control === 'form-row' ? (
          <FormRow>
            <FormField
              label={fieldLabel}
              required={required}
              disabled={disabled}
              description={message && !invalid ? message : undefined}
              error={invalid ? message : undefined}
              control={(props) => (
                <Input
                  {...props}
                  defaultValue={hasValue ? 'Alpha' : ''}
                  placeholder="Enter a value"
                  readOnly={readOnly}
                  data-state={forcedState}
                />
              )}
            />
            <FormField
              label="Companion field"
              disabled={disabled}
              control={(props) => (
                <Input
                  {...props}
                  defaultValue={hasValue ? 'Beta' : ''}
                  placeholder="Second value"
                  readOnly={readOnly}
                  data-state={forcedState}
                />
              )}
            />
          </FormRow>
        ) : control === 'form-field' ? (
          <FormField
            label={fieldLabel}
            id={id}
            required={required}
            disabled={disabled}
            description={message && !invalid ? message : undefined}
            error={invalid ? message : undefined}
            control={(props) => (
              <Input
                {...props}
                defaultValue={hasValue ? 'Alpha' : ''}
                placeholder="Enter a value"
                readOnly={readOnly}
                data-state={forcedState}
              />
            )}
          />
        ) : control === 'settings-field-row' ? (
          <SettingsFieldRow
            id={`${id}-row`}
            label={fieldLabel}
            htmlFor={id}
            description={message && !invalid ? message : undefined}
            error={invalid ? message : undefined}
            disabled={disabled}
            compact={compact}
            control={({ labelId: rowLabelId, descriptionId, errorId }) => (
              <Input
                id={id}
                defaultValue={hasValue ? 'Alpha' : ''}
                placeholder="Enter a value"
                readOnly={readOnly}
                disabled={disabled}
                required={required}
                aria-labelledby={rowLabelId}
                aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
                aria-invalid={invalid || undefined}
                data-state={forcedState}
              />
            )}
          />
        ) : (
          <>
            <Label id={labelId} htmlFor={id} invalid={invalid} data-state={forcedState}>
              {fieldLabel}
              {required && (
                <>
                  <span aria-hidden="true"> *</span>
                  <span className="sr-only"> required</span>
                </>
              )}
            </Label>
            <div className="control-shell" ref={wirePreviewField}>
              {control === 'input-text' ? (
                <Input
                  id={id}
                  defaultValue={hasValue ? 'Alpha' : ''}
                  placeholder="Enter a value"
                  disabled={disabled}
                  readOnly={readOnly}
                  required={required}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  data-state={forcedState}
                />
              ) : control === 'input-prefix-suffix' ? (
                <InputGroup
                  leading={prefix}
                  trailing={suffix}
                  disabled={disabled}
                  invalid={invalid}
                  size={compact ? 'compact' : undefined}
                  data-state={forcedState}
                >
                  <Input
                    id={id}
                    defaultValue={hasValue ? 'alpha' : ''}
                    placeholder="username"
                    disabled={disabled}
                    readOnly={readOnly}
                    required={required}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    noFocusStyle
                  />
                </InputGroup>
              ) : control === 'input-clear' ? (
                <InputGroup
                  trailing={clearAction}
                  disabled={disabled}
                  invalid={invalid}
                  size={compact ? 'compact' : undefined}
                  data-state={forcedState}
                >
                  <Input
                    id={id}
                    defaultValue={hasValue ? 'Filter text' : ''}
                    placeholder="Filter results"
                    disabled={disabled}
                    readOnly={readOnly}
                    required={required}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    noFocusStyle
                  />
                </InputGroup>
              ) : control === 'input-password' ? (
                <Input
                  id={id}
                  type="password"
                  defaultValue={hasValue ? 'catalog-password' : ''}
                  placeholder="Enter a password"
                  disabled={disabled}
                  readOnly={readOnly}
                  required={required}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  data-state={forcedState}
                />
              ) : control === 'textarea-fixed' || control === 'textarea-autosize' ? (
                <Textarea
                  id={id}
                  defaultValue={hasValue ? 'A composed field value.' : ''}
                  placeholder="Describe this field"
                  disabled={disabled}
                  readOnly={readOnly}
                  required={required}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  data-state={forcedState}
                  doesExpandToFit={control === 'textarea-autosize'}
                  minHeight={72}
                  maxHeight={112}
                />
              ) : control === 'select' ? (
                <Select
                  defaultValue={hasValue ? 'alpha' : ''}
                  items={selectItems}
                  disabled={disabled}
                  required={required}
                  invalid={invalid}
                >
                  <SelectTrigger id={id} aria-describedby={describedBy} data-state={forcedState}>
                    <SelectValue placeholder="Choose an option" />
                  </SelectTrigger>
                </Select>
              ) : control === 'combobox' ? (
                <Combobox
                  defaultValue={hasValue ? 'alpha' : ''}
                  options={options}
                  placeholder="Choose an option"
                  ariaLabel={fieldLabel}
                  disabled={disabled}
                  invalid={invalid}
                  size={compact ? 'compact' : undefined}
                  portal={false}
                />
              ) : control === 'searchable-select' ? (
                <SearchableSelect
                  defaultValue={hasValue ? 'alpha' : ''}
                  options={options}
                  placeholder="Choose an option"
                  disabled={disabled}
                  className={compact ? '[&_input]:h-(--control-height-small)' : ''}
                />
              ) : control === 'checkbox' ? (
                <Checkbox
                  id={id}
                  defaultChecked={hasValue}
                  disabled={disabled}
                  readOnly={readOnly}
                  required={required}
                  invalid={invalid}
                  ariaDescribedby={describedBy}
                  size={compact ? 'sm' : 'md'}
                />
              ) : control === 'checkbox-group' ? (
                <CheckboxGroup.Root
                  defaultValue={hasValue ? ['alpha'] : []}
                  disabled={disabled}
                  required={required}
                  aria-describedby={describedBy}
                >
                  <CheckboxGroup.Item value="alpha" title="Alpha option" />
                  <CheckboxGroup.Item value="beta" title="Beta option" />
                </CheckboxGroup.Root>
              ) : control === 'radio-group' ? (
                <RadioGroup.Root
                  defaultValue={hasValue ? 'alpha' : ''}
                  disabled={disabled}
                  readOnly={readOnly}
                  required={required}
                  aria-describedby={describedBy}
                >
                  <RadioGroup.Item value="alpha" title="Alpha option" />
                  <RadioGroup.Item value="beta" title="Beta option" />
                </RadioGroup.Root>
              ) : control === 'switch' ? (
                <Switch
                  id={id}
                  defaultChecked={hasValue}
                  disabled={disabled}
                  required={required}
                  invalid={invalid}
                  ariaDescribedby={describedBy}
                  size={compact ? 'compact' : 'default'}
                />
              ) : control === 'slider' ? (
                <Slider
                  id={id}
                  defaultValue={hasValue ? 45 : 0}
                  disabled={disabled}
                  required={required}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  aria-label={fieldLabel}
                  className="w-full"
                />
              ) : control === 'file-input' ? (
                <FileInput
                  id={id}
                  label="Choose file"
                  emptyText="No file selected"
                  disabled={disabled}
                  required={required}
                  invalid={invalid}
                  size={compact ? 'compact' : undefined}
                  state={forcedState}
                  message={message && !invalid ? message : undefined}
                  error={invalid ? message : undefined}
                />
              ) : control === 'copy-input' ? (
                <CopyInput
                  value={hasValue ? 'intent://workspace/system-design' : 'intent://'}
                  label={fieldLabel}
                  disabled={disabled}
                  size={compact ? 'compact' : undefined}
                  aria-describedby={describedBy}
                  className="[&_[data-slot=copy-input-label]]:sr-only"
                />
              ) : control === 'input-group' ? (
                <InputGroup
                  leading={prefix}
                  trailing={suffix}
                  disabled={disabled}
                  invalid={invalid}
                  size={compact ? 'compact' : undefined}
                  data-state={forcedState}
                >
                  <Input
                    id={id}
                    defaultValue={hasValue ? 'workspace' : ''}
                    placeholder="Workspace slug"
                    disabled={disabled}
                    readOnly={readOnly}
                    required={required}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    noFocusStyle
                  />
                </InputGroup>
              ) : null}
            </div>
            {message && control !== 'file-input' && (
              <InputMessage id={messageId} tone={invalid ? 'error' : 'helper'}>
                {message}
              </InputMessage>
            )}
          </>
        )}
      </article>
    </SizeProvider>
  );
}
