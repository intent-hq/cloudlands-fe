<script lang="ts">
  import { SHORTCUT_CATEGORIES, formatShortcut } from '$lib/utils/shortcuts';

  const categories = Object.entries(SHORTCUT_CATEGORIES).filter(
    ([, category]) => category.shortcuts.length > 0,
  );
</script>

<div class="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
  {#each categories as [categoryId, category] (categoryId)}
    <section
      aria-labelledby={`keyboard-shortcuts-${categoryId}`}
      data-shortcut-category={categoryId}
    >
      <h3
        id={`keyboard-shortcuts-${categoryId}`}
        class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
      >
        {category.title}
      </h3>
      <dl class="mt-3 space-y-2">
        {#each category.shortcuts as shortcut, index (`${shortcut.key}-${index}`)}
          <div class="flex items-center justify-between gap-4" data-shortcut-entry>
            <dt class="min-w-0 text-sm text-foreground">{shortcut.label}</dt>
            <dd class="shrink-0">
              <kbd class="whitespace-nowrap text-xs text-subtle">
                {formatShortcut(shortcut.key)}
              </kbd>
            </dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}
</div>
