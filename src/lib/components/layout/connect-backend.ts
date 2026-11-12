export type ConnectBackendStep = 'details' | 'confirm' | 'syncConfirm';

/** The actions `ConnectBackendForm` exports, for the footer that drives it. */
export interface ConnectBackendForm {
  capture(): void;
  confirm(): void;
  back(): void;
  declineSync(): void;
  enableSyncAndAdd(): void;
  reset(): void;
}
