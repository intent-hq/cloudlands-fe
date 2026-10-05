export const fieldControls = [
  { id: 'input-text', label: 'Input · text' },
  { id: 'input-prefix-suffix', label: 'Input · prefix / suffix' },
  { id: 'input-clear', label: 'Input · clear action' },
  { id: 'input-password', label: 'Input · password' },
  { id: 'textarea-fixed', label: 'Textarea · fixed' },
  { id: 'textarea-autosize', label: 'Textarea · autosize' },
  { id: 'select', label: 'Select' },
  { id: 'combobox', label: 'Combobox' },
  { id: 'searchable-select', label: 'SearchableSelect' },
  { id: 'checkbox', label: 'Checkbox · single' },
  { id: 'checkbox-group', label: 'Checkbox · group' },
  { id: 'radio-group', label: 'RadioGroup' },
  { id: 'switch', label: 'Switch' },
  { id: 'slider', label: 'Slider' },
  { id: 'file-input', label: 'FileInput' },
  { id: 'copy-input', label: 'CopyInput' },
  { id: 'input-group', label: 'InputGroup' },
  { id: 'form-row', label: 'FormRow composition' },
  { id: 'form-field', label: 'FormField composition' },
  { id: 'settings-field-row', label: 'SettingsFieldRow composition' },
] as const;

export const fieldStates = [
  'empty-placeholder',
  'filled',
  'hover',
  'focus-visible',
  'invalid',
  'disabled',
  'read-only',
  'help-text',
  'required',
  'long-label',
  'compact-density',
  'zoom-200',
] as const;

export type FieldControlId = (typeof fieldControls)[number]['id'];
export type FieldState = (typeof fieldStates)[number];
