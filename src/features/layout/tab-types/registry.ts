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
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { m } from '$shared/paraglide/messages.js';
import {
  getPanelDefaultWidthForType,
  getPanelDefaultWidthTier,
} from '$shared/panel-default-width-tiers';
import { getPanelDefaultWidth, type PanelDefaultWidthTier } from '$shared/panel-layout-sizing';

/**
 * Props that all tab type components must accept
 */
export interface TabTypeComponentProps {
  tab: PanelTab;
  workspaceId: string;
  /** Panel-layout state key; differs from workspaceId in column view. */
  layoutId?: string;
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
interface TabTypeMetadata {
  /** Unique type identifier (matches PanelTabType) */
  type: string;

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

  /** Intentional responsive width tier used for new, automatic, and reset sizing. */
  defaultWidthTier: PanelDefaultWidthTier;
}

export type TabTypeComponent = Component<TabTypeComponentProps>;
export type TabTypeComponentLoader = () => Promise<{ default: TabTypeComponent }>;

export type TabTypeDefinition = TabTypeMetadata &
  (
    | { loadComponent: TabTypeComponentLoader; component?: never }
    | { component: TabTypeComponent; loadComponent?: never }
  );

interface ComponentLoadState {
  registration: TabTypeDefinition;
  promise: Promise<TabTypeComponent>;
  component?: TabTypeComponent;
}

/**
 * Tab Type Registry
 *
 * Singleton registry for all tab types in the application.
 */
export class TabTypeRegistry {
  private types = new Map<string, TabTypeDefinition>();
  private componentLoads = new Map<string, ComponentLoadState>();

  /**
   * Register a new tab type
   */
  register(definition: TabTypeDefinition): void {
    if (this.types.has(definition.type)) {
      console.warn(`Tab type "${definition.type}" is already registered. Overwriting.`);
    }
    this.types.set(definition.type, definition);
    this.componentLoads.delete(definition.type);
  }

  /** Load a tab component once, sharing the import across every panel of this type. */
  loadComponent(type: string): Promise<TabTypeComponent> {
    const registration = this.types.get(type);
    if (!registration) {
      return Promise.reject(new Error(`Unknown tab type: ${type}`));
    }

    const cached = this.componentLoads.get(type);
    if (cached?.registration === registration) return cached.promise;

    const state = { registration } as ComponentLoadState;
    const promise =
      'component' in registration && registration.component
        ? Promise.resolve(registration.component)
        : Promise.resolve()
            .then(() => registration.loadComponent())
            .then((module) => module.default);
    state.promise = promise
      .then((component) => {
        if (this.componentLoads.get(type) === state) state.component = component;
        return component;
      })
      .catch((error: unknown) => {
        if (this.componentLoads.get(type) === state) this.componentLoads.delete(type);
        throw error;
      });
    this.componentLoads.set(type, state);
    return state.promise;
  }

  /** Return a resolved component without starting its loader. */
  getLoadedComponent(type: string): TabTypeComponent | undefined {
    const registration = this.types.get(type);
    if (!registration) return undefined;
    if ('component' in registration) return registration.component;
    const cached = this.componentLoads.get(type);
    return cached?.registration === registration ? cached.component : undefined;
  }

  /** Clear a rejected/stale load so the next request performs a fresh import. */
  resetComponentLoad(type: string): void {
    this.componentLoads.delete(type);
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
    return this.types.get(type)?.categoryLabel ?? m.layout_tabTypes_panel_category();
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

  /** Get the declared width tier, using the narrow safety fallback for unknown types. */
  getDefaultWidthTier(type: string): PanelDefaultWidthTier {
    return this.types.get(type)?.defaultWidthTier ?? getPanelDefaultWidthTier(type);
  }

  /** Resolve the intrinsic panel width for a tab type and usable viewport. */
  getDefaultWidth(type: string, viewportWidth = 0): number {
    const definition = this.types.get(type);
    return definition
      ? getPanelDefaultWidth(definition.defaultWidthTier, viewportWidth)
      : getPanelDefaultWidthForType(type, viewportWidth);
  }
}

// Export singleton instance
export const tabTypeRegistry = new TabTypeRegistry();
