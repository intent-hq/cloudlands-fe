import {
  DEFAULT_PANEL_WIDTH,
  getPanelDefaultWidth,
  type PanelDefaultWidthTier,
} from './panel-layout-sizing';

/** Authoritative default tier for every built-in panel tab type on the frozen base. */
const PANEL_DEFAULT_WIDTH_TIERS = {
  agent: 'chat',
  'agent-overview': 'narrow',
  'activity-changes': 'wide',
  browser: 'wide',
  changes: 'wide',
  'chat-changes': 'wide',
  'code-review': 'wide',
  diff: 'wide',
  file: 'wide',
  'hook-script': 'medium',
  'local-changes': 'wide',
  map: 'wide',
  note: 'medium',
  overview: 'narrow',
  settings: 'narrow',
  terminal: 'medium',
} as const satisfies Record<string, PanelDefaultWidthTier>;

/** Resolve built-in types without importing the renderer tab registry. */
export function getPanelDefaultWidthTier(type: string): PanelDefaultWidthTier {
  return type in PANEL_DEFAULT_WIDTH_TIERS
    ? PANEL_DEFAULT_WIDTH_TIERS[type as keyof typeof PANEL_DEFAULT_WIDTH_TIERS]
    : 'narrow';
}

/** Resolve a built-in tab type against the usable panel viewport. */
export function getPanelDefaultWidthForType(type: string, viewportWidth = 0): number {
  return getPanelDefaultWidth(getPanelDefaultWidthTier(type), viewportWidth);
}

/** Preserve existing non-chat insertion widths while applying the canonical chat default. */
export function getPanelCreationWidthForType(type: string): number {
  return getPanelDefaultWidthTier(type) === 'chat'
    ? getPanelDefaultWidth('chat')
    : DEFAULT_PANEL_WIDTH;
}
