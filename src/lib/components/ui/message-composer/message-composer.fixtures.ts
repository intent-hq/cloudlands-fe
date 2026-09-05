import type { UiComponentFixture } from '../component-metadata';

export const messageComposerFixtures = [
  {
    id: 'playground',
    title: 'Playground',
    states: ['idle', 'streaming-stop', 'streaming-queue', 'compact', 'light', 'dark'],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
  {
    id: 'basic',
    title: 'Basic',
    states: ['empty', 'draft', 'history-recall', 'auto-resize', 'hover', 'focus'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'suggestions',
    title: 'Suggestions',
    states: ['placeholder-suggestion', 'tab-fill', 'listbox', 'keyboard-highlight'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'attachments',
    title: 'Attachments',
    states: ['file-picker', 'drop-target', 'file-tiles', 'remove-file', 'max-files'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'queued-messages',
    title: 'Queued messages',
    states: ['queue', 'edit', 'delete', 'keyboard-reorder', 'drag-reorder', 'auto-dispatch'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'left-slot-only',
    title: 'Left slot only',
    states: ['left-slot'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'right-slot-only',
    title: 'Right slot only',
    states: ['right-slot'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'send-handler',
    title: 'Send handler',
    states: ['send', 'action-feedback'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'disabled',
    title: 'Disabled',
    states: ['disabled'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
