/**
 * PROTOCOL §5.38-shaped mock provider catalog for tests.
 *
 * Rows mirror the daemon's compiled-in registry (intent-providers
 * `ACP_PROVIDERS` + `PROVIDER_MODEL_TIERS`) so tests exercise realistic ids,
 * display names, and tier tables. Seed it into a store by dispatching
 * `providerCatalogLoaded(MOCK_PROVIDER_CATALOG)` (or via
 * `seedProviderCatalog(store)`), never by hardcoding rows inline.
 */
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';

export const MOCK_PROVIDER_CATALOG: ProviderCatalogResult = {
  providers: [
    {
      id: 'auggie',
      displayName: 'Augment Auggie',
      shortName: 'Auggie',
      command: 'auggie',
      isDefault: true,
      canBeDisabled: true,
      loginCommandHint: 'auggie login',
      authErrorPatterns: ['not authenticated', 'authentication required', 'auggie login'],
      visible: true,
      modelTiers: { fast: 'haiku4.5', balanced: 'sonnet4.5', smart: 'opus4.7' },
    },
    {
      id: 'claude-code',
      displayName: 'Anthropic Claude Code',
      shortName: 'Claude Code',
      command: 'claude-agent-acp',
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: 'https://code.claude.com/docs/en/quickstart',
      visible: true,
      modelTiers: { fast: 'haiku', balanced: 'sonnet', smart: 'default' },
    },
    {
      id: 'codex',
      displayName: 'OpenAI Codex',
      shortName: 'Codex',
      command: 'codex-acp',
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: 'https://developers.openai.com/codex/cli#cli-setup',
      visible: true,
      modelTiers: {
        fast: 'gpt-5.3-codex/medium',
        balanced: 'gpt-5.3-codex/high',
        smart: 'gpt-5.3-codex/xhigh',
      },
    },
    {
      id: 'cortex',
      displayName: 'Snowflake Cortex',
      shortName: 'Cortex',
      command: 'cortex-acp',
      isDefault: false,
      canBeDisabled: true,
      requiresFeatureCode: 'cortex',
      visible: false,
      modelTiers: {
        fast: 'claude-sonnet-4-5',
        balanced: 'claude-opus-4-5',
        smart: 'claude-opus-4-5',
      },
    },
    {
      id: 'opencode',
      displayName: 'OpenCode',
      shortName: 'OpenCode',
      command: 'opencode',
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: 'https://opencode.ai/docs#configure',
      visible: true,
    },
    {
      id: 'unsloth',
      displayName: 'Unsloth',
      shortName: 'Unsloth',
      command: 'opencode',
      isDefault: false,
      canBeDisabled: true,
      visible: true,
    },
    {
      id: 'pi',
      displayName: 'Pi',
      shortName: 'Pi',
      command: 'pi-acp',
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: 'https://pi.dev/docs/latest/quickstart',
      visible: true,
    },
    {
      id: 'droid',
      displayName: 'Factory Droid',
      shortName: 'Droid',
      command: 'droid',
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: 'https://docs.factory.ai/cli/getting-started/overview',
      visible: true,
    },
    {
      id: 'grok',
      displayName: 'Grok Build',
      shortName: 'Grok',
      command: 'grok',
      isDefault: false,
      canBeDisabled: true,
      loginCommandHint: 'grok login',
      loginDocsUrl: 'https://docs.x.ai/build/enterprise#authentication',
      visible: true,
    },
    {
      id: 'mock',
      displayName: 'Mock (E2E)',
      shortName: 'Mock',
      command: 'node',
      isDefault: false,
      canBeDisabled: true,
      requiresEnvVar: 'MOCK_AGENT_SCRIPT_PATH',
      visible: false,
    },
  ],
  defaultProviderId: 'auggie',
};

/**
 * Dispatch the mock catalog into a store (the shape used by appStore).
 * The store must already be initialized (`appStore.init()`).
 */
export function seedProviderCatalog(store: {
  dispatch: (action: unknown) => unknown;
}): void {
  store.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
}
