/**
 * Tab Type Registry
 *
 * Central registry for all panel tab types. Each tab type defines:
 * - Component to render
 * - Icon
 * - Default title
 * - Sidebar mapping (for "Reveal in Sidebar")
 * - Category label
 *
 * This replaces the hardcoded switch statements in PanelContentRenderer.
 */

import type { Component } from 'svelte';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import type { PanelTab } from '../panel-layout-manager.svelte';

/**
 * Props that all tab type components must accept
 */
export interface TabTypeComponentProps {
  tab: PanelTab;
  workspaceId: string;
  /** Whether this tab is currently the active/visible tab */
  isActive: boolean;
  /** Whether this panel is currently focused AND this tab is active */
  isPanelFocused: boolean;
  /** Called when content inside the panel receives focus (e.g., clicking in iframe) */
  onFocus?: () => void;
}

/**
 * Definition of a tab type
 */
export interface TabTypeDefinition {
  /** Unique type identifier (matches PanelTabType) */
  type: string;

  /** Svelte component to render for this tab type */
  component: Component<TabTypeComponentProps>;

  /** Icon to display in tab bar and headers */
  icon: IconDefinition;

  /** Default title when creating new tabs of this type */
  defaultTitle: string;

  /** Category label for grouping (e.g., "Notes", "Files", "Agents") */
  categoryLabel: string;

  /** Sidebar tab ID for "Reveal in Sidebar" feature (optional) */
  sidebarTabId?: string;

  /** Whether tabs of this type can be renamed */
  renameable?: boolean;
}

/**
 * Tab Type Registry
 *
 * Singleton registry for all tab types in the application.
 */
class TabTypeRegistry {
  private types = new Map<string, TabTypeDefinition>();

  /**
   * Register a new tab type
   */
  register(definition: TabTypeDefinition): void {
    if (this.types.has(definition.type)) {
      console.warn(`Tab type "${definition.type}" is already registered. Overwriting.`);
    }
    this.types.set(definition.type, definition);
  }

  /**
   * Get a tab type definition by type
   */
  get(type: string): TabTypeDefinition | undefined {
    return this.types.get(type);
  }

  /**
   * Get all registered tab types
   */
  getAll(): TabTypeDefinition[] {
    return Array.from(this.types.values());
  }

  /**
   * Check if a tab type is registered
   */
  has(type: string): boolean {
    return this.types.has(type);
  }

  /**
   * Get icon for a tab type
   */
  getIcon(type: string): IconDefinition | undefined {
    return this.types.get(type)?.icon;
  }

  /**
   * Get category label for a tab type
   */
  getCategoryLabel(type: string): string {
    return this.types.get(type)?.categoryLabel ?? 'Panel';
  }

  /**
   * Get sidebar tab ID for a tab type
   */
  getSidebarTabId(type: string): string | null {
    return this.types.get(type)?.sidebarTabId ?? null;
  }

  /**
   * Check if a tab type can be renamed
   */
  isRenameable(type: string): boolean {
    return this.types.get(type)?.renameable ?? false;
  }
}

// Export singleton instance
export const tabTypeRegistry = new TabTypeRegistry();
