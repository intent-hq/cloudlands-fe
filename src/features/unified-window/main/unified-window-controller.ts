/**
 * The Unified window (Labs), main side. One window whose renderer (the shell)
 * owns the cross-machine tab strip, plus one lazily created view per machine that
 * runs the normal app in embedded mode and shows that machine's workspace, Home or
 * Settings. Electron objects are reached through {@link UnifiedWindowHost} so the
 * window/view lifecycle is unit-testable.
 */
import type { UnifiedWindowState } from '../unified-window-state';

export interface UnifiedViewHandle {
  readonly machineId: string;
  /** Load the embedded app at `route` (first show) */
  load(route: string): void;
  /** Ask the already-loaded app to navigate. */
  navigate(route: string): void;
  setBounds(bounds: Rect): void;
  setVisible(visible: boolean): void;
  send(channel: string, payload: unknown): void;
  /** A PNG data URL of what the view shows now (null when it cannot be captured). */
  capture(): Promise<string | null>;
  isDestroyed(): boolean;
  destroy(): void;
}

export interface UnifiedHostWindow {
  isDestroyed(): boolean;
  focus(): void;
  show(): void;
  restore(): void;
  isMinimized(): boolean;
  close(): void;
  onClosed(listener: () => void): void;
  send(channel: string, payload: unknown): void;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UnifiedWindowHost {
  createWindow(): Promise<UnifiedHostWindow>;
  createView(window: UnifiedHostWindow, machineId: string): UnifiedViewHandle;
  /** The view is now the shown one (focus routing, menus). */
  activateView(window: UnifiedHostWindow, view: UnifiedViewHandle | null): void;
  /** Connect a machine's pooled client (no machine window); rejects when it cannot. */
  connect(machineId: string): Promise<void>;
  isConnected(machineId: string): boolean;
  /** A machine view closed: release its pooled client if nothing else holds it. */
  releaseHolder(machineId: string): void;
  loadState(): Promise<UnifiedWindowState | null>;
  saveState(state: UnifiedWindowState): Promise<void>;
  isLabEnabled(): boolean;
}

export type MachineConnectionState = 'connecting' | 'connected' | 'failed';

export const UNIFIED_SHELL_CHANNELS = {
  MACHINE_STATE: 'unified:machine-state',
  OPEN_REQUEST: 'unified:open-request',
  NAVIGATE: 'unified:navigate',
  TABS: 'unified:tabs',
} as const;

export class UnifiedWindowController {
  private window: UnifiedHostWindow | null = null;
  private opening: Promise<UnifiedHostWindow> | null = null;
  private readonly views = new Map<string, UnifiedViewHandle>();
  private readonly loaded = new Set<string>();
  private activeMachineId: string | null = null;
  private contentBounds: Rect | null = null;
  private readonly failed = new Set<string>();
  /** Machines connected for this window (with or without a view yet). */
  private readonly held = new Set<string>();
  private tabsByMachine: Record<string, string[]> = {};
  /** A shell menu, dialog or palette is open: views are native layers drawn above it. */
  private overlayOpen = false;

  constructor(private readonly host: UnifiedWindowHost) {}

  isOpen(): boolean {
    return !!this.window && !this.window.isDestroyed();
  }

  /** Open the one Unified window, or focus it when it exists. */
  async openOrFocus(): Promise<{ opened: boolean }> {
    if (!this.host.isLabEnabled()) return { opened: false };
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
      return { opened: false };
    }
    if (!this.opening) {
      this.opening = this.host.createWindow().then((window) => {
        this.window = window;
        window.onClosed(() => this.handleClosed(window));
        return window;
      });
      this.opening.finally(() => {
        this.opening = null;
      });
    }
    await this.opening;
    return { opened: true };
  }

  /** Lab turned off (or app teardown): close the window; its record is kept but not restored. */
  close(): void {
    this.window?.close();
  }

  /**
   * Connect every included machine in the background, one at a time (a remote whose
   * secret is in the keychain may show the OS prompt; prompts never stack). A machine
   * that fails is not retried in the background: only an explicit pick retries it.
   */
  async connectInBackground(machineIds: string[]): Promise<void> {
    for (const machineId of machineIds) {
      if (!this.isOpen()) return;
      if (this.host.isConnected(machineId) || this.failed.has(machineId)) continue;
      await this.connect(machineId);
    }
  }

  /** User picked the machine (dropdown, or selected one of its tabs): retry even after a failure. */
  async connect(machineId: string): Promise<boolean> {
    this.pushMachineState(machineId, 'connecting');
    try {
      await this.host.connect(machineId);
      this.failed.delete(machineId);
      this.held.add(machineId);
      this.pushMachineState(machineId, 'connected');
      return true;
    } catch {
      this.failed.add(machineId);
      this.pushMachineState(machineId, 'failed');
      return false;
    }
  }

  /** Show `machineId`'s view at `route`, creating and loading it on first use. */
  show(machineId: string, route: string): boolean {
    const window = this.window;
    if (!window || window.isDestroyed()) return false;
    let view = this.views.get(machineId);
    if (!view || view.isDestroyed()) {
      view = this.host.createView(window, machineId);
      this.views.set(machineId, view);
      this.loaded.delete(machineId);
      if (this.contentBounds) view.setBounds(this.contentBounds);
    }
    if (this.loaded.has(machineId)) {
      view.navigate(route);
    } else {
      view.load(route);
      this.loaded.add(machineId);
      const tabs = this.tabsByMachine[machineId];
      if (tabs) view.send(UNIFIED_SHELL_CHANNELS.TABS, { workspaceIds: tabs });
    }
    for (const [id, other] of this.views) other.setVisible(!this.overlayOpen && id === machineId);
    this.activeMachineId = machineId;
    this.host.activateView(window, view);
    return true;
  }

  /**
   * A shell overlay (menu, dialog, palette) opened or closed. Views are native
   * layers above the shell, so while it is open they hide; the shell paints a
   * snapshot of the active view in their place so nothing visibly changes.
   */
  async setOverlay(open: boolean): Promise<string | null> {
    this.overlayOpen = open;
    const active = this.activeMachineId ? this.views.get(this.activeMachineId) : undefined;
    if (!open) {
      if (active && !active.isDestroyed()) active.setVisible(true);
      return null;
    }
    const snapshot = active && !active.isDestroyed() ? await active.capture() : null;
    // Closed again while capturing: keep the view shown.
    if (!this.overlayOpen) return null;
    for (const view of this.views.values()) if (!view.isDestroyed()) view.setVisible(false);
    return snapshot;
  }

  /** The shell shows something itself (an offline tab): no machine view is visible. */
  hideViews(): void {
    for (const view of this.views.values()) if (!view.isDestroyed()) view.setVisible(false);
    this.activeMachineId = null;
    if (this.window && !this.window.isDestroyed()) this.host.activateView(this.window, null);
  }

  setContentBounds(bounds: Rect): void {
    this.contentBounds = bounds;
    for (const view of this.views.values()) if (!view.isDestroyed()) view.setBounds(bounds);
  }

  /** The shell's tabs per machine: each view keeps its machine's tabs as hidden tab state. */
  setTabs(tabs: Record<string, string[]>): void {
    this.tabsByMachine = tabs;
    for (const [machineId, view] of this.views) {
      if (view.isDestroyed() || !this.loaded.has(machineId)) continue;
      view.send(UNIFIED_SHELL_CHANNELS.TABS, { workspaceIds: tabs[machineId] ?? [] });
    }
  }

  /** A view (or a link/notification resolved to a machine) asks to open a workspace tab. */
  requestOpen(machineId: string, workspaceId: string, route?: string): boolean {
    if (!this.window || this.window.isDestroyed()) return false;
    this.window.send(UNIFIED_SHELL_CHANNELS.OPEN_REQUEST, {
      machineId,
      workspaceId,
      ...(route ? { route } : {}),
    });
    return true;
  }

  /** The machine whose view the Unified window shows now. */
  getActiveMachineId(): string | null {
    return this.activeMachineId;
  }

  saveState(state: UnifiedWindowState): Promise<void> {
    return this.host.saveState(state);
  }

  loadState(): Promise<UnifiedWindowState | null> {
    return this.host.loadState();
  }

  private pushMachineState(machineId: string, state: MachineConnectionState): void {
    if (this.window && !this.window.isDestroyed())
      this.window.send(UNIFIED_SHELL_CHANNELS.MACHINE_STATE, { machineId, state });
  }

  private handleClosed(window: UnifiedHostWindow): void {
    if (this.window !== window) return;
    this.window = null;
    const machineIds = new Set([...this.views.keys(), ...this.held]);
    for (const view of this.views.values()) if (!view.isDestroyed()) view.destroy();
    this.views.clear();
    this.loaded.clear();
    this.activeMachineId = null;
    this.failed.clear();
    this.held.clear();
    for (const machineId of machineIds) this.host.releaseHolder(machineId);
  }
}
