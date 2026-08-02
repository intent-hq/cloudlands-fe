/**
 * "Try to shrink this workspace" action for the disk-usage pill tooltip.
 *
 * Creates an idle implementor-specialist chat agent (no initial message — the
 * agent does NOT start working), persists the canned shrink prompt as the
 * composer draft via the daemon drafts API (PROTOCOL §5.16), then opens the
 * agent's tab. ChatPanel restores the draft on mount, so the user reviews or
 * edits the prompt and sends it themselves.
 */
import type { Workspace } from '$shared/types';
import { createAgentTypeId } from '$shared/types/agent.types';
import { store as appStore } from '$store/renderer/store';
import { agentSessionLaunchAgentRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  selectEffectiveBehaviorPrompt,
  selectEffectiveCodingAgent,
  selectEffectiveModel,
} from '$store/renderer/slices/specialists/specialists-selectors';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { appClient } from '$lib/client';
import { SPECIALISTS } from '$lib/constants/specialists';
import { m } from '$shared/paraglide/messages.js';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ShrinkWorkspaceAction');

export const SHRINK_WORKSPACE_PROMPT =
  // i18n-ignore (agent-facing prompt, kept in English)
  "Analyze this workspace directory's disk usage and safely reduce it. " +
  // i18n-ignore (agent-facing prompt, kept in English)
  'Prune build artifacts, dependency/tool caches, and stale tool outputs that can be regenerated. ' +
  // i18n-ignore (agent-facing prompt, kept in English)
  'Never delete uncommitted work, git state (.git), or anything that cannot be recreated. ' +
  // i18n-ignore (agent-facing prompt, kept in English)
  'When done, report what was removed and how much space was freed.';

/**
 * Launch the idle implementor agent, prefill its composer draft with the
 * canned shrink prompt, and open its tab.
 */
export async function runShrinkWorkspaceAction(workspace: Workspace): Promise<void> {
  const state = appStore.state;
  const provider = selectEffectiveCodingAgent.select(state, 'implementor') || undefined;
  let model = selectEffectiveModel.select(state, 'implementor') || undefined;
  let behaviorPrompt = selectEffectiveBehaviorPrompt.select(state, 'implementor') || undefined;
  if (!behaviorPrompt) {
    const implementorSpec = SPECIALISTS.find((s) => s.id === 'implementor');
    behaviorPrompt = implementorSpec?.defaultBehaviorPrompt;
    if (!model) model = implementorSpec?.defaultModel;
  }

  try {
    // No initial message: the agent session is created idle so nothing runs
    // until the user sends the prefilled prompt.
    const launchAction = agentSessionLaunchAgentRequested(workspace.id, {
      name: m.workspace_diskUsagePill_shrinkAgent_name(),
      // Generated name — keep the session self-renameable.
      nameExplicitlySet: false,
      agentType: createAgentTypeId('chat'),
      model,
      provider,
      behaviorPrompt,
      source: 'disk-usage-pill',
      metadata: { specialist: 'implementor', source: 'disk-usage-pill' },
    });
    appStore.dispatch(launchAction);
    const session = await launchAction.promise;

    // Persist the draft BEFORE opening the tab so ChatPanel's restore-on-mount
    // (drafts.get) finds it and prefills the composer.
    await appClient.drafts.set(workspace.id, session.id, SHRINK_WORKSPACE_PROMPT);

    appStore.dispatch(openAgentTabRequested(workspace.id, { agentId: session.id }));
  } catch (error) {
    logger.error('Failed to launch shrink-workspace agent', {
      workspaceId: workspace.id,
      error: String(error),
    });
  }
}
