<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  const E = '\x1b';

  const OUTPUTS = {
    cargo: {
      command: 'cargo build -p intent-acp',
      output: [
        `${E}[1m${E}[92m   Compiling${E}[0m gimli v0.32.3`,
        `${E}[1m${E}[92m   Compiling${E}[0m intent-acp v0.9.112 (/repo/crates/intent-acp)`,
        `${E}[1m${E}[33mwarning${E}[0m${E}[1m: unused variable: \`conn\`${E}[0m`,
        `${E}[0m  ${E}[1m${E}[94m-->${E}[0m crates/intent-acp/src/handler.rs:168:13`,
        `${E}[1m${E}[92m    Finished${E}[0m \`dev\` profile [unoptimized + debuginfo] target(s) in 41.2s`,
      ].join('\r\n'),
    },
    nextest: {
      command: 'cargo nextest run -p intent-sourcecontrol',
      output: [
        `${E}[32;1m        PASS${E}[0m [   0.067s] ${E}[35;1mintent-sourcecontrol::github_graphql_envelope${E}[0m ${E}[34;1mget_review_threads${E}[0m`,
        `${E}[31;1m        FAIL${E}[0m [   0.112s] ${E}[35;1mintent-sourcecontrol::gitlab_http${E}[0m ${E}[34;1mrefresh_token_expired${E}[0m`,
        `${E}[32;1m     Summary${E}[0m [   9.292s] ${E}[1m178${E}[0m tests run: ${E}[1m177${E}[0m ${E}[32;1mpassed${E}[0m, ${E}[1m1${E}[0m ${E}[31;1mfailed${E}[0m, ${E}[1m12${E}[0m ${E}[33;1mskipped${E}[0m`,
      ].join('\n'),
    },
    progress: {
      command: 'pnpm install',
      output: `Packages: +412\r\nProgress: resolved 10, reused 0\rProgress: resolved 212, reused 180\rProgress: resolved 412, reused 398, ${E}[32mdone${E}[39m\r\n${E}[?25l${E}[2K${E}[1G${E}]8;;https://pnpm.io${E}\\Done${E}]8;;${E}\\ in 3.4s${E}[?25h`,
    },
    extended: {
      command: 'scripts/palette.sh',
      output: `${E}[38;5;208morange 208${E}[0m  ${E}[38;2;125;207;255mtruecolor${E}[0m  ${E}[48;5;24;97m on blue ${E}[0m  ${E}[2mdim${E}[22m  ${E}[3mitalic${E}[23m  ${E}[4munderline${E}[24m  ${E}[7minverse${E}[27m  ${E}[90mbright black${E}[0m`,
    },
    plain: {
      command: 'git status --short',
      output: ' M src/lib/utils/ansi.ts\n?? src/lib/components/chat/AnsiText.svelte',
    },
  };

  type Sample = keyof typeof OUTPUTS;

  export const preview = definePreview({
    id: 'ansi-shell-output',
    title: 'Shell output colors',
    defaultState: 'all',
    captureReadiness: { selector: '[data-tool-icon]' },
    states: {
      all: { props: { samples: ['cargo', 'nextest', 'progress', 'extended', 'plain'] } },
      cargo: { props: { samples: ['cargo'] } },
      nextest: { props: { samples: ['nextest'] } },
      progress: { props: { samples: ['progress'] } },
      extended: { props: { samples: ['extended'] } },
      plain: { props: { samples: ['plain'] } },
    },
  });
</script>

<script lang="ts">
  import type { ToolUseBlock } from '$shared/types';
  import ToolCall from './ToolCall.svelte';

  let { samples = ['cargo'] }: { samples?: Sample[] } = $props();

  const blocks = $derived(
    samples.map((sample): { toolUse: ToolUseBlock; result: string } => ({
      toolUse: {
        type: 'tool_use',
        id: `ansi:${sample}`,
        toolCallId: `call-ansi-${sample}`,
        name: 'bash',
        input: { command: OUTPUTS[sample].command },
        metadata: { toolKind: 'terminal', status: 'completed' },
      },
      result: OUTPUTS[sample].output,
    })),
  );
</script>

<div class="flex w-full flex-col gap-2 bg-background p-6 text-foreground">
  {#each blocks as block (block.toolUse.id)}
    <ToolCall
      toolUse={block.toolUse}
      result={block.result}
      toolState="completed"
      saved={{ expanded: true }}
    />
  {/each}
</div>
