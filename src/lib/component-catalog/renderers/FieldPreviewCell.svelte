<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as CheckboxGroup from '$lib/components/ui/checkbox-group';
  import { Combobox, type ComboboxOption } from '$lib/components/ui/combobox';
  import { CopyInput } from '$lib/components/ui/copy-input';
  import { FileInput } from '$lib/components/ui/file-input';
  import { Input } from '$lib/components/ui/input';
  import { InputGroup } from '$lib/components/ui/input-group';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { Label } from '$lib/components/ui/label';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import { SearchableSelect } from '$lib/components/ui/searchable-select';
  import { Select } from '$lib/components/ui/select';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import { FormField, FormRow } from '$lib/components/patterns/form';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import type { FieldControlId, FieldState } from './field-controls';

  let { control, state, label }: { control: FieldControlId; state: FieldState; label: string } =
    $props();
  const id = $derived(`field-${control}-${state}`);
  const labelId = $derived(`${id}-label`);
  const messageId = $derived(`${id}-message`);
  const invalid = $derived(state === 'invalid');
  const disabled = $derived(state === 'disabled');
  const readonly = $derived(state === 'read-only');
  const required = $derived(state === 'required');
  const compact = $derived(state === 'compact-density');
  const forcedState = $derived(
    state === 'hover' ? 'hover' : state === 'focus-visible' ? 'focus' : undefined,
  );
  const hasValue = $derived(state !== 'empty-placeholder');
  const message = $derived(
    invalid
      ? 'This field needs attention.'
      : state === 'help-text'
        ? 'Helpful context for this field.'
        : undefined,
  );
  const fieldLabel = $derived(
    state === 'long-label'
      ? `${label} with a deliberately long label that wraps without obscuring the control`
      : label,
  );
  const options: ComboboxOption[] = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'beta', label: 'Beta' },
  ];
  const selectItems = options.map(({ value, label: optionLabel }) => ({
    value,
    label: optionLabel,
  }));
  const describedBy = $derived(message ? messageId : undefined);

  function wirePreviewField(node: HTMLElement) {
    queueMicrotask(() => {
      const target = node.querySelector<HTMLElement>(
        '[role="group"], [role="radiogroup"], input:not([type="file"]):not([aria-hidden="true"]), textarea, button',
      );
      target?.setAttribute('aria-labelledby', labelId);
      if (describedBy) target?.setAttribute('aria-describedby', describedBy);
    });
  }
</script>

{#snippet prefix()}<span aria-hidden="true">@</span>{/snippet}
{#snippet suffix()}<span aria-hidden="true">.dev</span>{/snippet}
{#snippet clearAction()}<Button variant="ghost" size="compact" aria-label="Clear value">×</Button
  >{/snippet}

<SizeProvider size={compact ? 'compact' : 'default'}>
  <article
    class:zoom-preview={state === 'zoom-200'}
    class="field-cell"
    data-field-preview={`${control}-${state}`}
    data-field-state={state}
    data-readonly={readonly || undefined}
  >
    {#if control === 'form-row'}
      <FormRow>
        <FormField
          label={fieldLabel}
          {required}
          {disabled}
          description={message && !invalid ? message : undefined}
          error={invalid ? message : undefined}
        >
          {#snippet control(props)}<Input
              {...props}
              value={hasValue ? 'Alpha' : ''}
              placeholder="Enter a value"
              {readonly}
              data-state={forcedState}
            />{/snippet}
        </FormField>
        <FormField label="Companion field" {disabled}>
          {#snippet control(props)}<Input
              {...props}
              value={hasValue ? 'Beta' : ''}
              placeholder="Second value"
              {readonly}
              data-state={forcedState}
            />{/snippet}
        </FormField>
      </FormRow>
    {:else if control === 'form-field'}
      <FormField
        label={fieldLabel}
        {id}
        {required}
        {disabled}
        description={message && !invalid ? message : undefined}
        error={invalid ? message : undefined}
      >
        {#snippet control(props)}<Input
            {...props}
            value={hasValue ? 'Alpha' : ''}
            placeholder="Enter a value"
            {readonly}
            data-state={forcedState}
          />{/snippet}
      </FormField>
    {:else if control === 'settings-field-row'}
      <SettingsFieldRow
        id={`${id}-row`}
        label={fieldLabel}
        htmlFor={id}
        description={message && !invalid ? message : undefined}
        error={invalid ? message : undefined}
        {disabled}
        {compact}
      >
        {#snippet control({ labelId: rowLabelId, descriptionId, errorId })}
          <Input
            {id}
            value={hasValue ? 'Alpha' : ''}
            placeholder="Enter a value"
            {readonly}
            {disabled}
            {required}
            aria-labelledby={rowLabelId}
            aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
            aria-invalid={invalid || undefined}
            data-state={forcedState}
          />
        {/snippet}
      </SettingsFieldRow>
    {:else}
      <Label id={labelId} for={id} {invalid} data-state={forcedState}>
        {fieldLabel}{#if required}<span aria-hidden="true"> *</span><span class="sr-only">
            required</span
          >{/if}
      </Label>
      <div class="control-shell" use:wirePreviewField>
        {#if control === 'input-text'}
          <Input
            {id}
            value={hasValue ? 'Alpha' : ''}
            placeholder="Enter a value"
            {disabled}
            {readonly}
            {required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-state={forcedState}
          />
        {:else if control === 'input-prefix-suffix'}
          <InputGroup
            leading={prefix}
            trailing={suffix}
            {disabled}
            {invalid}
            size={compact ? 'compact' : undefined}
            data-state={forcedState}
          >
            <Input
              {id}
              value={hasValue ? 'alpha' : ''}
              placeholder="username"
              {disabled}
              {readonly}
              {required}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              noFocusStyle
            />
          </InputGroup>
        {:else if control === 'input-clear'}
          <InputGroup
            trailing={clearAction}
            {disabled}
            {invalid}
            size={compact ? 'compact' : undefined}
            data-state={forcedState}
          >
            <Input
              {id}
              value={hasValue ? 'Filter text' : ''}
              placeholder="Filter results"
              {disabled}
              {readonly}
              {required}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              noFocusStyle
            />
          </InputGroup>
        {:else if control === 'input-password'}
          <Input
            {id}
            type="password"
            value={hasValue ? 'catalog-password' : ''}
            placeholder="Enter a password"
            {disabled}
            {readonly}
            {required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-state={forcedState}
          />
        {:else if control === 'textarea-fixed' || control === 'textarea-autosize'}
          <Textarea
            {id}
            value={hasValue ? 'A composed field value.' : ''}
            placeholder="Describe this field"
            {disabled}
            {readonly}
            {required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-state={forcedState}
            doesExpandToFit={control === 'textarea-autosize'}
            minHeight={72}
            maxHeight={112}
          />
        {:else if control === 'select'}
          <Select.Root
            value={hasValue ? 'alpha' : ''}
            items={selectItems}
            {disabled}
            {required}
            {invalid}
          >
            <Select.Trigger {id} aria-describedby={describedBy} data-state={forcedState}
              ><Select.Value placeholder="Choose an option" /></Select.Trigger
            >
          </Select.Root>
        {:else if control === 'combobox'}
          <Combobox
            value={hasValue ? 'alpha' : ''}
            {options}
            placeholder="Choose an option"
            ariaLabel={fieldLabel}
            {disabled}
            {invalid}
            size={compact ? 'compact' : undefined}
            portal={false}
          />
        {:else if control === 'searchable-select'}
          <SearchableSelect
            value={hasValue ? 'alpha' : ''}
            {options}
            placeholder="Choose an option"
            {disabled}
            class={compact ? '[&_input]:h-(--control-height-small)' : ''}
          />
        {:else if control === 'checkbox'}
          <Checkbox
            {id}
            checked={hasValue}
            {disabled}
            {readonly}
            {required}
            {invalid}
            ariaDescribedby={describedBy}
            size={compact ? 'sm' : 'md'}
          />
        {:else if control === 'checkbox-group'}
          <CheckboxGroup.Root
            value={hasValue ? ['alpha'] : []}
            {disabled}
            {required}
            aria-describedby={describedBy}
          >
            <CheckboxGroup.Item value="alpha" title="Alpha option" />
            <CheckboxGroup.Item value="beta" title="Beta option" />
          </CheckboxGroup.Root>
        {:else if control === 'radio-group'}
          <RadioGroup.Root
            value={hasValue ? 'alpha' : ''}
            {disabled}
            {readonly}
            {required}
            aria-describedby={describedBy}
          >
            <RadioGroup.Item value="alpha" title="Alpha option" />
            <RadioGroup.Item value="beta" title="Beta option" />
          </RadioGroup.Root>
        {:else if control === 'switch'}
          <Switch
            {id}
            checked={hasValue}
            {disabled}
            {required}
            {invalid}
            ariaDescribedby={describedBy}
            size={compact ? 'compact' : 'default'}
          />
        {:else if control === 'slider'}
          <Slider
            {id}
            value={hasValue ? 45 : 0}
            {disabled}
            {required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-label={fieldLabel}
            class="w-full"
          />
        {:else if control === 'file-input'}
          <FileInput
            {id}
            label="Choose file"
            emptyText="No file selected"
            {disabled}
            {required}
            {invalid}
            size={compact ? 'compact' : undefined}
            state={forcedState}
            message={message && !invalid ? message : undefined}
            error={invalid ? message : undefined}
          />
        {:else if control === 'copy-input'}
          <CopyInput
            value={hasValue ? 'intent://workspace/system-design' : 'intent://'}
            label={fieldLabel}
            {disabled}
            size={compact ? 'compact' : undefined}
            aria-describedby={describedBy}
            class="[&_[data-slot=copy-input-label]]:sr-only"
          />
        {:else if control === 'input-group'}
          <InputGroup
            leading={prefix}
            trailing={suffix}
            {disabled}
            {invalid}
            size={compact ? 'compact' : undefined}
            data-state={forcedState}
          >
            <Input
              {id}
              value={hasValue ? 'workspace' : ''}
              placeholder="Workspace slug"
              {disabled}
              {readonly}
              {required}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              noFocusStyle
            />
          </InputGroup>
        {/if}
      </div>
      {#if message && control !== 'file-input'}
        <InputMessage id={messageId} tone={invalid ? 'error' : 'helper'}>{message}</InputMessage>
      {/if}
    {/if}
  </article>
</SizeProvider>

<style>
  .field-cell {
    min-width: 0;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--background));
    padding: var(--space-3);
  }
  .control-shell {
    min-width: 0;
    margin-top: var(--space-1);
  }
  .field-cell[data-readonly='true'] .control-shell {
    pointer-events: none;
  }
  .field-cell[data-field-state='hover'] .control-shell :global([data-slot='input']),
  .field-cell[data-field-state='hover'] .control-shell :global([data-slot='textarea']),
  .field-cell[data-field-state='hover'] .control-shell :global(button) {
    background-color: hsl(var(--hover));
  }
  .field-cell[data-field-state='focus-visible'] .control-shell :global(input),
  .field-cell[data-field-state='focus-visible'] .control-shell :global(textarea),
  .field-cell[data-field-state='focus-visible'] .control-shell :global(button) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
  }
  .field-cell[data-field-state='focus-visible'] .control-shell :global([data-slot='input']),
  .field-cell[data-field-state='focus-visible'] .control-shell :global([data-slot='textarea']),
  .field-cell[data-field-state='focus-visible'] .control-shell :global([data-slot='input-group']) {
    background-color: hsl(var(--card));
    box-shadow: inset 0 0 0 1px hsl(var(--ring));
  }
  .zoom-preview {
    width: 50%;
    zoom: 2;
  }
</style>
