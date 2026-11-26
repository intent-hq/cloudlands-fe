/**
 * Provider-specific copy of the profile kind screens (Settings → Add/Edit
 * profile and the orchestrator onboarding "Connect {provider}" step), one
 * place per provider so the picker, the dialog and onboarding agree.
 */
import { m } from '$shared/paraglide/messages.js';
import type { ProfileProvider, SpecializedProfileKind } from '$lib/provider-profile-kinds';

type SecretKind = 'apiKey' | 'token';

/** How to get a key or token: the steps, an optional command to copy and a link. */
export interface SecretGuide {
  /** One or two steps. */
  steps: [string] | [string, string];
  /** A command shown under the first step, with a Copy button. */
  command?: string;
  link?: { href: string; label: string };
  /** A note above the steps (who can use this kind). */
  eligibility?: string;
}

const URLS = {
  anthropicKeys: 'https://console.anthropic.com/settings/keys', // i18n-ignore (URL)
  openAiKeys: 'https://platform.openai.com/api-keys', // i18n-ignore (URL)
  openAiTokens: 'https://developers.openai.com/codex/enterprise/access-tokens', // i18n-ignore (URL)
  xaiConsole: 'https://console.x.ai', // i18n-ignore (URL)
  factoryKeys: 'https://app.factory.ai/settings/api-keys', // i18n-ignore (URL)
  cursorDashboard: 'https://cursor.com/dashboard?tab=integrations', // i18n-ignore (URL)
  deepseekKeys: 'https://platform.deepseek.com/api_keys', // i18n-ignore (URL)
  auggieAuth: 'https://docs.augmentcode.com/cli/setup-auggie/authentication', // i18n-ignore (URL)
};
const SETUP_TOKEN_COMMAND = 'claude setup-token'; // i18n-ignore (CLI command)
const AUGGIE_TOKEN_COMMAND = 'auggie token print'; // i18n-ignore (CLI command)

/** The kind card's one-line description (Settings picker and onboarding). */
export function kindCardDescription(
  provider: ProfileProvider,
  kind: SpecializedProfileKind,
): string {
  if (kind === 'differentLogin')
    return m.settings_providerProfileKinds_differentLogin_description();
  if (kind === 'token') {
    if (provider === 'codex') return m.settings_providerProfileKinds_tokenCodex_description();
    if (provider === 'auggie') return m.settings_providerProfileKinds_tokenAuggie_description();
    return m.settings_providerProfileKinds_tokenClaude_description();
  }
  switch (provider) {
    case 'codex':
      return m.settings_providerProfileKinds_apiKeyCodex_description();
    case 'grok':
      return m.settings_providerProfileKinds_apiKeyGrok_description();
    case 'droid':
      return m.settings_providerProfileKinds_apiKeyDroid_description();
    case 'cursor':
      return m.settings_providerProfileKinds_apiKeyCursor_description();
    case 'dsh':
      return m.settings_providerProfileKinds_apiKeyDsh_description();
    default:
      return m.settings_providerProfileKinds_apiKeyClaude_description();
  }
}

/** The kind's title: "API key", "Token", or Auggie's "Access token". */
export function secretKindLabel(provider: ProfileProvider, kind: SecretKind): string {
  if (kind === 'apiKey') return m.settings_providerProfileKinds_apiKey_label();
  return provider === 'auggie'
    ? m.settings_providerProfileKinds_tokenAuggie_label()
    : m.settings_providerProfileKinds_token_label();
}

/**
 * The dialog description on a key or token screen. A provider with one kind
 * shows no kind card, so its description carries the card's note (Grok's own
 * login, Cursor's CLI on each runner).
 */
export function secretDialogDescription(provider: ProfileProvider, kind: SecretKind): string {
  if (provider !== 'claude' && provider !== 'codex') return kindCardDescription(provider, kind);
  if (kind === 'token') {
    return provider === 'codex'
      ? m.settings_providerProfileKinds_tokenCodexDialog_description()
      : m.settings_providerProfileKinds_tokenClaudeDialog_description();
  }
  return provider === 'codex'
    ? m.settings_providerProfileKinds_apiKeyCodexDialog_description()
    : m.settings_providerProfileKinds_apiKeyClaudeDialog_description();
}

/** How to get the key or token, without the final "paste it" step. */
export function secretGuide(provider: ProfileProvider, kind: SecretKind): SecretGuide {
  if (kind === 'token') {
    if (provider === 'codex') {
      return {
        steps: [m.settings_providerProfileKinds_tokenCodexStep1_label()],
        link: {
          href: URLS.openAiTokens,
          label: m.settings_providerProfileKinds_openAiAccessTokens_link(),
        },
        eligibility: m.settings_providerProfileKinds_tokenCodexEligibility_description(),
      };
    }
    if (provider === 'auggie') {
      return {
        steps: [
          m.settings_providerProfileKinds_tokenAuggieStep1_label(),
          m.settings_providerProfileKinds_tokenAuggieStep2_label(),
        ],
        command: AUGGIE_TOKEN_COMMAND,
        link: {
          href: URLS.auggieAuth,
          label: m.settings_providerProfileKinds_auggieAuthDocs_link(),
        },
      };
    }
    return {
      steps: [
        m.settings_providerProfileKinds_tokenClaudeStep1_label(),
        m.settings_providerProfileKinds_tokenClaudeStep2_label(),
      ],
      command: SETUP_TOKEN_COMMAND,
    };
  }
  switch (provider) {
    case 'codex':
      return {
        steps: [
          m.settings_providerProfileKinds_apiKeyCodexStep1_label(),
          m.settings_providerProfileKinds_apiKeyCodexStep2_label(),
        ],
        link: {
          href: URLS.openAiKeys,
          label: m.settings_providerProfileKinds_openAiApiKeys_link(),
        },
      };
    case 'grok':
      return {
        steps: [
          m.settings_providerProfileKinds_apiKeyGrokStep1_label(),
          m.settings_providerProfileKinds_apiKeyGrokStep2_label(),
        ],
        link: { href: URLS.xaiConsole, label: m.settings_providerProfileKinds_xaiConsole_link() },
      };
    case 'droid':
      return {
        steps: [
          m.settings_providerProfileKinds_apiKeyDroidStep1_label(),
          m.settings_providerProfileKinds_apiKeyDroidStep2_label(),
        ],
        link: {
          href: URLS.factoryKeys,
          label: m.settings_providerProfileKinds_factoryApiKeys_link(),
        },
      };
    case 'cursor':
      return {
        steps: [
          m.settings_providerProfileKinds_apiKeyCursorStep1_label(),
          m.settings_providerProfileKinds_apiKeyCursorStep2_label(),
        ],
        link: {
          href: URLS.cursorDashboard,
          label: m.settings_providerProfileKinds_cursorDashboard_link(),
        },
      };
    case 'dsh':
      return {
        steps: [
          m.settings_providerProfileKinds_apiKeyDshStep1_label(),
          m.settings_providerProfileKinds_apiKeyDshStep2_label(),
        ],
        link: {
          href: URLS.deepseekKeys,
          label: m.settings_providerProfileKinds_deepseekApiKeys_link(),
        },
      };
    default:
      return {
        steps: [
          m.settings_providerProfileKinds_apiKeyClaudeStep1_label(),
          m.settings_providerProfileKinds_apiKeyClaudeStep2_label(),
        ],
        link: {
          href: URLS.anthropicKeys,
          label: m.settings_providerProfileKinds_anthropicConsole_link(),
        },
      };
  }
}

/** The last step: paste it, then Create (and, with a key check, Intent tests it). */
export function pasteStepLabel(kind: SecretKind, keyCheck: boolean): string {
  if (!keyCheck) return m.settings_providerProfileKinds_pasteNoCheck_label();
  return kind === 'apiKey'
    ? m.settings_providerProfileKinds_apiKeyClaudeStep3_label()
    : m.settings_providerProfileKinds_tokenClaudeStep3_label();
}

/** The inline error for a pasted key or token without its provider's shape. */
export function secretShapeError(provider: ProfileProvider, kind: SecretKind): string {
  if (kind === 'token') {
    if (provider === 'codex') return m.settings_providerProfileKinds_tokenNotJwt_error();
    if (provider === 'auggie') return m.settings_providerProfileKinds_tokenShapeAuggie_error();
    return m.settings_providerProfileKinds_tokenShapeClaude_error();
  }
  switch (provider) {
    case 'codex':
      return m.settings_providerProfileKinds_keyShapeCodex_error();
    case 'grok':
      return m.settings_providerProfileKinds_keyShapeGrok_error();
    case 'droid':
      return m.settings_providerProfileKinds_keyShapeDroid_error();
    case 'cursor':
      return m.settings_providerProfileKinds_keyShapeCursor_error();
    case 'dsh':
      return m.settings_providerProfileKinds_keyShapeDsh_error();
    default:
      return m.settings_providerProfileKinds_keyShapeClaude_error();
  }
}
