<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn } from '$lib/utils';

  let { class: className = '' }: { class?: string } = $props();
</script>

<div class="flex-1 flex flex-col h-[calc(100%-1.25rem)]">
  <!-- Agents Section Skeleton -->
  <div class="w-full flex flex-col max-h-[50%] min-h-0">
    <div class="flex flex-col items-center gap-1 w-full pt-2">
      <!-- Agent skeleton loaders -->
      {#each Array(2) as _, i}
        <div class="relative w-full -my-0.5 animate-pulse" style="animation-delay: {i * 100}ms">
          <div class="w-full h-9 flex items-center justify-center">
            <Skeleton class="w-[26px] h-[26px] rounded-full" />
          </div>
        </div>
      {/each}
    </div>

    <!-- Create agent button skeleton -->
    <div class="flex items-center justify-center mt-2 animate-pulse" style="animation-delay: 200ms">
      <Skeleton class="w-7 h-7 rounded" />
    </div>
  </div>

  <!-- Terminals Section Skeleton -->
  <div class="w-full flex flex-col max-h-[50%] min-h-0 pt-6">
    <div class="flex flex-col items-center gap-1 w-full px-1 py-2">
      <!-- Terminal skeleton loader -->
      <div class="relative w-full animate-pulse" style="animation-delay: 300ms">
        <div class="w-full h-9 flex items-center justify-center">
          <Skeleton class="w-4 h-4" />
        </div>
      </div>
    </div>

    <!-- Create terminal button skeleton -->
    <div class="flex items-center justify-center mt-2 animate-pulse" style="animation-delay: 400ms">
      <Skeleton class="w-7 h-7 rounded" />
    </div>
  </div>
</div>
