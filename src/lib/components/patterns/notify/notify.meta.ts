import { parsePatternMetadata } from '../pattern-metadata';
import { notifyFixtures } from './notify.fixtures';

export const notifyMetadata = parsePatternMetadata({
  id: 'notify',
  source: 'src/lib/components/patterns/notify/index.ts',
  publicImport: '$lib/components/patterns/notify',
  exports: ['notify', 'NOTIFY_DURATION', 'withToastCountdown'],
  owner: 'design-system',
  fixtures: notifyFixtures,
  useWhen: [
    'Reporting transient success, information, warning, or error feedback.',
    'Reporting progress or a reversible action that needs a consistent duration and deduplication policy.',
  ],
  dontUseWhen: [
    'The user must make a decision before continuing; use the Confirm pattern instead.',
    'The message is persistent page content or field-level validation feedback.',
  ],
  replaces: ['Direct svelte-sonner calls and feature-specific toast policy wrappers.'],
});
