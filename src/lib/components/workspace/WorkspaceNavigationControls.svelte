<script lang="ts">
  import { createLogger } from '$lib/utils/client-logger';
  import NavigationButtons from '$lib/components/ui/NavigationButtons.svelte';
  import type { NavigationHistoryItem } from '$features/workspace/workspace-unified-state.svelte';

  const logger = createLogger('WorkspaceNavigationControls');

  interface Props {
    canGoBack: boolean;
    canGoForward: boolean;
    navigationHistory: NavigationHistoryItem[];
    navigationIndex: number;
    onNavigateBack: () => void;
    onNavigateForward: () => void;
    onNavigateToItem: (item: NavigationHistoryItem) => void;
    onNavigationIndexChange: (index: number) => void;
  }

  let {
    canGoBack,
    canGoForward,
    navigationHistory,
    navigationIndex,
    onNavigateBack,
    onNavigateForward,
    onNavigateToItem,
    onNavigationIndexChange,
  }: Props = $props();

  function handleNavigateBack() {
    if (canGoBack) {
      onNavigateBack();
    }
  }

  function handleNavigateForward() {
    if (canGoForward) {
      onNavigateForward();
    }
  }

  function handleNavigateToItem(item: NavigationHistoryItem) {
    onNavigateToItem(item);
  }

  function handleNavigationIndexChange(index: number) {
    onNavigationIndexChange(index);
  }
</script>

<NavigationButtons
  {canGoBack}
  {canGoForward}
  onNavigateBack={handleNavigateBack}
  onNavigateForward={handleNavigateForward}
/>
