<script lang="ts">
  import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import { agentSessionLaunchAgentRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { createReviewSlice } from '../model/review-slice';
  import type { DiffMapDocument } from '../model/types';

  interface Props {
    workspaceId: string;
    document: DiffMapDocument;
    selection: ReadonlySet<string>;
  }

  let { workspaceId, document, selection }: Props = $props();
  let launching = $state(false);

  async function askAgent() {
    if (!workspaceId || selection.size === 0 || launching) return;
    const slice = createReviewSlice(document, selection);
    launching = true;
    try {
      const action = agentSessionLaunchAgentRequested(
        workspaceId,
        {
          name: m.diffMap_reviewSelection_agentName(),
          nameExplicitlySet: false,
          initialMessage: m.diffMap_reviewSelection_initialMessage(),
          agentType: createAgentTypeId('workspace'),
          source: 'diff-map',
          contextReferences: [
            {
              type: 'selection',
              content: JSON.stringify(slice, null, 2),
              metadata: { kind: 'review-slice', reviewSlice: slice },
            },
          ],
        },
        { openAgent: true },
      );
      appStore.dispatch(action);
      await action.promise;
    } finally {
      launching = false;
    }
  }
</script>

<Button
  variant="ghost-light"
  size="xs"
  disabled={selection.size === 0 || launching}
  onclick={askAgent}
  aria-label={m.diffMap_reviewSelection_askAgent_label()}
>
  <Fa icon={faPaperPlane} class="size-3!" />
  {m.diffMap_reviewSelection_askAgent_label()}
</Button>
