import {
  getProviderConfig,
  isProviderAuthenticationError,
} from '$shared/config/provider-config';

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
  return 'Failed to load models';
}

function stripProviderPrefix(message: string, providerId: string, providerName: string): string {
  const prefixes = [providerName, providerId, getProviderConfig(providerId).command].filter(Boolean);
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
  const config = getProviderConfig(providerId);
  const lowerMessage = message.toLowerCase();

  if (isProviderAuthenticationError(providerId, message)) {
    const loginCommand = config.loginCommandHint || `${config.command} login`;
    return `Run "${loginCommand}" in a terminal.`;
  }

  if (
    lowerMessage.includes('cli not found') ||
    lowerMessage.includes('not installed') ||
    lowerMessage.includes('not available')
  ) {
    if (providerId === 'auggie') {
      return 'Install via "npm install -g @augmentcode/auggie" or use the Auggie setup flow.';
    }
    if (config.loginDocsUrl) {
      return `See setup docs: ${config.loginDocsUrl}`;
    }
    return `Install the ${config.displayName} CLI and make sure "${config.command}" is on PATH.`;
  }

  return undefined;
}

export function formatProviderLoadError(providerId: string, error: unknown): ProviderLoadError {
  const normalizedId = getProviderConfig(providerId).id;
  const providerConfig = getProviderConfig(normalizedId);
  const providerName = providerConfig.displayName || normalizedId;
  const message = stripProviderPrefix(getErrorMessage(error), normalizedId, providerName);

  return {
    providerId: normalizedId,
    providerName,
    message,
    displayText: `${providerName}: ${message}`,
    hint: getProviderErrorHint(normalizedId, message),
  };
}