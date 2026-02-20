<script lang="ts">
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import { ContentHeader } from './content-header';
  import type { BreadcrumbItem } from './content-header/types';
  import { fly } from 'svelte/transition';

  interface Props {
    title: string;
    subtitle?: string;
    faIcon?: IconDefinition;
    /** Breadcrumb items for category navigation */
    breadcrumbs?: BreadcrumbItem[];
    onClose?: () => void;
    showClose?: boolean;
    class?: string;
    contentClass?: string;
    headerClass?: string;
    actions?: Snippet;
    children?: Snippet;
    editableTitle?: boolean;
    onTitleChange?: (newTitle: string) => void;
    /** Navigation state - always visible in header */
    canGoBack?: boolean;
    canGoForward?: boolean;
    onNavigateBack?: () => void;
    onNavigateForward?: () => void;
  }

  let {
    title,
    subtitle,
    faIcon,
    breadcrumbs = [],
    onClose,
    showClose = false,
    class: className = '',
    contentClass = '',
    headerClass = '',
    actions,
    children,
    editableTitle = false,
    onTitleChange,
    canGoBack = false,
    canGoForward = false,
    onNavigateBack,
    onNavigateForward,
  }: Props = $props();
</script>

<div
  class="flex-1 min-h-0 h-[calc(100%_-_1.5rem)] flex flex-col overflow-auto rounded shadow shadow-muted-foreground/15 border border-border bg-background my-3.5 col-span-full row-span-full {className}"
  in:fly={{
    y: 10,
    duration: 200,
  }}
  out:fly={{
    y: 10,
    duration: 200,
  }}
>
  <!-- Fixed header using ContentHeader -->
  <ContentHeader
    {title}
    {subtitle}
    {breadcrumbs}
    icon={faIcon}
    {canGoBack}
    {canGoForward}
    {onNavigateBack}
    {onNavigateForward}
    {showClose}
    {onClose}
    {editableTitle}
    {onTitleChange}
    {actions}
    class={headerClass}
  />

  <!-- Scrollable content -->
  <div class="flex-1 min-h-0 {contentClass}">
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>

<!-- Scrollbar styles are defined globally in app.css -->
