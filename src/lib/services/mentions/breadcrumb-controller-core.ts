/**
 * Breadcrumb Navigation Controller for Hierarchical Mention Navigation
 *
 * Framework-neutral algorithm; each renderer injects instance-local reactive state.
 */

import type { BreadcrumbItem, MentionGroup, MentionCandidate } from './types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('BreadcrumbController');

export interface BreadcrumbNavigation {
  breadcrumbs: BreadcrumbItem[];
  currentGroup: string | null;
  currentItems: MentionCandidate[];
}

export class BreadcrumbController {
  private groupStack: MentionGroup[] = [];

  constructor(private readonly state: BreadcrumbNavigation) {}

  // Getters for reactive access
  get breadcrumbs() {
    return this.state.breadcrumbs;
  }

  get currentGroup() {
    return this.state.currentGroup;
  }

  get currentItems() {
    return this.state.currentItems;
  }

  push(group: MentionGroup) {
    // Add to breadcrumb trail
    this.state.breadcrumbs = [
      ...this.state.breadcrumbs,
      {
        id: group.id,
        label: group.label,
        icon: group.icon,
      },
    ];

    // Update current group
    this.state.currentGroup = group.id;

    // Store group in stack for navigation
    this.groupStack.push(group);

    // Update current items
    if (group.items) {
      this.state.currentItems = group.items;
    }

    logger.debug('[BreadcrumbController] Pushed group:', group.label);
  }

  pop(): boolean {
    if (this.state.breadcrumbs.length === 0) {
      return false;
    }

    // Remove last breadcrumb
    const newBreadcrumbs = this.state.breadcrumbs.slice(0, -1);
    this.state.breadcrumbs = newBreadcrumbs;

    // Update current group
    if (newBreadcrumbs.length > 0) {
      const lastBreadcrumb = newBreadcrumbs[newBreadcrumbs.length - 1];
      this.state.currentGroup = lastBreadcrumb.id;

      // Find and set items for the parent group
      const parentGroup = this.groupStack[newBreadcrumbs.length - 1];
      if (parentGroup?.items) {
        this.state.currentItems = parentGroup.items;
      }
    } else {
      this.state.currentGroup = null;
      this.state.currentItems = [];
    }

    // Remove from stack
    this.groupStack.pop();

    logger.debug('[BreadcrumbController] Popped to:', this.state.currentGroup);
    return true;
  }

  navigateToRoot() {
    this.state.breadcrumbs = [];
    this.state.currentGroup = null;
    this.state.currentItems = [];
    this.groupStack = [];
    logger.debug('[BreadcrumbController] Navigated to root');
  }

  navigateToBreadcrumb(index: number) {
    if (index < 0 || index >= this.state.breadcrumbs.length) {
      return;
    }

    // Keep breadcrumbs up to and including the selected index
    const newBreadcrumbs = this.state.breadcrumbs.slice(0, index + 1);
    this.state.breadcrumbs = newBreadcrumbs;

    // Update current group
    const targetBreadcrumb = newBreadcrumbs[index];
    this.state.currentGroup = targetBreadcrumb.id;

    // Update stack and items
    this.groupStack = this.groupStack.slice(0, index + 1);
    const targetGroup = this.groupStack[index];
    if (targetGroup?.items) {
      this.state.currentItems = targetGroup.items;
    }

    logger.debug('[BreadcrumbController] Navigated to breadcrumb:', targetBreadcrumb.label);
  }

  handleKeyboard(
    event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>,
  ): boolean {
    switch (event.key) {
      case 'ArrowLeft':
        // Navigate back in breadcrumbs
        if (this.state.breadcrumbs.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          return this.pop();
        }
        break;

      case 'Escape':
        // Clear breadcrumbs and go to root
        if (this.state.breadcrumbs.length > 0) {
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
    return this.state.breadcrumbs.length > 0;
  }

  getCurrentPath(): string {
    return this.state.breadcrumbs.map((b) => b.label).join(' › ');
  }

  // Store subscriptions - these now return functions that can be called in $effect
  subscribeToBreadcrumbs(callback: (breadcrumbs: BreadcrumbItem[]) => void) {
    // In Svelte 5, we can't subscribe directly. The consumer should use $effect
    // This method is kept for backward compatibility but should be refactored
    let lastValue = this.state.breadcrumbs;
    const checkForChanges = () => {
      if (this.state.breadcrumbs !== lastValue) {
        lastValue = this.state.breadcrumbs;
        callback(this.state.breadcrumbs);
      }
    };
    // Return a function that can be called in a $effect
    return checkForChanges;
  }

  subscribeToCurrentGroup(callback: (groupId: string | null) => void) {
    // Similar approach for backward compatibility
    let lastValue = this.state.currentGroup;
    const checkForChanges = () => {
      if (this.state.currentGroup !== lastValue) {
        lastValue = this.state.currentGroup;
        callback(this.state.currentGroup);
      }
    };
    return checkForChanges;
  }

  subscribeToCurrentItems(callback: (items: MentionCandidate[]) => void) {
    // Similar approach for backward compatibility
    let lastValue = this.state.currentItems;
    const checkForChanges = () => {
      if (this.state.currentItems !== lastValue) {
        lastValue = this.state.currentItems;
        callback(this.state.currentItems);
      }
    };
    return checkForChanges;
  }

  destroy() {
    // Clean up if needed
    this.navigateToRoot();
  }
}
