import type { UiComponentFixture } from './component-metadata';

// A loaded image is not a fixture state: the contract capture runs where images never
// complete, so the `<img>` branch is covered by the characterization test instead.
const presenceStackStates = [
  'no-url',
  'failing-url',
  'self',
  'owner',
  'member',
  'offline',
  'overflow',
];

export const principalAvatarFixtures = [
  {
    id: 'tile-states',
    title: 'Avatar tile — initial and failed image',
    states: ['no-url', 'failing-url', 'size-16', 'size-24', 'size-32', 'empty-label', 'fill'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'presence-stack-default',
    title: 'Presence stack — named by tooltip',
    states: presenceStackStates,
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'presence-stack-action',
    title: 'Presence stack — each avatar a button',
    states: [...presenceStackStates, 'aria-disabled'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'presence-stack-decorative',
    title: 'Presence stack — decorative (parent names the people)',
    states: presenceStackStates,
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
