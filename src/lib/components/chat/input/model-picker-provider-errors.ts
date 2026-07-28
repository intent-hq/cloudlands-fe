import {
  selectIsProviderAuthenticationError,
  selectNormalizedProviderId,
  selectProviderCatalogEntryOrDefault,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';

export type ProviderLoadError = {
  providerId: string;
  providerName: string;
  message: string;
  displayText: string;
  hint?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return m.chat_modelPicker_loadFailed_label();
}

function stripProviderPrefix(message: string, providerId: string, providerName: string): string {
  const command = selectProviderCatalogEntryOrDefault.select(appStore.state, providerId)?.command;
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

export function getProviderErrorHint(providerId: string, message: string): string | undefined {
  const state = appStore.state;
  const entry = selectProviderCatalogEntryOrDefault.select(state, providerId);
  const lowerMessage = message.toLowerCase();

  if (selectIsProviderAuthenticationError.select(state, providerId, message)) {
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

export function formatProviderLoadError(providerId: string, error: unknown): ProviderLoadError {
  const state = appStore.state;
  const normalizedId = selectNormalizedProviderId.select(state, providerId);
  const entry = selectProviderCatalogEntryOrDefault.select(state, normalizedId);
  const providerName = entry?.displayName || normalizedId;
  const message = stripProviderPrefix(getErrorMessage(error), normalizedId, providerName);

  return {
    providerId: normalizedId,
    providerName,
    message,
    displayText: `${providerName}: ${message}`,
    hint: getProviderErrorHint(normalizedId, message),
  };
}