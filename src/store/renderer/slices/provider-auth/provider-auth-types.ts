/** UI correlation only. Credentials must never be copied into operation state. */
export type ProviderAuthRequest = {
  requestId: string;
  consumerId: string | null;
};

export type ProviderAuthOperation = ProviderAuthRequest & {
  kind: 'connect' | 'logout';
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
};
