import type { Snippet } from 'svelte';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

/**
 * Option for the Dropdown component
 */
export interface DropdownOption {
  /** Unique value for the option */
  value: string;
  /** Display label */
  label: string;
  /** Optional description shown below the label */
  description?: string;
  /** Optional icon (FontAwesome) */
  icon?: IconDefinition;
  /** Optional avatar URL */
  avatar?: string;
  /** Optional custom class */
  class?: string;
  /** Whether the option is disabled */
  disabled?: boolean;
  /** Any additional data */
  data?: Record<string, unknown>;
  /** Nested submenu options (for multi-stage dropdowns) */
  children?: DropdownOption[];
  /** Type of option - 'action' for clickable items, 'submenu' for items with children */
  type?: 'action' | 'submenu' | 'separator' | 'toggle';
  /** For toggle type - whether it's currently checked */
  checked?: boolean;
  /** Custom onclick handler (alternative to value-based selection) */
  onclick?: () => void;
  /** Keyboard shortcut to display (visual only) */
  shortcut?: string;
  /** Right-aligned text (like "default" label) */
  endLabel?: string;
}

/**
 * Group of options for grouped dropdowns
 */
export interface DropdownGroup {
  /** Unique key for the group */
  key: string;
  /** Display label for the group header */
  label: string;
  /** Optional icon for the group */
  icon?: IconDefinition;
  /** Options within this group */
  options: DropdownOption[];
}

/**
 * Props for custom item rendering snippet
 */
export interface DropdownItemProps {
  option: DropdownOption;
  selected: boolean;
  highlighted: boolean;
}

/**
 * Props for custom group header rendering snippet
 */
export interface DropdownGroupProps {
  group: DropdownGroup;
  groupIndex: number;
}

/**
 * Trigger variant styles
 */
export type DropdownTriggerVariant = 'default' | 'ghost' | 'outline' | 'inline';

/**
 * Trigger size options
 */
export type DropdownTriggerSize = 'xs' | 'sm' | 'md' | 'lg';
