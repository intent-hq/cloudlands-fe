<script lang="ts">
  import { fade } from 'svelte/transition';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
</script>

<div class="w-full h-full flex flex-col" in:fade={{ duration: 200 }}>
  <!-- Header -->
  <div class="border-b border-border flex items-center h-[var(--panel-header-height)]">
    <div class="flex items-center gap-3">
      <Skeleton class="h-10 w-10 rounded-full" />
      <div class="flex-1">
        <Skeleton class="h-5 w-32" />
        <Skeleton class="h-3 w-48 mt-1" />
      </div>
    </div>
  </div>

  <!-- Messages area -->
  <div class="flex-1 p-4 space-y-4 overflow-y-auto">
    <!-- Message skeletons -->
    <div class="space-y-4">
      <div class="flex gap-3">
        <Skeleton class="h-8 w-8 rounded-full shrink-0" />
        <div class="flex-1 space-y-2">
          <Skeleton class="h-4 w-3/4" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-5/6" />
        </div>
      </div>

      <div class="flex gap-3">
        <Skeleton class="h-8 w-8 rounded-full shrink-0" />
        <div class="flex-1 space-y-2">
          <Skeleton class="h-4 w-2/3" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-4/5" />
        </div>
      </div>

      <div class="flex gap-3">
        <Skeleton class="h-8 w-8 rounded-full shrink-0" />
        <div class="flex-1 space-y-2">
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-3/4" />
        </div>
      </div>
    </div>
  </div>

  <!-- Input area -->
  <div class="border-t border-border p-4">
    <Skeleton class="h-20 w-full rounded-md" />
    <div class="flex justify-between mt-2">
      <Skeleton class="h-8 w-20 rounded" />
      <Skeleton class="h-8 w-24 rounded" />
    </div>
  </div>
</div>
