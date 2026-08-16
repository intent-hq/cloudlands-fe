<script lang="ts">
  import type { ContentBlock } from '$shared/types';
  import ResponseGroup from '../ResponseGroup.svelte';

  let {
    theme = 'light',
    width = 260,
    zoom = 2,
    chunk = 'initial chunk',
  }: { theme?: 'light' | 'dark'; width?: number; zoom?: number; chunk?: string } = $props();

  const positions = ['first', 'middle', 'last'] as const;
  const blocks = $derived([
    { type: 'text', text: 'earlier chunk' },
    { type: 'text', text: chunk },
  ] as ContentBlock[]);

  $effect(() => {
    const root = document.documentElement;
    const hadDarkClass = root.classList.contains('dark');
    root.classList.toggle('dark', theme === 'dark');
    return () => root.classList.toggle('dark', hadDarkClass);
  });
</script>

<section
  class="bg-background text-foreground"
  style:width={`${width}px`}
  style:zoom
  data-testid="response-group-collapse-host"
>
  <div class="max-h-44 overflow-y-auto" data-testid="response-group-scroll">
    <div class="h-20" aria-hidden="true"></div>
    {#each positions as position}
      <div data-testid="response-group-{position}">
        <ResponseGroup name={`${position} group`} isStreaming isLast={position === 'last'} {blocks}>
          <div class="py-2" data-testid="response-group-body-{position}">
            <button type="button" data-testid="response-group-focus-{position}">
              Focusable {position} detail for {chunk}
            </button>
          </div>
        </ResponseGroup>
      </div>
    {/each}
  </div>
</section>
