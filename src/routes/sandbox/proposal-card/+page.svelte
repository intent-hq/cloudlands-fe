<script lang="ts">
  import { ProposalCard } from '$lib/components/chat/proposals';
  import { store as appStore } from "$store/renderer/store";
  import { hydrateProposalHistory } from '$store/renderer/slices/settings-proposal-history/settings-proposal-history-slice';
  import { getProposalId } from '$lib/components/chat/proposals/proposal-id';
  import type { Proposal, ProposalActionDetail } from '$shared/types/proposal';

  type SandboxAction = 'apply' | 'discard' | 'edit';

  interface ProposalVariant {
    id: string;
    heading: string;
    proposal: Proposal;
  }

  let recentAction = $state<{ action: SandboxAction; variant: string; detail: string } | null>(
    null,
  );

  const friendlySettingsProposal: Proposal = {
    kind: 'settings-change',
    payload: {
      changes: [
        {
          path: 'theme.activePresetId',
          value: 'dracula',
          apply: { kind: 'redux-action', action: 'theme/selectThemePreset' },
        },
      ],
    },
    preview: {
      title: 'Theme preset: Dracula',
      summary: 'Switch the theme preset to Dracula.',
      applyLabel: 'Apply',
      fields: [
        { key: 'theme.activePresetId', label: 'Theme preset', before: null, after: 'dracula' },
      ],
    },
  };

  const appliedSettingsProposal: Proposal = {
    ...friendlySettingsProposal,
    applyToolCallId: 'sandbox-settings-applied',
  };

  $effect(() => {
    appStore.dispatch(
      hydrateProposalHistory({
        [getProposalId(appliedSettingsProposal)]: {
          appliedAt: Date.now() - 2 * 60 * 1000,
          reverseChanges: [
            {
              path: 'theme.activePresetId',
              value: null,
              apply: { kind: 'redux-action', action: 'theme/selectThemePreset' },
            },
          ],
        },
      }),
    );
  });

  const variants: ProposalVariant[] = [
    {
      id: 'workspace-create-empty',
      heading: 'workspace-create — Chief partial fill with separate repo/branch rows',
      proposal: {
        kind: 'workspace-create',
        payload: {
          operation: 'workspace.create',
          params: {},
        },
        preview: {
          title: 'Create workspace: Review PR #647',
          workspaceCreate: {
            initialPrompt: 'Review PR #647 and summarize any blockers.',
            branch: 'pr/647',
            specialist: 'pr-reviewer',
          },
        },
      },
    },
    {
      id: 'workspace-create-full',
      heading: 'workspace-create — fully populated separate repo/branch rows',
      proposal: {
        kind: 'workspace-create',
        payload: {
          operation: 'workspace.create',
          params: {
            repositoryPath: '/Users/amelia/code/design-system',
          },
        },
        applyToolCallId: 'tool-create-workspace',
        preview: {
          title: 'Create workspace for design system polish',
          summary: 'Set up a focused workspace for iterating on Chief proposal cards.',
          workspaceCreate: {
            initialPrompt:
              'Polish the inline proposal card variants and verify Chief chat rendering.',
            repoPath: '/Users/amelia/code/design-system',
            repoType: 'local',
            githubUrl: 'https://github.com/augmentcode/design-system',
            branch: 'main',
            specialist: 'ui-designer',
          },
        },
      },
    },
    {
      id: 'workspace-create-chief-pr-payload',
      heading: 'workspace-create — Chief PR payload with owner/name params',
      proposal: {
        kind: 'workspace-create',
        payload: {
          operation: 'workspace.create',
          params: {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
            repositoryName: 'intent',
            repositoryOwner: 'augmentcode',
            specialist: 'pr-reviewer',
            initialMessage: 'Review PR #648 ...',
          },
        },
        preview: {
          title: 'Create workspace: Review PR #648',
        },
      },
    },
    {
      id: 'workspace-create-empty-hero',
      heading: 'workspace-create — empty hero',
      proposal: {
        kind: 'workspace-create',
        payload: {
          operation: 'workspace.create',
          params: {},
        },
        preview: {
          title: 'Create workspace',
          workspaceCreate: {},
        },
      },
    },
    {
      id: 'settings-change-friendly-pending',
      heading: 'settings-change — friendly (pending)',
      proposal: friendlySettingsProposal,
    },
    {
      id: 'settings-change-applied-with-undo',
      heading: 'settings-change — applied with undo',
      proposal: appliedSettingsProposal,
    },
    {
      id: 'specialist-edit-diff',
      heading: 'specialist-edit — diff',
      proposal: {
        kind: 'specialist-edit',
        payload: {
          operation: 'edit',
          id: 'specialist-implementor',
        },
        preview: {
          title: 'Refine implementor specialist prompt',
          summary: 'Tighten the scope language and add a verification reminder.',
          applyLabel: 'Save specialist',
          fields: [{ key: 'name', label: 'Specialist', value: 'Implementor', editable: false }],
          diff: {
            fileName: 'specialists/implementor.md',
            language: 'markdown',
            patch: `@@ -1,5 +1,6 @@\n # Implementor\n \n-Implement the assigned task.\n+Implement only the assigned task.\n+Run the smallest relevant verification command before reporting completion.\n \n Keep changes minimal and focused.`,
          },
        },
      },
    },
    {
      id: 'bulk-archive-items',
      heading: 'bulk-archive — bulk items',
      proposal: {
        kind: 'bulk-op',
        payload: {
          operation: 'workspace.bulkArchive',
          ids: ['ws-101', 'ws-102', 'ws-103', 'ws-104', 'ws-105', 'ws-106'],
        },
        preview: {
          title: 'Archive inactive workspaces',
          summary: 'Archive workspaces that have not changed in the last 30 days.',
          applyLabel: 'Archive',
          bulkItems: [
            {
              id: 'ws-101',
              title: 'Old onboarding spike',
              summary: 'Last active 41 days ago',
              selected: true,
            },
            {
              id: 'ws-102',
              title: 'Settings audit',
              summary: 'Last active 37 days ago',
              selected: true,
            },
            {
              id: 'ws-103',
              title: 'Trial import flow',
              summary: 'Last active 35 days ago',
              selected: true,
            },
            {
              id: 'ws-104',
              title: 'Archived repo cleanup',
              summary: 'Last active 62 days ago',
              selected: true,
            },
            {
              id: 'ws-105',
              title: 'Prototype prompts',
              summary: 'Last active 48 days ago',
              selected: false,
            },
            {
              id: 'ws-106',
              title: 'Pinned customer demo',
              summary: 'Pinned workspace cannot be archived in bulk',
              selected: false,
              disabled: true,
            },
          ],
          warnings: ['Pinned and locked workspaces are excluded automatically.'],
        },
      },
    },
  ];

  function truncateJson(value: unknown, maxLength = 900): string {
    const json = JSON.stringify(value, null, 2);
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
  }

  function recordAction(
    action: SandboxAction,
    variant: ProposalVariant,
    detail: ProposalActionDetail,
  ) {
    recentAction = {
      action,
      variant: variant.heading,
      detail: truncateJson(detail),
    };
  }
</script>

<section class="mx-auto max-w-5xl space-y-8 p-6 lg:p-10">
  <div class="space-y-3">
    <p class="text-xs font-medium uppercase tracking-wide text-subtle">Sandbox component</p>
    <h1 class="text-3xl font-semibold tracking-tight text-foreground">Proposal Card</h1>
    <p class="max-w-3xl text-base leading-relaxed text-subtle">
      Inline-editable proposal card variants used in Chief chat. Use the card controls to inspect
      emitted apply, discard, and edit details.
    </p>
  </div>

  <div class="rounded-xl border border-border bg-background p-4 shadow-xs">
    <div class="mb-2 flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-foreground">Recent action log</h2>
      <span class="text-xs text-subtle">Truncated JSON detail</span>
    </div>
    {#if recentAction}
      <div class="rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground">
        <div class="mb-2 text-subtle">
          {recentAction.action} · {recentAction.variant}
        </div>
        <pre
          class="max-h-72 overflow-auto whitespace-pre-wrap break-words">{recentAction.detail}</pre>
      </div>
    {:else}
      <div
        class="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-subtle"
      >
        No actions yet. Apply, discard, or edit a proposal below.
      </div>
    {/if}
  </div>

  <div class="space-y-8">
    {#each variants as variant (variant.id)}
      <article
        class="space-y-3 rounded-2xl border border-border bg-sidebar/50 p-4 shadow-xs sm:p-5"
      >
        <h2 class="text-base font-semibold text-foreground">{variant.heading}</h2>
        <ProposalCard
          proposal={variant.proposal}
          onApply={(detail) => recordAction('apply', variant, detail)}
          onDiscard={(detail) => recordAction('discard', variant, detail)}
        />
      </article>
    {/each}
  </div>
</section>
