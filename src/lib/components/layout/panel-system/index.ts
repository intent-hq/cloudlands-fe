/**
 * Panel System Components
 *
 * A VS Code-like panel system that supports:
 * - Splittable panels (horizontal/vertical)
 * - Tabs within each panel
 * - Focus management
 * - Drag and drop between panels
 */

export { default as LayoutPresetDropdown } from './LayoutPresetDropdown.svelte';
export { default as Panel } from './Panel.svelte';
export { default as PanelContainer } from './PanelContainer.svelte';
export { default as PanelContentRenderer } from './PanelContentRenderer.svelte';
export { default as PanelLayout } from './PanelLayout.svelte';
export { default as PanelLayoutControls } from './PanelLayoutControls.svelte';
export { default as PanelLayoutHeader } from './PanelLayoutHeader.svelte';
export { default as PanelMinimap } from './PanelMinimap.svelte';
export { default as PanelSplitHandle } from './PanelSplitHandle.svelte';
export { default as PanelTabBar } from './PanelTabBar.svelte';

// Re-export types
export type { LayoutPreset, LayoutPresetId } from './types';

// Legacy type exports (deprecated, use LayoutPresetId instead)
export type ContentPresetId =
  | 'focus-agent'
  | 'focus-code'
  | 'focus-notes'
  | 'code-review'
  | 'research';
