<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { NativeScene } from './native-review-attempt.preview-fixtures';
  interface Props {
    scene?: NativeScene;
    member?: boolean;
    baseRef?: string;
  }
  export const preview = definePreview<Props>({
    id: 'sidebar-native-review',
    title: 'Commit and create a merge request',
    defaultState: 'created',
    states: {
      created: { props: { scene: 'created' } },
      failed: { props: { scene: 'failed' } },
      uncertain: { props: { scene: 'uncertain' } },
      member: { props: { member: true, scene: 'reused' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import SidebarChangesPanel from '$lib/components/workspace/sidebar/SidebarChangesPanel.svelte';
  import {
    installSidebarNativeFixture,
    sidebarWorkspaceId,
  } from './sidebar-native-review.preview-fixtures';
  let { scene = 'created', member = false, baseRef }: Props = $props();
  let fixture: ReturnType<typeof installSidebarNativeFixture>;
  let ready = $state(false);
  let transcript = $state('[]');
  onMount(() => {
    fixture = installSidebarNativeFixture({
      scene,
      role: member ? 'member' : 'owner',
      baseRef,
      onBoundary: (value) => {
        transcript = value;
      },
    });
    ready = true;
    return () => {
      void fixture.dispose();
    };
  });
</script>

<div class="w-full min-w-0 bg-background text-foreground" data-sidebar-native-ready={ready}>
  <div class="flex flex-wrap gap-1 p-2" aria-label="Preview controls">
    <Button variant="ghost" size="compact" onclick={() => fixture.grant('guest-owner')}
      >Guest access</Button
    >
    <Button variant="ghost" size="compact" onclick={() => fixture.base.admit('host-B')}
      >Replace host</Button
    >
  </div>
  {#if ready}<SidebarChangesPanel workspaceId={sidebarWorkspaceId} />{/if}
  <ConfirmHost />
  <output hidden data-boundary-transcript>{transcript}</output>
</div>
