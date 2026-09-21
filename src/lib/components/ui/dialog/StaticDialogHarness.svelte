<script lang="ts">
  import * as Dialog from './index';
  import { Button } from '$lib/components/ui/button';
</script>

<div data-testid="static-dialog-frame">
  <Button>Outside action</Button>
  <Dialog.Root open staticPosition>
    <Dialog.Content>
      <Dialog.Title>Static dialog</Dialog.Title>
      <Dialog.Description>Inline dialog fixture</Dialog.Description>
      <Button>Inside action</Button>
    </Dialog.Content>
  </Dialog.Root>
</div>
