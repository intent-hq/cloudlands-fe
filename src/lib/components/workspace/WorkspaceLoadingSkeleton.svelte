<script lang="ts">
  import { fade } from 'svelte/transition';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
</script>

<div class="flex h-full" in:fade={{ duration: 300 }}>
  <!-- Sidebar Skeleton -->
  <div class="w-64 border-r border-border bg-background p-4 space-y-4">
    <!-- Workspace title -->
    <Skeleton class="h-8 w-3/4" />

    <!-- Navigation items -->
    <div class="space-y-2">
      <Skeleton class="h-6 w-full" />
      <Skeleton class="h-6 w-full" />
      <Skeleton class="h-6 w-5/6" />
      <Skeleton class="h-6 w-4/6" />
    </div>

    <!-- Files section -->
    <div class="space-y-2 pt-4">
      <Skeleton class="h-5 w-1/2" />
      <div class="ml-4 space-y-1">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-5/6" />
        <Skeleton class="h-4 w-4/6" />
        <Skeleton class="h-4 w-full" />
      </div>
    </div>
  </div>

  <!-- Main Content Area -->
  <div class="flex-1 flex">
    <!-- Center Panel -->
    <div class="flex-1 p-8">
      <div class="max-w-3xl mx-auto space-y-6">
        <!-- Header -->
        <div class="space-y-2">
          <Skeleton class="h-8 w-1/3" />
          <Skeleton class="h-4 w-2/3" />
        </div>

        <!-- Content lines -->
        <div class="space-y-3">
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-5/6" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-4/6" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-3/4" />
        </div>

        <!-- Code block skeleton -->
        <div class="bg-muted/30 rounded-md p-4 space-y-2">
          <Skeleton class="h-3 w-1/4" />
          <Skeleton class="h-3 w-full" />
          <Skeleton class="h-3 w-5/6" />
          <Skeleton class="h-3 w-3/4" />
          <Skeleton class="h-3 w-full" />
        </div>

        <!-- More content -->
        <div class="space-y-3">
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-2/3" />
          <Skeleton class="h-4 w-5/6" />
        </div>
      </div>
    </div>

    <!-- Right Panel (Chat) -->
    <div class="w-96 border-l border-border bg-background">
      <!-- Chat Header -->
      <div class="border-b border-border p-4">
        <div class="flex items-center gap-3">
          <Skeleton class="h-10 w-10 rounded-full" />
          <div class="flex-1">
            <Skeleton class="h-5 w-24" />
            <Skeleton class="h-3 w-32 mt-1" />
          </div>
        </div>
      </div>

      <!-- Chat Messages -->
      <div class="p-4 space-y-4">
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
            </div>
          </div>

          <div class="flex gap-3">
            <Skeleton class="h-8 w-8 rounded-full shrink-0" />
            <div class="flex-1 space-y-2">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-4/5" />
              <Skeleton class="h-4 w-3/4" />
            </div>
          </div>
        </div>
      </div>

      <!-- Chat Input -->
      <div class="border-t p-4">
        <Skeleton class="h-20 w-full rounded-md" />
        <div class="flex justify-between mt-2">
          <Skeleton class="h-8 w-20" />
          <Skeleton class="h-8 w-24" />
        </div>
      </div>
    </div>
  </div>

  <!-- Bottom Dock -->
  <div class="absolute bottom-0 left-64 right-0 h-12 border-t bg-background/95 backdrop-blur">
    <div class="flex items-center h-full px-4 gap-4">
      <Skeleton class="h-6 w-6 rounded" />
      <Skeleton class="h-6 w-6 rounded" />
      <Skeleton class="h-6 w-6 rounded" />
      <div class="ml-auto flex items-center gap-2">
        <Skeleton class="h-4 w-32" />
      </div>
    </div>
  </div>
</div>
