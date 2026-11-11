<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Fixture = 'available' | 'large-repo-rules' | 'unavailable';

  interface PromptBreakdownPreviewProps {
    fixture: Fixture;
    open: boolean;
  }

  export const preview = definePreview<PromptBreakdownPreviewProps>({
    id: 'prompt-breakdown-indicator',
    title: 'Starting context ring in an agent header',
    defaultState: 'available',
    states: {
      available: { props: { fixture: 'available', open: true } },
      'available-closed': { props: { fixture: 'available', open: false } },
      'large-repo-rules': { props: { fixture: 'large-repo-rules', open: true } },
      unavailable: { props: { fixture: 'unavailable', open: false } },
    },
  });
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faRobot, faXmark } from '@fortawesome/free-solid-svg-icons';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import PromptBreakdownIndicator from './PromptBreakdownIndicator.svelte';
  import { parsePromptBreakdown } from './prompt-breakdown';

  let { fixture, open }: PromptBreakdownPreviewProps = $props();

  type Row = [
    id: string,
    label: string,
    owner: string,
    location: string,
    chars: number,
    hint?: string,
  ];

  function wire(rows: Row[], hiddenSkills: unknown[] = []) {
    const sections = rows.map(([id, label, owner, location, chars, hint]) => ({
      id,
      label,
      owner,
      location,
      chars,
      estTokens: Math.ceil(chars / 4),
      ...(hint ? { controlHint: { kind: 'edit-repo-rules', text: hint } } : {}),
    }));
    const sum = (where: string) =>
      sections.filter((s) => s.location === where).reduce((n, s) => n + s.chars, 0);
    const systemPromptChars = sum('systemPrompt');
    const toolDescriptionChars = sum('toolDescription');
    const totalChars = systemPromptChars + toolDescriptionChars;
    return {
      available: true,
      harnessVersion: '3.12',
      recordedAt: '2026-11-10T12:00:00Z',
      systemPromptChars,
      toolDescriptionChars,
      totalChars,
      estTokens: Math.ceil(totalChars / 4),
      sections,
      hiddenSkills,
    };
  }

  const shared: Row[] = [
    ['ws-reference', 'Workspace API reference', 'intent', 'toolDescription', 21_400],
    ['doctrine', 'Intent instructions', 'intent', 'systemPrompt', 14_800],
    ['specialist-prompt', 'Specialist prompt', 'user', 'systemPrompt', 4_300, 'Change specialist'],
    ['skills', 'Skills', 'user', 'systemPrompt', 3_100],
    ['repo-config', 'Repo config instructions', 'user', 'systemPrompt', 1_900],
    ['suggested-next-steps', 'Suggested next steps', 'intent', 'systemPrompt', 1_200],
    ['remote-machines', 'Remote machines', 'intent', 'systemPrompt', 900],
    ['ask-questions', 'Asking the user questions', 'intent', 'systemPrompt', 650],
    ['commit-policy', 'Commit policy', 'intent', 'systemPrompt', 420],
    ['role-reminder', 'Role reminder', 'intent', 'systemPrompt', 240],
  ];

  const fixtures: Record<Fixture, unknown> = {
    available: wire(
      [
        ...shared,
        [
          'repo-rules',
          'Repo rules: loaded natively by Claude Code',
          'user',
          'provider',
          18_500,
          'Edit AGENTS.md',
        ],
      ],
      [
        {
          name: 'memory',
          reason: 'mcp-server-missing',
          detail: 'Needs mcp__memory__',
          fix: "Add the memory MCP server in Intent's MCP settings",
        },
        {
          name: 'xcode-build',
          reason: 'compatibility',
          detail: 'Needs macOS',
          fix: 'Run the agent on a Mac',
        },
      ],
    ),
    'large-repo-rules': wire([
      ['repo-rules', 'Repo rules', 'user', 'systemPrompt', 96_000, 'Edit AGENTS.md'],
      ...shared,
    ]),
    unavailable: { available: false, reason: 'harness-predates-breakdown' },
  };

  const breakdown = $derived(parsePromptBreakdown(fixtures[fixture]));
</script>

<section
  class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
  style:width="560px"
  data-prompt-breakdown-preview={fixture}
>
  <div
    class="flex h-(--panel-header-height) min-w-0 items-center bg-card pr-2.5"
    data-panel-content-header
  >
    <div class="flex min-w-0 shrink items-center gap-2 overflow-hidden bg-card pl-1">
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Fa icon={faRobot} size={12} />
      </span>
      <span class="block max-w-60 truncate text-sm font-medium text-foreground">
        Component catalog agent
      </span>
    </div>
    <div class="min-w-0 flex-1" aria-hidden="true"></div>
    <div class="flex shrink-0 items-center gap-0.5" data-panel-header-actions>
      {#if breakdown}
        <PromptBreakdownIndicator {breakdown} {open} />
      {/if}
      <Button variant="ghost-light" size="icon-sm" aria-label={m.ui_breadcrumb_more_label()}>
        <KebabIcon class="pointer-events-none size-4!" />
      </Button>
      <Button
        variant="ghost-light"
        size="icon-sm"
        aria-label={m.layout_panelTabBar_closePane_ariaLabel()}
      >
        <Fa icon={faXmark} size={14} class="size-3.5!" />
      </Button>
    </div>
  </div>
  <div class="h-[40rem] border-t border-border bg-background/70"></div>
</section>
