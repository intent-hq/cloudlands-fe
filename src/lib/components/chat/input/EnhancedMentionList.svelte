<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    MentionCandidate,
    MentionGroup,
    BreadcrumbItem,
  } from '$lib/services/mentions/types';
  import { isMentionGroup } from '$lib/services/mentions/types';
  import { BreadcrumbController } from '$lib/services/mentions/breadcrumb-controller.svelte';
  import { getIconForType } from '$lib/services/mentions/icon-map';
  import { faNote } from '$lib/icons/faNote';
  import Fa from 'svelte-fa';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { getAvatarStateFromStore } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { m } from '$shared/paraglide/messages.js';
  import {
  faFile,
  faFileCode,
  faFileAlt,
  faFolder,
  faFolderOpen,
  faListCheck,
  faSquareCheck,
  faShield,
  faTerminal,
  faExternalLinkAlt,
  faGlobe,
  faPalette,
  faDatabase,
  faCog,
  faLock,
  faCodeBranch,
  faBox,
  faWrench,
  faCube,
  faImage,
  faFlask,
  faBookOpen,
  faCheckSquare,
  faUsers,
  faLightbulb,
  faPenFancy,
  faBug,
  faMagicWandSparkles,
  faChartLine,
  faSync,
  faShieldAlt,
  faAlignLeft,
  faPlay,
  faHammer,
  faRocket,
  faCopy,
  faChevronRight,
  faRobot,
  faBrain,
  faUserTie,
  faUserGraduate,
  faChalkboardTeacher,
  faBolt,
} from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    items: (MentionCandidate | MentionGroup)[];
    command: (props: any) => void;
    onClose?: () => void;
    loading?: boolean;
  }

  let { items = [], command, onClose, loading = false }: Props = $props();

  let selectedIndex = $state(0);
  let breadcrumbs: BreadcrumbItem[] = $state([]);
  let currentItems: (MentionCandidate | MentionGroup)[] = $state(items);
  let breadcrumbController: BreadcrumbController;
  let listElement: HTMLDivElement;

  // Prevent mouseenter from changing selectedIndex when the popup first appears
  // under the mouse cursor. Only allow mouse-based selection after actual mouse movement.
  let ignoreMouseUntilMove = $state(true);

  // Get the currently selected item for preview
  // Note: selectedIndex is a visual-order index (matching grouped display order),
  // so we look up via visualOrderItems which is derived from groupedItems.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const selectedItem = $derived.by(() => {
    // visualOrderItems may not be initialized yet during first render pass,
    // fall back to currentItems for safety
    if (typeof visualOrderItems !== 'undefined' && visualOrderItems.length > 0) {
      return visualOrderItems[selectedIndex] || null;
    }
    return currentItems[selectedIndex] || null;
  });

  // Helper to get icon component
  function getIcon(item: MentionCandidate | MentionGroup): IconDefinition {
    const type = isMentionGroup(item) ? 'group' : item.type;
    const iconName = getIconForType(type as any, (item as any).subtype);
    // Map icon names to Font Awesome icons
    const iconMap: Record<string, IconDefinition> = {
      file: faFile,
      'file-code': faFileCode,
      'file-text': faFileAlt,
      'file-json': faFileCode,
      folder: faFolder,
      'folder-open': faFolderOpen,
      'folder-code': faFolder,
      'sticky-note': faNote,
      'list-todo': faListCheck,
      'check-square': faSquareCheck,
      shield: faShield,
      terminal: faTerminal,
      'external-link': faExternalLinkAlt,
      globe: faGlobe,
      palette: faPalette,
      database: faDatabase,
      settings: faCog,
      lock: faLock,
      'git-branch': faCodeBranch,
      box: faBox,
      wrench: faWrench,
      package: faCube,
      image: faImage,
      'test-tube': faFlask,
      'book-open': faBookOpen,
      'package-check': faCheckSquare,
      users: faUsers,
      lightbulb: faLightbulb,
      'pen-tool': faPenFancy,
      bug: faBug,
      sparkles: faMagicWandSparkles,
      'trending-up': faChartLine,
      'refresh-cw': faSync,
      'shield-check': faShieldAlt,
      'align-left': faAlignLeft,
      'shield-alert': faShieldAlt,
      play: faPlay,
      hammer: faHammer,
      rocket: faRocket,
      github: faCodeBranch,
      gitlab: faCodeBranch,
      files: faCopy,
      folders: faFolder,
      'chevron-right': faChevronRight,
      // Personality icons
      'user-tie': faUserTie,
      'user-graduate': faUserGraduate,
      'chalkboard-teacher': faChalkboardTeacher,
      bolt: faBolt,
      // Agent icons
      robot: faRobot,
      brain: faBrain,
      // Specialist icons (user-tie already mapped above)
    };

    return iconMap[iconName] || faFile;
  }

  onMount(() => {
    breadcrumbController = new BreadcrumbController();

    // Subscribe to breadcrumb changes
    const unsubscribeBreadcrumbs = breadcrumbController.subscribeToBreadcrumbs((b) => {
      breadcrumbs = b;
    });

    const unsubscribeItems = breadcrumbController.subscribeToCurrentItems((items) => {
      if (items.length > 0) {
        currentItems = items;
      } else {
        currentItems = $state.snapshot(items);
      }
    });

    // Don't add keyboard event listener here - it will be handled by TipTap
    // document.addEventListener('keydown', handleKeyDown);

    return () => {
      unsubscribeBreadcrumbs();
      unsubscribeItems();
      breadcrumbController.destroy();
      // document.removeEventListener('keydown', handleKeyDown);
    };
  });

  function handleKeyDown(event: KeyboardEvent): boolean {
    // Let breadcrumb controller handle navigation first
    if (breadcrumbController?.handleKeyboard(event)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        upHandler();
        return true;

      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        downHandler();
        return true;

      case 'ArrowRight':
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        enterHandler();
        return true;

      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (breadcrumbs.length > 0) {
          breadcrumbController.navigateToRoot();
        } else {
          onClose?.();
        }
        return true;

      default:
        // Let other keys (typing) pass through to the editor for filtering
        return false;
    }
  }

  // Keep the old onKeyDown for TipTap compatibility
  function onKeyDown({ event }: { event: KeyboardEvent }): boolean {
    return handleKeyDown(event);
  }

  function upHandler() {
    const len = visualOrderItems.length;
    selectedIndex = (selectedIndex + len - 1) % len;
    scrollToSelected();
  }

  function downHandler() {
    const len = visualOrderItems.length;
    selectedIndex = (selectedIndex + 1) % len;
    scrollToSelected();
  }

  function enterHandler() {
    selectItem(selectedIndex);
  }

  function scrollToSelected() {
    if (!listElement) return;
    const selectedEl = listElement.querySelector('.mention-item.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function selectItem(index: number) {
    const item = visualOrderItems[index];
    if (!item) return;

    if (isMentionGroup(item)) {
      // Navigate into group
      breadcrumbController.push(item);
      selectedIndex = 0;
    } else {
      // Select the mention
      command(item);
    }
  }

  function navigateToBreadcrumb(index: number) {
    breadcrumbController.navigateToBreadcrumb(index);
    selectedIndex = 0;
  }

  // Reset selected index when items change
  $effect(() => {
    // Defensive check: ensure items is an array
    const itemList = Array.isArray(items) ? items : [];
    if (itemList.length > 0) {
      currentItems = breadcrumbs.length > 0 ? currentItems : itemList;
      selectedIndex = 0;
      // When items change (popup opens/updates), ignore mouse events until
      // the user actually moves the mouse. This prevents onmouseenter from
      // changing selectedIndex when the popup appears under the cursor.
      ignoreMouseUntilMove = true;
    }
  });

  // Expose onKeyDown for parent
  export { onKeyDown };

  // Group items by their group property
  function groupItems(
    items: (MentionCandidate | MentionGroup)[],
  ): Map<string, (MentionCandidate | MentionGroup)[]> {
    const grouped = new Map<string, (MentionCandidate | MentionGroup)[]>();

    // Defensive check: ensure items is an array
    const itemList = Array.isArray(items) ? items : [];
    for (const item of itemList) {
      if (!isMentionGroup(item) && item.group) {
        const group = grouped.get(item.group) || [];
        group.push(item);
        grouped.set(item.group, group);
      } else if (!isMentionGroup(item)) {
        const group = grouped.get('Other') || [];
        group.push(item);
        grouped.set('Other', group);
      } else {
        // It's a group itself
        const group = grouped.get('Groups') || [];
        group.push(item);
        grouped.set('Groups', group);
      }
    }

    return grouped;
  }

  const groupedItems = $derived(groupItems(currentItems));

  // Flat array in visual (grouped) order — used for arrow key navigation
  // so that selectedIndex follows the display order, not the original array order.
  const visualOrderItems = $derived(Array.from(groupedItems.values()).flat());
</script>

<div class="enhanced-mention-list" bind:this={listElement}>
  <!-- Main container with list -->
  <div class="mention-container">
    <!-- List -->
    <div class="mention-list-section">
      {#if breadcrumbs.length > 0}
        <div class="breadcrumbs">
          <button class="breadcrumb-item" onclick={() => breadcrumbController.navigateToRoot()}>
            {m.chat_mentionList_all_label()}
          </button>
          {#each breadcrumbs as crumb, i (crumb.id || `crumb-${i}`)}
            <span class="breadcrumb-separator">›</span>
            <button class="breadcrumb-item" onclick={() => navigateToBreadcrumb(i)}>
              {#if crumb.icon}
                <span class="breadcrumb-icon">{crumb.icon}</span>
              {/if}
              {crumb.label}
            </button>
          {/each}
        </div>
      {/if}

      {#if loading && currentItems.length === 0}
        <div class="mention-loading">
          {#each [0, 1, 2, 3] as i (i)}
            <div class="mention-skeleton">
              <div class="skeleton-icon"></div>
              <div class="skeleton-text" style="width: {55 + i * 12}%"></div>
            </div>
          {/each}
        </div>
      {:else if currentItems.length > 0}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="mention-items" onmousemove={() => (ignoreMouseUntilMove = false)}>
          {#each Array.from(groupedItems.entries()) as [groupName, groupItems] (groupName)}
            {#each groupItems as item (item.id)}
              {@const visualIndex = visualOrderItems.indexOf(item)}
              {@const icon = getIcon(item)}
              {@const isSelected = visualIndex === selectedIndex}
              {@const isAgent = !isMentionGroup(item) && item.type === 'agent'}
              <button
                class="mention-item"
                class:selected={isSelected}
                onclick={() => selectItem(visualIndex)}
                onmouseenter={() => {
                  if (!ignoreMouseUntilMove) selectedIndex = visualIndex;
                }}
              >
                {#if isAgent}
                  <span class="mention-agent-avatar">
                    <AugieAvatarWithState
                      agentId={item.id}
                      size={16}
                      state={getAvatarStateFromStore(item.meta?.workspaceId || '', item.id)}
                    />
                  </span>
                {:else}
                  <span class="mention-icon" class:selected={isSelected}>
                    <Fa {icon} />
                  </span>
                {/if}

                <div class="mention-content">
                  <div class="mention-label-line">
                    <span class="mention-label">{item.label}</span>
                    {#if !isMentionGroup(item) && item.subtitle}
                      <span class="mention-subtitle">{item.subtitle}</span>
                    {/if}
                  </div>
                </div>

                {#if isMentionGroup(item)}
                  <span class="group-arrow"><Fa icon={faChevronRight} size="xs" /></span>
                {/if}
              </button>
            {/each}
          {/each}
        </div>
      {:else}
        <div class="mention-empty">{m.chat_mentionList_noResults_label()}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .enhanced-mention-list {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: hsl(var(--popover));
    border: 1px solid hsl(var(--border));
    border-radius: 0;
    overflow: hidden;
    font-family: var(--font-family);
    animation: mention-appear 0.08s ease-out;
  }

  @keyframes mention-appear {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .mention-container {
    display: flex;
    max-height: 300px;
    overflow: hidden;
  }

  .mention-list-section {
    display: flex;
    flex-direction: column;
    width: 100%;
    overflow: hidden;
    flex: 1;
  }

  /* Breadcrumbs */
  .breadcrumbs {
    display: flex;
    align-items: center;
    padding: 3px 8px;
    background: hsl(var(--muted) / 0.3);
    border-bottom: 1px solid hsl(var(--border));
    font-size: 11px;
    gap: 3px;
  }

  .breadcrumb-item {
    background: none;
    border: none;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 0;
    transition:
      all 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.1s ease;
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
  }

  .breadcrumb-item:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--accent) / 0.8);
  }

  .breadcrumb-separator {
    color: hsl(var(--muted-foreground) / 0.4);
    font-size: 11px;
  }

  .breadcrumb-icon {
    font-size: 11px;
  }

  /* Items list */
  .mention-items {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted)) transparent;
  }

  .mention-items::-webkit-scrollbar {
    width: 6px;
  }

  .mention-items::-webkit-scrollbar-track {
    background: transparent;
  }

  .mention-items::-webkit-scrollbar-thumb {
    background: hsl(var(--muted));
    border-radius: 0;
    transition: background 0.2s ease;
  }

  .mention-items::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.5);
  }

  .mention-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: transparent;
    border: none;
    border-radius: 0;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition:
      background-color 0.15s ease,
      transform 0.1s ease,
      box-shadow 0.15s ease;
    color: hsl(var(--foreground));
    position: relative;
  }

  .mention-item:hover {
    background: hsl(var(--muted) / 0.6);
  }

  .mention-item.selected {
    background: hsl(var(--primary) / 0.12);
    box-shadow: none;
  }

  .mention-item.selected:hover {
    background: hsl(var(--primary) / 0.15);
  }

  .mention-item:focus-visible {
    outline: 2px solid hsl(var(--primary));
    outline-offset: 2px;
  }

  .mention-icon {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border-radius: 0;
    color: hsl(var(--foreground));
    opacity: 0.2;
    transition:
      all 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.15s ease;
  }

  .mention-item:hover .mention-icon {
    background: transparent;
  }

  .mention-icon.selected {
    background: transparent;
    color: hsl(var(--foreground));
    opacity: 0.3;
  }

  .mention-agent-avatar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mention-content {
    flex: 1;
    min-width: 0;
  }

  .mention-label-line {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    min-width: 0;
  }

  .mention-label {
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--foreground));
    flex-shrink: 0;
    white-space: nowrap;
  }

  .mention-subtitle {
    font-size: 11px;
    color: hsl(var(--muted-foreground) / 0.6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .group-arrow {
    flex-shrink: 0;
    color: hsl(var(--muted-foreground) / 0.5);
    transition:
      transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      color 0.15s ease;
  }

  .mention-item:hover .group-arrow {
    color: hsl(var(--muted-foreground));
  }

  .mention-item.selected .group-arrow {
    color: hsl(var(--primary));
  }

  /* Empty state */
  .mention-empty {
    padding: 3px 8px;
    font-size: 12px;
    color: var(--sd-color-text-secondary, rgba(255, 255, 255, 0.4));
    text-align: left;
  }

  /* Loading skeleton */
  .mention-loading {
    padding: 4px;
  }

  .mention-skeleton {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    height: 28px;
  }

  .skeleton-icon {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: hsl(var(--muted-foreground) / 0.1);
    animation: skeleton-pulse 1s ease-in-out infinite;
    flex-shrink: 0;
  }

  .skeleton-text {
    height: 10px;
    border-radius: 3px;
    background: hsl(var(--muted-foreground) / 0.1);
    animation: skeleton-pulse 1s ease-in-out infinite;
  }

  .mention-skeleton:nth-child(2) .skeleton-icon,
  .mention-skeleton:nth-child(2) .skeleton-text {
    animation-delay: 0.1s;
  }

  .mention-skeleton:nth-child(3) .skeleton-icon,
  .mention-skeleton:nth-child(3) .skeleton-text {
    animation-delay: 0.2s;
  }

  .mention-skeleton:nth-child(4) .skeleton-icon,
  .mention-skeleton:nth-child(4) .skeleton-text {
    animation-delay: 0.3s;
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
</style>
