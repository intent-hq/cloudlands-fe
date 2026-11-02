export type DockMenuWindow = {
  on(event: 'closed', listener: () => void): unknown;
};

export type DockMenuControllerDependencies = {
  createWindow(): DockMenuWindow;
  getWindow(): DockMenuWindow | null;
  closeWindow(): void;
  focusWindow(): void;
  readEnabledPreference(): Promise<boolean>;
  writeEnabledPreference(enabled: boolean): Promise<void>;
  onStateChange(): void;
};

export function createDockMenuController(deps: DockMenuControllerDependencies) {
  const trackedWindows = new WeakSet<DockMenuWindow>();
  const controllerClosures = new WeakSet<DockMenuWindow>();

  const trackWindow = (window: DockMenuWindow): void => {
    if (trackedWindows.has(window)) return;
    trackedWindows.add(window);
    window.on('closed', () => {
      const preferenceWrite = controllerClosures.delete(window)
        ? Promise.resolve()
        : deps.writeEnabledPreference(false);
      void preferenceWrite.finally(deps.onStateChange);
    });
  };

  return {
    isEnabled: (): boolean => deps.getWindow() !== null,
    focus: (): boolean => {
      if (!deps.getWindow()) return false;
      deps.focusWindow();
      return true;
    },
    setEnabled: async (enabled: boolean): Promise<void> => {
      if (enabled) {
        trackWindow(deps.createWindow());
        await deps.writeEnabledPreference(true);
      } else {
        const window = deps.getWindow();
        if (window) {
          trackWindow(window);
          controllerClosures.add(window);
        }
        await deps.writeEnabledPreference(false);
        if (window) {
          deps.closeWindow();
          return;
        }
      }
      deps.onStateChange();
    },
    /** Closes the dock without recording a user hide, so a later restore shows it again. */
    dismiss: (): void => {
      const window = deps.getWindow();
      if (!window) {
        deps.onStateChange();
        return;
      }
      trackWindow(window);
      controllerClosures.add(window);
      deps.closeWindow();
    },
    restore: async (): Promise<boolean> => {
      try {
        if (!(await deps.readEnabledPreference())) return false;
      } catch {
        // A preference read failure must not hide the default-visible dock.
      }
      trackWindow(deps.createWindow());
      return true;
    },
  };
}
