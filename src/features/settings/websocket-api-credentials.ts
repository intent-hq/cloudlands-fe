import type { SettingsFormRequest } from '$store/renderer/slices/settings-events/settings-events-types';

type Credentials = { token: string; qrDataUrl: string };
type Recipient = {
  sessionId: string;
  requestIds: Record<string, string>;
  value: Credentials;
  receive: (value: Credentials) => void;
};

// Deliberately outside Redux, action payloads and persistence. This is a
// mount-scoped delivery boundary for credentials, not a settings data cache.
const recipients = new Map<string, Recipient>();

export function registerWebsocketCredentials(
  formId: string,
  sessionId: string,
  receive: Recipient['receive'],
): () => void {
  clearWebsocketCredentials(formId);
  const recipient: Recipient = {
    sessionId,
    requestIds: {},
    value: { token: '', qrDataUrl: '' },
    receive,
  };
  recipients.set(formId, recipient);
  return () => {
    if (recipients.get(formId) === recipient) clearWebsocketCredentials(formId);
  };
}

export function beginWebsocketCredentialRequest(identity: SettingsFormRequest): void {
  const recipient = recipients.get(identity.formId);
  if (recipient?.sessionId !== identity.sessionId) return;
  if (identity.resource === 'save') {
    delete recipient.requestIds.load;
    delete recipient.requestIds.qr;
    recipient.value = { ...recipient.value, qrDataUrl: '' };
    recipient.receive(recipient.value);
  }
  recipient.requestIds[identity.resource] = identity.requestId;
}

export function receiveWebsocketCredentials(
  identity: SettingsFormRequest,
  value: Partial<Credentials>,
): void {
  const recipient = recipients.get(identity.formId);
  if (
    recipient?.sessionId !== identity.sessionId ||
    recipient.requestIds[identity.resource] !== identity.requestId
  )
    return;
  recipient.value = { ...recipient.value, ...value };
  recipient.receive(recipient.value);
}

export function readWebsocketToken(identity: SettingsFormRequest): string {
  const recipient = recipients.get(identity.formId);
  return recipient?.sessionId === identity.sessionId ? recipient.value.token : '';
}

export function clearWebsocketCredentials(formId: string, sessionId?: string): void {
  const recipient = recipients.get(formId);
  if (!recipient || (sessionId !== undefined && recipient.sessionId !== sessionId)) return;
  recipients.delete(formId);
  recipient.value = { token: '', qrDataUrl: '' };
  recipient.receive(recipient.value);
}

export function clearAllWebsocketCredentials(): void {
  for (const formId of recipients.keys()) clearWebsocketCredentials(formId);
}
