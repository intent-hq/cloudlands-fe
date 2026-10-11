export type ProviderLoadError = {
  providerId: string;
  providerName: string;
  message: string;
  details: string;
  displayText: string;
  hint?: string;
};
