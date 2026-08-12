export const GENERAL_VISUAL_FIXTURES = [
  { id: 'general-light-desktop', theme: 'light', width: 1440, height: 1000 },
  { id: 'general-dark-desktop', theme: 'dark', width: 1440, height: 1000 },
  { id: 'general-light-compact', theme: 'light', width: 900, height: 760 },
  { id: 'general-dark-compact', theme: 'dark', width: 900, height: 760 },
] as const;

export const GENERAL_STATE_FIXTURES = [
  'no-apps',
  'installed-apps',
  'long-editor-label',
  'beta-success',
  'beta-failure',
  'update-available',
  'up-to-date',
  'reset-confirmation',
  'reset-cancelled',
  'reset-confirmed',
  'developer',
] as const;

export const GENERAL_ACCESSIBILITY_FIXTURE = {
  zoomPercent: 200,
  reducedMotion: true,
  overflow: 'none',
} as const;
