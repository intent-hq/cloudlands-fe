<script lang="ts">
  /**
   * PanelContentHeader - Header for panel content
   *
   * Displays title, breadcrumbs, and actions based on the active tab type.
   * Integrates with ContentHeader for consistent styling.
   * Can receive overrides from content components via headerState.
   */

  import type { PanelTab } from '$features/layout/panel-layout-manager.svelte';
  import type { PanelHeaderState } from './panel-header-context.svelte';
  import type { Snippet } from 'svelte';
  import { ContentHeader } from '$lib/components/ui/content-header';
  import type { BreadcrumbItem } from '$lib/components/ui/content-header/types';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';

  interface Props {
    tab: PanelTab;
    /** Header state from content component (can override tab info) */
    headerState?: PanelHeaderState | null;
    /** Custom actions snippet provided by the content component */
    actions?: Snippet | null;
    /** Close tab handler */
    onClose?: () => void;
  }

  let { tab, headerState, actions, onClose }: Props = $props();

  // Use headerState overrides if provided, otherwise fall back to tab info
  const title = $derived(headerState?.title ?? tab.title);
  const subtitle = $derived(headerState?.subtitle);
  const editableTitle = $derived(headerState?.editableTitle ?? false);
  const onTitleChange = $derived(headerState?.onTitleChange);

  // Derive breadcrumbs based on tab type using registry
  const breadcrumbs = $derived.by((): BreadcrumbItem[] => {
    const categoryLabel = tabTypeRegistry.getCategoryLabel(tab.type);
    const icon = tabTypeRegistry.getIcon(tab.type);

    if (categoryLabel && icon) {
      return [{ label: categoryLabel, icon }];
    }
    return [];
  });

  // Get icon for tab type when no breadcrumbs
  const icon = $derived(tabTypeRegistry.getIcon(tab.type));
</script>

<ContentHeader
  {title}
  {subtitle}
  {breadcrumbs}
  icon={headerState?.icon ?? icon}
  showClose={tab.closable}
  {onClose}
  {editableTitle}
  {onTitleChange}
  actions={actions ?? undefined}
  class="shrink-0 border-b border-border"
/>
