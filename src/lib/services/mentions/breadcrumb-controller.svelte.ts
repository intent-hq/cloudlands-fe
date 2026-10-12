import { BreadcrumbController as BreadcrumbControllerCore } from './breadcrumb-controller-core';
import type { BreadcrumbItem, MentionCandidate } from './types';

// Compatibility facade for EnhancedMentionList and MentionSystem. Retain the
// existing import and rune reactivity until the Svelte renderer is retired.
export class BreadcrumbController extends BreadcrumbControllerCore {
  constructor() {
    let breadcrumbs = $state<BreadcrumbItem[]>([]);
    let currentGroup = $state<string | null>(null);
    let currentItems = $state<MentionCandidate[]>([]);
    super({
      get breadcrumbs() {
        return breadcrumbs;
      },
      set breadcrumbs(value) {
        breadcrumbs = value;
      },
      get currentGroup() {
        return currentGroup;
      },
      set currentGroup(value) {
        currentGroup = value;
      },
      get currentItems() {
        return currentItems;
      },
      set currentItems(value) {
        currentItems = value;
      },
    });
  }
}
