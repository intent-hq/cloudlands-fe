/**
 * Shared agent-feature definitions: the daemon-owned `agentFeatures.*`
 * settings paths with their curated labels and descriptions
 * (`settings_agentFeatures_*`). Single source of truth for both the
 * settings page (AgentFeaturesSettings.svelte) and the read-only harness
 * features modal (harness-feature-catalog.ts), so a new feature toggle
 * added here shows up in both surfaces automatically.
 *
 * `defaultValue` mirrors the daemon's own default for the path: every
 * feature defaults on except `peerAgents` (the one opt-in toggle), so an
 * absent settings.list entry must coerce per feature, not blanket-true.
 */
import { m } from '$shared/paraglide/messages.js';

// i18n-ignore (wire setting paths, not user-facing text)
export const FEATURE_PATHS = [
  'agentFeatures.backgroundHooks',
  'agentFeatures.hostExec',
  'agentFeatures.scripts',
  'agentFeatures.terminalAccess',
  'agentFeatures.browserAutomation',
  'agentFeatures.richChatBlocks',
  'agentFeatures.structuredQuestions',
  'agentFeatures.attentionRequests',
  'agentFeatures.stateSnapshot',
  'agentFeatures.prMonitor',
  'agentFeatures.taskGraph',
  'agentFeatures.peerAgents',
  'agentFeatures.mcpTools',
] as const;

export type FeaturePath = (typeof FEATURE_PATHS)[number];

export const FEATURES: {
  path: FeaturePath;
  label: () => string;
  description: () => string;
  defaultValue: boolean;
}[] = [
  {
    path: 'agentFeatures.backgroundHooks',
    label: () => m.settings_agentFeatures_backgroundHooks_label(),
    description: () => m.settings_agentFeatures_backgroundHooks_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.hostExec',
    label: () => m.settings_agentFeatures_hostExec_label(),
    description: () => m.settings_agentFeatures_hostExec_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.scripts',
    label: () => m.settings_agentFeatures_scripts_label(),
    description: () => m.settings_agentFeatures_scripts_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.terminalAccess',
    label: () => m.settings_agentFeatures_terminalAccess_label(),
    description: () => m.settings_agentFeatures_terminalAccess_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.browserAutomation',
    label: () => m.settings_agentFeatures_browserAutomation_label(),
    description: () => m.settings_agentFeatures_browserAutomation_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.richChatBlocks',
    label: () => m.settings_agentFeatures_richChatBlocks_label(),
    description: () => m.settings_agentFeatures_richChatBlocks_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.structuredQuestions',
    label: () => m.settings_agentFeatures_structuredQuestions_label(),
    description: () => m.settings_agentFeatures_structuredQuestions_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.attentionRequests',
    label: () => m.settings_agentFeatures_attentionRequests_label(),
    description: () => m.settings_agentFeatures_attentionRequests_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.stateSnapshot',
    label: () => m.settings_agentFeatures_stateSnapshot_label(),
    description: () => m.settings_agentFeatures_stateSnapshot_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.prMonitor',
    label: () => m.settings_agentFeatures_prMonitor_label(),
    description: () => m.settings_agentFeatures_prMonitor_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.taskGraph',
    label: () => m.settings_agentFeatures_taskGraph_label(),
    description: () => m.settings_agentFeatures_taskGraph_description(),
    defaultValue: true,
  },
  {
    path: 'agentFeatures.peerAgents',
    label: () => m.settings_agentFeatures_peerAgents_label(),
    description: () => m.settings_agentFeatures_peerAgents_description(),
    defaultValue: false,
  },
  {
    path: 'agentFeatures.mcpTools',
    label: () => m.settings_agentFeatures_mcpTools_label(),
    description: () => m.settings_agentFeatures_mcpTools_description(),
    defaultValue: true,
  },
];

/** Per-feature daemon defaults, keyed by settings path. */
export const FEATURE_DEFAULTS: Record<FeaturePath, boolean> = Object.fromEntries(
  FEATURES.map((feature) => [feature.path, feature.defaultValue]),
) as Record<FeaturePath, boolean>;
