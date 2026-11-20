<script lang="ts">
  import { faTerminal } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { RpcCallProposal, RpcCallProposalCall } from '$shared/types/proposal';
  import type { RpcProposalResolution } from '$shared/types/rpc-proposal';
  import ProposalCardHeader from './ProposalCardHeader.svelte';

  interface Props {
    proposal: RpcCallProposal;
    onResolve: (decision: 'approve' | 'reject') => Promise<RpcProposalResolution>;
  }

  let { proposal, onResolve }: Props = $props();
  let busy = $state<'approve' | 'reject' | null>(null);
  let error = $state<string | null>(null);

  const groups = $derived(groupByBackend(proposal.payload.calls ?? []));

  function groupByBackend(calls: RpcCallProposalCall[]) {
    const byId = new Map<string, { name: string; calls: RpcCallProposalCall[] }>();
    for (const call of calls) {
      const id = call.backend?.id ?? 'local';
      const group = byId.get(id) ?? { name: call.backend?.name || id, calls: [] };
      group.calls.push(call);
      byId.set(id, group);
    }
    return [...byId.entries()].map(([id, group]) => ({ id, ...group }));
  }

  function formatParams(params: unknown): string {
    return JSON.stringify(params ?? {}, null, 2) ?? '{}';
  }

  async function resolve(decision: 'approve' | 'reject'): Promise<void> {
    if (busy) return;
    busy = decision;
    error = null;
    const result = await onResolve(decision);
    busy = null;
    if (!result.success) error = m.chat_rpcProposal_resolveFailed_error({ error: result.error });
  }
</script>

<section
  class="min-w-0 w-full overflow-hidden rounded-(--radius-large) border border-border bg-card shadow-(--elevation-raised)"
  data-proposal-kind="rpc-call"
  data-apply-tool-call-id={proposal.applyToolCallId}
>
  <div class="px-5 pt-5">
    <ProposalCardHeader
      icon={faTerminal}
      title={proposal.preview.title}
      summary={proposal.preview.summary}
    />
  </div>

  <div class="space-y-4 px-5 py-4">
    {#each groups as group (group.id)}
      <div class="space-y-2" data-rpc-backend={group.id}>
        {#if groups.length > 1}
          <p class="type-caption font-medium text-muted-foreground">{group.name}</p>
        {/if}
        <div class="space-y-2">
          {#each group.calls as call (call.index)}
            <div
              class="min-w-0 rounded-(--radius-large) border border-border bg-muted/20 px-3 py-2.5"
              data-rpc-call={call.index}
            >
              <div class="flex min-w-0 items-baseline gap-2">
                <code class="type-body font-mono font-medium text-foreground">{call.method}</code>
                {#if call.summary}
                  <span class="type-caption min-w-0 truncate text-muted-foreground">
                    {call.summary}
                  </span>
                {/if}
              </div>
              <pre
                class="type-caption mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-foreground"
                data-rpc-params>{formatParams(call.params)}</pre>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  {#if error}
    <p
      class="type-caption border-t border-border px-5 py-2 text-danger"
      role="status"
      aria-live="assertive"
    >
      {error}
    </p>
  {/if}

  <div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-4">
    <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => resolve('reject')}>
      {m.chat_rpcProposal_reject_label()}
    </Button>
    <Button variant="primary" size="sm" disabled={busy !== null} onclick={() => resolve('approve')}>
      {busy === 'approve' ? m.chat_rpcProposal_running_label() : m.chat_rpcProposal_approve_label()}
    </Button>
  </div>
</section>
