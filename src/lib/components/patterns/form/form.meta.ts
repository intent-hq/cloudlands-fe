import { parsePatternMetadata } from '../pattern-metadata';
import { formFixtures } from './form.fixtures';

export const formMetadata = parsePatternMetadata({
  id: 'form',
  source: 'src/lib/components/patterns/form/index.ts',
  publicImport: '$lib/components/patterns/form',
  exports: [
    'AutoSaveField',
    'Form',
    'FormActions',
    'FormField',
    'FormRow',
    'UnsavedIndicator',
    'createForm',
  ],
  owner: 'design-system',
  fixtures: formFixtures,
  useWhen: [
    'Building forms that need automatic label, description, error, and control wiring.',
    'Building settings fields that save after a debounce or on blur.',
  ],
  dontUseWhen: [
    'Rendering a single standalone control with no label or validation message.',
    'Building read-only key/value content; use the collection DataList pattern instead.',
  ],
  replaces: ['Raw form layout and repeated label/id/aria wiring.', 'AutoSaveTextarea internals.'],
});
