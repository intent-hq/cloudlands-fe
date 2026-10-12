import { useEffect, useState } from 'react';
import { useSignal } from '@preact/signals-react';
import {
  BreadcrumbController,
  type BreadcrumbNavigation,
} from '$lib/services/mentions/breadcrumb-controller-core';

/** One popup's ephemeral navigation; the shared algorithm owns all transitions. */
export function useMentionBreadcrumbs() {
  const state = useSignal<BreadcrumbNavigation>({
    breadcrumbs: [],
    currentGroup: null,
    currentItems: [],
  });
  const [controller] = useState(
    () =>
      new BreadcrumbController({
        get breadcrumbs() {
          return state.value.breadcrumbs;
        },
        set breadcrumbs(breadcrumbs) {
          state.value = { ...state.peek(), breadcrumbs };
        },
        get currentGroup() {
          return state.value.currentGroup;
        },
        set currentGroup(currentGroup) {
          state.value = { ...state.peek(), currentGroup };
        },
        get currentItems() {
          return state.value.currentItems;
        },
        set currentItems(currentItems) {
          state.value = { ...state.peek(), currentItems };
        },
      }),
  );
  useEffect(() => () => controller.destroy(), [controller]);
  return { controller, state };
}
