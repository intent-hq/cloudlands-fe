<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import EventSubscriptionsCard from '$lib/components/chat/EventSubscriptionsCard.svelte';
  import DelegationGroupSection from '$lib/components/chat/DelegationGroupSection.svelte';
  import AgentMessageAttributionHeader from '$lib/components/chat/AgentMessageAttributionHeader.svelte';
  import AutomatedWakeCardHeader from '$lib/components/chat/AutomatedWakeCardHeader.svelte';
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';
  import HookWakeAttributionHeader from '$lib/components/chat/HookWakeAttributionHeader.svelte';
  import PrMonitorWakeAttributionHeader from '$lib/components/chat/PrMonitorWakeAttributionHeader.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { backgroundHooksUpdated } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import { prMonitorsUpdated } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import {
    initializeLayout,
    clearPanelLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    setSubscriptionSnapshot,
    setWokenUp,
    deleteSubscriptionUI,
  } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
  import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    setEventSubscriptionsExpanded,
    setBrowserTabsExpanded,
    setExpandedPrMonitorId,
  } from '$lib/components/chat/agent-subscriptions-view-state';
  import {
    agentCardFixtures,
    delegationGroups,
    liveCardFixtures,
  } from '../subscription-rows/subscription-row-fixtures';

  let {
    fixture: _fixture,
    componentId: _componentId,
  }: { fixture: UiComponentFixture; componentId: string } = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const liveIds: Array<{ workspaceId: string; agentId: string }> = [];

  for (const fixture of liveCardFixtures) {
    const workspaceId = `catalog-subscription-rows-${fixture.id}`;
    const agentId = `catalog-parent-${fixture.id}`;
    liveIds.push({ workspaceId, agentId });
    const own = <T extends { workspaceId: string; agentId: string }>(rows: T[]) =>
      rows.map((row) => ({ ...row, workspaceId, agentId }));
    store.dispatch(backgroundHooksUpdated(workspaceId, own(fixture.hooks ?? [])));
    store.dispatch(prMonitorsUpdated(workspaceId, own(fixture.prs ?? [])));
    const tabs = [...(fixture.tabs ?? []), ...(fixture.hiddenTabs ?? [])].map((tab) => ({
      ...tab,
      workspaceId,
      ownerAgentId: agentId,
    }));
    const visibleCount = fixture.tabs?.length ?? 0;
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: `panel-${fixture.id}` },
        panels: {
          [`panel-${fixture.id}`]: {
            id: `panel-${fixture.id}`,
            tabs: tabs.slice(0, visibleCount),
            activeTabId: tabs[0]?.id ?? null,
          },
        },
        focusedPanelId: `panel-${fixture.id}`,
        hiddenTabs: tabs.slice(visibleCount),
      }),
    );
    const agents = fixture.agents ?? [];
    const completed = new Set(fixture.completedAgents ?? []);
    if (fixture.woken)
      store.dispatch(
        setWokenUp(workspaceId, agentId, {
          eventCount: 2,
          eventTypes: ['agent:idle'],
          timestamp: Date.parse('2026-09-01T09:10:00.000Z'),
        }),
      );
    store.dispatch(
      setSubscriptionSnapshot(workspaceId, agentId, {
        subscriptions: agents.map((watchedAgentId, index) => ({
          id: `${fixture.id}-subscription-${index}`,
          agentId,
          eventTypes: ['agent:idle'],
          actorIds: [watchedAgentId],
          createdAt: `2026-09-01T09:0${index}:00.000Z`,
          description: 'Catalog completion watch',
        })),
        delegationGroups: [],
        agentStatuses: Object.fromEntries(
          agents.map((id) => [id, completed.has(id) ? 'completed' : 'responding']),
        ),
        waitingState:
          completed.size === agents.length && agents.length > 0
            ? 'completed'
            : agents.length > 0
              ? 'waiting'
              : 'idle',
      }),
    );
    setEventSubscriptionsExpanded(workspaceId, agentId, fixture.state === 'expanded');
    setBrowserTabsExpanded(workspaceId, agentId, fixture.state === 'expanded');
    setExpandedPrMonitorId(
      workspaceId,
      agentId,
      fixture.state === 'expanded' ? (fixture.prs?.[0]?.monitorId ?? null) : null,
    );
  }

  onMount(() => {
    void tick().then(() => {
      document
        .querySelectorAll<HTMLElement>('[data-catalog-auto-expand]')
        .forEach((specimen) =>
          specimen.querySelector<HTMLElement>('[aria-expanded="false"]')?.click(),
        );
    });
  });

  onDestroy(() => {
    for (const { workspaceId, agentId } of liveIds) {
      store.dispatch(deleteSubscriptionUI(workspaceId, agentId));
      store.dispatch(clearPanelLayout(workspaceId));
      store.dispatch(removeWorkspaceEntity(workspaceId));
    }
    disposeStore();
  });

  const hookPresentation = {
    kind: 'hook' as const,
    attribution: {
      hookId: 'header-hook',
      displayName: 'Release monitor',
      rawName: 'Release monitor',
      reason: 'dispatched',
      hookStillActive: true,
    },
    bodyText: 'A release changed.',
    queueInfo: null,
    state: 'active' as const,
  };
  const wakeMetadata = {
    type: 'event_notification' as const,
    eventCount: 2,
    eventTypes: ['agent:idle'],
    events: [
      {
        type: 'agent:idle',
        timestamp: '2026-09-01T09:10:00.000Z',
        data: { agentId: 'wake-agent', agentName: 'Fixture agent' },
      },
    ],
  };
  const stateLabel = (state: 'collapsed' | 'expanded' | 'static') =>
    state === 'collapsed'
      ? m.sandbox_subscriptionRows_collapsed_label()
      : state === 'expanded'
        ? m.sandbox_subscriptionRows_expanded_label()
        : m.sandbox_subscriptionRows_static_label();
</script>

{#snippet caption(label: string, state: 'collapsed' | 'expanded' | 'static')}
  <p class="mb-2 truncate text-xs text-muted-foreground" title={label}>
    {m.sandbox_subscriptionRows_caption_label({ name: label, state: stateLabel(state) })}
  </p>
{/snippet}

<div class="subscription-catalog space-y-8" data-testid="subscription-rows-preview">
  <section>
    <h2>{m.sandbox_subscriptionRows_cards_title()}</h2>
    <div class="specimen-grid">
      {#each agentCardFixtures as item (item.id)}
        <article>
          {@render caption(item.label, item.state)}<EventSubscriptionsCard
            workspaceId={`isolated-${item.id}`}
            agentId={`isolated-parent-${item.id}`}
            isolatedPreview={{
              count: item.count,
              mode: 'agents',
              initiallyExpanded: item.state === 'expanded',
              agents: Array.from({ length: item.count }, (_, index) => ({
                id: `${item.id}-agent-${index}`,
                name: `Fixture agent ${index + 1}`,
                finished: index >= item.count - item.finishedCount,
              })),
            }}
          />
        </article>
      {/each}
      {#each liveCardFixtures as item (item.id)}
        <article
          data-catalog-auto-expand={item.state === 'expanded' && item.hooks?.length
            ? ''
            : undefined}
        >
          {@render caption(item.label, item.state)}
          <EventSubscriptionsCard
            workspaceId={`catalog-subscription-rows-${item.id}`}
            agentId={`catalog-parent-${item.id}`}
          />
        </article>
      {/each}
    </div>
  </section>

  <section>
    <h2>{m.sandbox_subscriptionRows_delegation_title()}</h2>
    <div class="specimen-grid">
      {#each delegationGroups as item (item.id)}
        <article>
          {@render caption(item.label, 'collapsed')}<DelegationGroupSection
            group={item.group}
            hideActions
          />
        </article>
        <article data-catalog-auto-expand data-catalog-delegation-state="expanded">
          {@render caption(item.label, 'expanded')}<DelegationGroupSection
            group={{ ...item.group, groupId: `${item.group.groupId}-expanded` }}
            hideActions
          />
        </article>
      {/each}
    </div>
  </section>

  <section>
    <h2>{m.sandbox_subscriptionRows_headers_title()}</h2>
    <div class="specimen-grid headers">
      {#each ['collapsed', 'expanded'] as state}
        <article>
          {@render caption('Agent message attribution', state as 'collapsed' | 'expanded')}
          <div class="header-surface">
            <AgentMessageAttributionHeader
              attribution={{
                fromAgentId: `sender-${state}`,
                displayName: 'Catalog builder',
                rawName: 'Catalog builder',
                kind: 'agent',
              }}
              preview="Sent a detailed subscription-row review"
              expanded={state === 'expanded'}
              controlsId={`agent-header-${state}`}
              specialist="implementor"
              ontoggle={() => {}}
            />
          </div>
        </article>
        <article>
          {@render caption('Automated wake card header', state as 'collapsed' | 'expanded')}
          <div class="header-surface">
            <AutomatedWakeCardHeader
              presentation={hookPresentation}
              expanded={state === 'expanded'}
              controlsId={`wake-header-${state}`}
              ontoggle={() => {}}
            />
          </div>
        </article>
      {/each}
      {#each [false, true] as compact}
        {#each ['collapsed', 'expanded'] as state}
          <article data-catalog-auto-expand={state === 'expanded' ? '' : undefined}>
            {@render caption(
              compact ? 'Event wake divider, compact' : 'Event wake divider',
              state as 'collapsed' | 'expanded',
            )}<EventWakeupBanner
              metadata={wakeMetadata}
              asDivider
              {compact}
              showAgentCards={false}
            />
          </article>
        {/each}
      {/each}
      <article>
        {@render caption('Hook wake attribution', 'static')}
        <div class="header-surface">
          <HookWakeAttributionHeader attribution={hookPresentation.attribution} />
        </div>
      </article>
      <article>
        {@render caption('PR monitor wake attribution', 'static')}
        <div class="header-surface">
          <PrMonitorWakeAttributionHeader
            attribution={{
              monitorId: 'header-pr',
              repo: 'intent-hq/cloudlands-fe',
              prNumber: 2107,
              reason: 'changed',
            }}
          />
        </div>
      </article>
    </div>
  </section>

  <section>
    <h2>{m.sandbox_subscriptionRows_narrow_title()}</h2>
    <div class="narrow-grid">
      <article>
        {@render caption('Mixed card at 280px', 'expanded')}<EventSubscriptionsCard
          workspaceId="catalog-subscription-rows-mixed-expanded"
          agentId="catalog-parent-mixed-expanded"
        />
      </article>
      <article>
        {@render caption('Agent message header at 280px', 'collapsed')}
        <div class="header-surface">
          <AgentMessageAttributionHeader
            attribution={{
              fromAgentId: 'narrow-sender',
              displayName: 'Agent with a long display name',
              rawName: 'Agent with a long display name',
              kind: 'agent',
            }}
            preview="A long message preview that demonstrates single-line truncation at the minimum width"
            expanded={false}
            controlsId="narrow-agent-header"
            ontoggle={() => {}}
          />
        </div>
      </article>
    </div>
  </section>
</div>

<style>
  section > h2 {
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: hsl(var(--foreground));
  }
  .specimen-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: 1rem;
  }
  article {
    min-width: 0;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--background));
    padding: 0.75rem;
  }
  article :global([data-testid='subscription-utility-area']) {
    margin-top: 0;
  }
  .header-surface {
    min-width: 0;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--card));
  }
  .narrow-grid {
    display: grid;
    width: 280px;
    max-width: 100%;
    gap: 1rem;
  }
</style>
