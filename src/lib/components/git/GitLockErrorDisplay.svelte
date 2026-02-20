<script lang="ts">
  import { Button } from '../ui/button';

  let {
    workspaceId,
    onRemoveLock,
  }: {
    workspaceId: string;
    onRemoveLock: () => Promise<void>;
  } = $props();
</script>

<div class="p-8 text-center">
  <div class="text-red-500 text-[0.8125rem] mb-4">
    Git is locked by another process. This usually happens when a previous git operation didn't
    complete. You can fix this by removing the lock file or waiting for the other process to finish.
  </div>
  <Button size="sm" variant="outline" onclick={onRemoveLock}>Remove Lock File</Button>
</div>
