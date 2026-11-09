<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Variant = 'finished' | 'matched' | 'legacy';
  export const preview = definePreview<{ variant?: Variant }>({
    id: 'remote-script-wake',
    title: 'Remote script wake',
    defaultState: 'finished',
    states: {
      finished: { props: { variant: 'finished' } },
      matched: { props: { variant: 'matched' } },
      legacy: { props: { variant: 'legacy' } },
    },
  });
</script>

<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import ChatMessage from './ChatMessage.svelte';

  let { variant = 'finished' }: { variant?: Variant } = $props();
  const timestamp = '2026-11-09T05:00:00.000Z';
  const card = {
    type: 'script_monitor_wake',
    source: 'system',
    monitorId: 'remote-monitor',
    workspaceId: 'preview-workspace',
    agentId: 'remote-agent',
    scriptId: 'ios-commit-tests',
    runId: 'remote-run',
    scriptName: 'ios-commit-tests',
    mode: 'command',
    expiresAt: timestamp,
    settledAt: timestamp,
    remoteAgentId: 'remote-agent',
    nodeId: 'mac-studio',
  };
  const message: AgentMessage = $derived(
    variant === 'matched'
      ? {
          id: 'remote-wake-matched',
          role: 'user',
          timestamp,
          contentBlocks: [
            {
              type: 'text',
              text: 'Script "ios-commit-tests" (machine run on Mac Studio): output matched `Test Suite .* passed`: Test Suite \'All tests\' passed',
            },
          ],
          metadata: {
            ...card,
            reason: 'output-match',
            trigger: { observedLineCount: 412, matchedLine: "Test Suite 'All tests' passed" },
          },
        }
      : {
          id: `remote-wake-${variant}`,
          role: 'user',
          timestamp,
          contentBlocks: [
            {
              type: 'text',
              text: 'Script "ios-commit-tests" (machine run on Mac Studio) exited with code 65',
            },
          ],
          ...(variant === 'finished'
            ? {
                metadata: {
                  ...card,
                  reason: 'finished',
                  result: { outcome: 'failed', exitCode: 65 },
                },
              }
            : {}),
        },
  );
</script>

<section
  class="w-full min-w-0 bg-background p-4 text-foreground"
  data-testid="remote-script-wake-preview"
>
  <ChatMessage {message} />
</section>
