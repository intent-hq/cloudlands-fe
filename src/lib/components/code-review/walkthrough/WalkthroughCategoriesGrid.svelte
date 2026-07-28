<script lang="ts">
  /**
   * WalkthroughCategoriesGrid
   *
   * Displays an overview grid of change categories at the top of the walkthrough.
   * Each card shows a category title, description, and file count.
   * Clicking a card scrolls to that category section.
   */
  import type { WalkthroughCategory } from './types';
  import * as m from '$shared/paraglide/messages.js';

  interface Props {
    /** Categories to display */
    categories: WalkthroughCategory[];
    /** Callback when a category is clicked */
    onCategoryClick?: (categoryIndex: number) => void;
    class?: string;
  }

  let {
    categories,
    onCategoryClick,
    class: className = '',
  }: Props = $props();

  // Get a color class for a category based on its index
  function getCategoryColor(index: number): string {
    const colors = [
      'bg-blue-500/10 border-blue-500/30 hover:border-blue-500/50',
      'bg-purple-500/10 border-purple-500/30 hover:border-purple-500/50',
      'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50',
      'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/50',
      'bg-rose-500/10 border-rose-500/30 hover:border-rose-500/50',
      'bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-500/50',
    ];
    return colors[index % colors.length];
  }

  // Get icon color for a category
  function getIconColor(index: number): string {
    const colors = [
      'text-blue-500',
      'text-purple-500',
      'text-emerald-500',
      'text-amber-500',
      'text-rose-500',
      'text-cyan-500',
    ];
    return colors[index % colors.length];
  }
</script>

<div class="walkthrough-categories-grid {className}">
  <div class="mb-4">
    <h3 class="text-sm font-medium text-subtle">{m.codeReview_categoriesGrid_whatChanged_title()}</h3>
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {#each categories as category, index (index)}
      <button
        type="button"
        class="text-left p-4 rounded-lg border transition-all duration-200 {getCategoryColor(index)}"
        onclick={() => onCategoryClick?.(index)}
      >
        <!-- Category icon -->
        <div class="flex items-start gap-3">
          <div class="shrink-0 mt-0.5">
            <svg class="h-5 w-5 {getIconColor(index)}" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z" clip-rule="evenodd" />
              <path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H2h2a2 2 0 002-2v-2z" />
            </svg>
          </div>

          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-medium text-foreground line-clamp-2">{category.title}</h4>
            <p class="text-xs text-subtle mt-1 line-clamp-2">{category.description}</p>

            <!-- File count -->
            <div class="flex items-center gap-1 mt-2 text-xs text-subtle">
              <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.5 1.5A1.5 1.5 0 0 1 5 0h6a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 11 15H5a1.5 1.5 0 0 1-1.5-1.5v-12z"/>
              </svg>
              <span>{category.files.length === 1
                  ? m.codeReview_categoriesGrid_fileCount_one({ count: category.files.length })
                  : m.codeReview_categoriesGrid_fileCount_many({ count: category.files.length })}</span>
            </div>
          </div>
        </div>
      </button>
    {/each}
  </div>
</div>
