import { parsePatternMetadata } from '../pattern-metadata';
import { confirmFixtures } from './confirm.fixtures';

export const confirmMetadata = parsePatternMetadata({
  id: 'confirm',
  source: 'src/lib/components/patterns/confirm/index.ts',
  publicImport: '$lib/components/patterns/confirm',
  exports: ['ConfirmHost', 'DestructiveConfirm', 'FormDialog', 'alert', 'confirm', 'prompt'],
  owner: 'design-system',
  fixtures: confirmFixtures,
  useWhen: [
    'Blocking an action until the user confirms, enters one value, or acknowledges a message.',
    'Building a dialog whose content is a form with standard actions.',
  ],
  dontUseWhen: [
    'Reporting non-blocking status; use the notification service instead.',
    'Building a multi-step flow; use a dedicated screen or wizard composition.',
  ],
  replaces: [
    'Browser confirm, prompt, and alert APIs.',
    'InputDialog, MessageDialog, and one-off destructive confirmation markup.',
  ],
});
