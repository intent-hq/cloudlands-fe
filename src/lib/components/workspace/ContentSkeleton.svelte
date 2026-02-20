<script lang="ts">
  import { fade } from 'svelte/transition';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
</script>

<div class="w-full h-full animate-pulse" in:fade={{ duration: 200 }}>
  <div class="w-full h-full flex flex-col">
    <!-- Header -->
    <div class="h-[var(--panel-header-height)] w-full border-b border-border flex-none"></div>

    <div class="space-y-4 p-8 flex-1">
      <div class="space-y-2">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-5/6" />
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-4/6" />
      </div>

      <div class="space-y-2">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-3/4" />
        <Skeleton class="h-4 w-5/6" />
      </div>
    </div>
  </div>
</div>
