<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { NativeScene } from './native-review-attempt.preview-fixtures';
  interface Props {
    scene?: NativeScene;
    member?: boolean;
    baseRef?: string;
  }
  export const preview = definePreview<Props>({
    id: 'native-review-attempt',
    title: 'Create a merge request',
    defaultState: 'reused',
    states: {
      created: { props: { scene: 'created' } },
      reused: { props: { scene: 'reused' } },
      uncertain: { props: { scene: 'uncertain' } },
      failed: { props: { scene: 'failed' } },
      member: { props: { scene: 'reused', member: true } },
      absentBranch: { props: { scene: 'reused' } },
      suppliedBranch: { props: { scene: 'reused', baseRef: 'release/example' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import { Button } from '$lib/components/ui/button';
  import NativeReviewAttempt from './NativeReviewAttempt.svelte';
  import { installNativeFixture, nativeRoot } from './native-review-attempt.preview-fixtures';
  let { scene = 'reused', member = false, baseRef }: Props = $props();
  let fixture: ReturnType<typeof installNativeFixture>;
  onMount(() => {
    fixture = installNativeFixture({ scene, role: member ? 'member' : 'owner', baseRef });
    return () => fixture.dispose();
  });
</script>

<div class="w-full min-w-0 bg-background text-foreground">
  <div class="flex flex-wrap gap-1 p-2" aria-label="Preview controls">
    <Button variant="ghost" size="compact" onclick={() => fixture.base.admit('host-B')}
      >Replace host</Button
    >
    <Button variant="ghost" size="compact" onclick={() => fixture.retire('closed')}
      >Close original session</Button
    >
  </div>
  <NativeReviewAttempt root={nativeRoot} targetBranch={baseRef} />
  <ConfirmHost />
</div>
