/** Select and remember a saved machine for the dock only. Native owns document replacement. */
export interface SwitchDockBackendRequest {
  backendId: string;
}

/** The connection is ready; native navigation begins after this invoke returns. */
export interface SwitchDockBackendResult {
  success: true;
}

/** A previously accepted switch was cancelled while its original document was still live. */
export interface DockBackendSwitchFailed {
  backendId: string;
}

/** Present a generic retry error after native has restored the previous machine. */
export const DOCK_BACKEND_SWITCH_FAILED_QUERY = 'dockBackendSwitchFailed';
