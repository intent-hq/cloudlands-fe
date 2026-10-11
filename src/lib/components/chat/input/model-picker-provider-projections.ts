import { isProviderAuthenticationErrorForEntry } from '$shared/provider-catalog';
import { m } from '$shared/paraglide/messages.js';
import type { ProviderLoadError } from './provider-load-error';
import type {
  ModelPickerProviderContext,
  ProviderWarningNotice,
} from './model-picker-projection-types';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return m.chat_modelPicker_loadFailed_label();
}

function stripProviderPrefix(
  message: string,
  providerId: string,
  providerName: string,
  context: ModelPickerProviderContext,
): string {
  const command = context.resolveProviderEntry(providerId)?.command;
  const prefixes = [providerName, providerId, command].filter(Boolean);
  const trimmed = message.trim();

  for (const prefix of prefixes) {
    const prefixWithColon = `${prefix}:`;
    if (trimmed.toLowerCase().startsWith(prefixWithColon.toLowerCase())) {
      return trimmed.slice(prefixWithColon.length).trim();
    }
  }

  return trimmed;
}

function getProviderErrorHint(
  providerId: string,
  message: string,
  context: ModelPickerProviderContext,
): string | undefined {
  if (context.isHostMember) return undefined;
  const entry = context.resolveProviderEntry(providerId);
  const lowerMessage = message.toLowerCase();

  if (isProviderAuthenticationErrorForEntry(entry, message)) {
    const loginCommand = entry?.loginCommandHint || `${entry?.command ?? providerId} login`;
    return m.chat_modelPicker_runLoginHint_label({ command: loginCommand });
  }

  if (
    lowerMessage.includes('cli not found') ||
    lowerMessage.includes('not installed') ||
    lowerMessage.includes('not available')
  ) {
    if (providerId === 'auggie') {
      return m.chat_modelPicker_installAuggieHint_label();
    }
    if (entry?.loginDocsUrl) {
      return m.chat_modelPicker_setupDocsHint_label({ url: entry.loginDocsUrl });
    }
    return m.chat_modelPicker_installCliHint_label({
      provider: entry?.displayName ?? providerId,
      command: entry?.command ?? providerId,
    });
  }

  return undefined;
}

export function formatProviderLoadError(
  providerId: string,
  error: unknown,
  context: ModelPickerProviderContext,
): ProviderLoadError {
  const normalizedId = context.normalizeProviderId(providerId);
  const entry = context.resolveProviderEntry(normalizedId);
  const providerName = entry?.displayName || normalizedId;
  const details = getErrorMessage(error);
  const stripped = stripProviderPrefix(details, normalizedId, providerName, context);
  // Diagnostics belong in the reading dialog, not in a clipped picker row.
  const message =
    stripped.length > 160 || /[\r\n]/.test(stripped)
      ? m.chat_modelPicker_loadFailed_label()
      : stripped;

  return {
    providerId: normalizedId,
    providerName,
    message,
    details,
    displayText: `${providerName}: ${message}`,
    hint: getProviderErrorHint(normalizedId, stripped, context),
  };
}

export function createProviderWarningNotice(
  providerId: string,
  warning: string | undefined,
  context: ModelPickerProviderContext,
): ProviderWarningNotice | null {
  if (!warning) return null;
  const provider = context.resolveProviderEntry(providerId);
  return {
    providerId: provider?.id ?? providerId,
    providerName: provider?.displayName ?? providerId,
    message: warning,
    docsUrl: provider?.loginDocsUrl,
  };
}
