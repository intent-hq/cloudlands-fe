<script lang="ts">
  import { fade } from 'svelte/transition';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
</script>

<div class="w-full h-full animate-pulse" in:fade={{ duration: 200 }}>
  <!-- Section headers -->
  <div class="h-[var(--panel-header-height)] flex-none px-4 flex items-center">
    <Skeleton class="h-6 w-2/3" />
  </div>

  <!-- Files section -->
  <div class="space-y-3 p-4">
    <Skeleton class="h-6 w-1/2" />
    <div class="ml-2 space-y-1">
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-5/6" />
      <Skeleton class="h-4 w-4/6" />
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-3/4" />
    </div>
  </div>

  <!-- Another section -->
  <div class="space-y-3 p-4">
    <Skeleton class="h-6 w-3/4" />
    <div class="ml-2 space-y-1">
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-2/3" />
    </div>
  </div>
</div>
