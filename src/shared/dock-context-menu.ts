/** Presentation only; selecting a device still uses the dock backend-switch IPC. */
export interface DockContextMenuRequest {
  machines?: { id: string; label: string }[];
  currentId?: string;
  pending?: string | null;
  error?: boolean;
}
export interface DockContextMenuResult {
  shown: boolean;
  backendId?: string;
}
