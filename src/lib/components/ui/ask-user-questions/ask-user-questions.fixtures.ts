import type { UiComponentFixture } from '../component-metadata';

export const askUserQuestionsFixtures = [
  { id: 'playground', title: 'Playground', states: ['single-select', 'digit-shortcuts'] },
  {
    id: 'multiple-questions',
    title: 'Multiple questions',
    states: ['progress', 'advance', 'finish'],
  },
  {
    id: 'multi-select',
    title: 'Multi-select',
    states: ['multiple-selection', 'continue', 'finish'],
  },
  { id: 'with-other', title: 'With other', states: ['other', 'enter', 'shift-enter'] },
  { id: 'free-text', title: 'Free text', states: ['multiline', 'command-enter', 'auto-focus'] },
  {
    id: 'free-text-validation',
    title: 'Free text validation',
    states: ['invalid', 'error', 'valid'],
  },
  { id: 'skippable', title: 'Skippable', states: ['skip', 'callback', 'advance'] },
  { id: 'chip-on-left', title: 'Chip on left', states: ['left-chip', 'trailing-action'] },
  { id: 'stacked-layout', title: 'Stacked layout', states: ['stacked', 'long-description'] },
  { id: 'controlled', title: 'Controlled', states: ['controlled-index', 'controlled-answers'] },
].map((fixture) => ({
  ...fixture,
  themes: ['light', 'dark'] as const,
  viewport: 'both' as const,
  reducedMotion: true,
})) satisfies UiComponentFixture[];
