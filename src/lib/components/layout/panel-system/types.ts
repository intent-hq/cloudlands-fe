/**
 * Panel System Types
 */

/** Layout preset types */
export type LayoutPresetId =
  | 'single'
  | 'split-horizontal'
  | 'split-vertical'
  | 'three-column'
  | 'grid-2x2'
  | 'planning'
  | 'agents-row'
  | 'changes'
  | 'review';

/** Preset configuration */
export interface LayoutPreset {
  id: LayoutPresetId;
  label: string;
  description: string;
  isBuiltIn: boolean;
}
