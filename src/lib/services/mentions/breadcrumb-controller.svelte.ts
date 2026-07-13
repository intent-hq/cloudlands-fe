/**
 * Breadcrumb Navigation Controller for Hierarchical Mention Navigation
 *
 * Uses Svelte 5 runes for state management
 */

import type { BreadcrumbItem, MentionGroup, MentionCandidate } from './types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('BreadcrumbController');

export class BreadcrumbController {
  private _breadcrumbs: BreadcrumbItem[] = $state([]);
  private _currentGroup: string | null = $state(null);
  private _currentItems: MentionCandidate[] = $state([]);
  private groupStack: MentionGroup[] = [];

  constructor() {
    // State is initialized with $state above
  }

  // Getters for reactive access
  get breadcrumbs() {
    return this._breadcrumbs;
  }

  get currentGroup() {
    return this._currentGroup;
  }

  get currentItems() {
    return this._currentItems;
  }

  push(group: MentionGroup) {
    // Add to breadcrumb trail
    this._breadcrumbs = [
      ...this._breadcrumbs,
      {
        id: group.id,
        label: group.label,
        icon: group.icon,
      },
    ];

    // Update current group
    this._currentGroup = group.id;

    // Store group in stack for navigation
    this.groupStack.push(group);

    // Update current items
    if (group.items) {
      this._currentItems = group.items;
    }

    logger.debug('[BreadcrumbController] Pushed group:', group.label);
  }

  pop(): boolean {
    if (this._breadcrumbs.length === 0) {
      return false;
    }

    // Remove last breadcrumb
    const newBreadcrumbs = this._breadcrumbs.slice(0, -1);
    this._breadcrumbs = newBreadcrumbs;

    // Update current group
    if (newBreadcrumbs.length > 0) {
      const lastBreadcrumb = newBreadcrumbs[newBreadcrumbs.length - 1];
      this._currentGroup = lastBreadcrumb.id;

      // Find and set items for the parent group
      const parentGroup = this.groupStack[newBreadcrumbs.length - 1];
      if (parentGroup?.items) {
        this._currentItems = parentGroup.items;
      }
    } else {
      this._currentGroup = null;
      this._currentItems = [];
    }

    // Remove from stack
    this.groupStack.pop();

    logger.debug('[BreadcrumbController] Popped to:', this._currentGroup);
    return true;
  }

  navigateToRoot() {
    this._breadcrumbs = [];
    this._currentGroup = null;
    this._currentItems = [];
    this.groupStack = [];
    logger.debug('[BreadcrumbController] Navigated to root');
  }

  navigateToBreadcrumb(index: number) {
    if (index < 0 || index >= this._breadcrumbs.length) {
      return;
    }

    // Keep breadcrumbs up to and including the selected index
    const newBreadcrumbs = this._breadcrumbs.slice(0, index + 1);
    this._breadcrumbs = newBreadcrumbs;

    // Update current group
    const targetBreadcrumb = newBreadcrumbs[index];
    this._currentGroup = targetBreadcrumb.id;

    // Update stack and items
    this.groupStack = this.groupStack.slice(0, index + 1);
    const targetGroup = this.groupStack[index];
    if (targetGroup?.items) {
      this._currentItems = targetGroup.items;
    }

    logger.debug('[BreadcrumbController] Navigated to breadcrumb:', targetBreadcrumb.label);
  }

  handleKeyboard(event: KeyboardEvent): boolean {
    switch (event.key) {
      case 'ArrowLeft':
        // Navigate back in breadcrumbs
        if (this._breadcrumbs.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          return this.pop();
        }
        break;

      case 'Escape':
        // Clear breadcrumbs and go to root
        if (this._breadcrumbs.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          this.navigateToRoot();
          return true;
        }
        break;
    }

    return false;
  }

  isInGroup(): boolean {
    return this._breadcrumbs.length > 0;
  }

  getCurrentPath(): string {
    return this._breadcrumbs.map((b) => b.label).join(' › ');
  }

  // Store subscriptions - these now return functions that can be called in $effect
  subscribeToBreadcrumbs(callback: (breadcrumbs: BreadcrumbItem[]) => void) {
    // In Svelte 5, we can't subscribe directly. The consumer should use $effect
    // This method is kept for backward compatibility but should be refactored
    let lastValue = this._breadcrumbs;
    const checkForChanges = () => {
      if (this._breadcrumbs !== lastValue) {
        lastValue = this._breadcrumbs;
        callback(this._breadcrumbs);
      }
    };
    // Return a function that can be called in a $effect
    return checkForChanges;
  }

  subscribeToCurrentGroup(callback: (groupId: string | null) => void) {
    // Similar approach for backward compatibility
    let lastValue = this._currentGroup;
    const checkForChanges = () => {
      if (this._currentGroup !== lastValue) {
        lastValue = this._currentGroup;
        callback(this._currentGroup);
      }
    };
    return checkForChanges;
  }

  subscribeToCurrentItems(callback: (items: MentionCandidate[]) => void) {
    // Similar approach for backward compatibility
    let lastValue = this._currentItems;
    const checkForChanges = () => {
      if (this._currentItems !== lastValue) {
        lastValue = this._currentItems;
        callback(this._currentItems);
      }
    };
    return checkForChanges;
  }

  destroy() {
    // Clean up if needed
    this.navigateToRoot();
  }
}
