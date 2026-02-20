/**
 * Bottom Dock Manager
 *
 * Manages state for the bottom dock/drawer system including:
 * - Expanded/collapsed state
 * - Active terminal selection
 * - Agent Kanban view state
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('BottomDockManager');

export type DockViewMode = 'agents' | 'terminal';

export interface BottomDockState {
  isExpanded: boolean;
  viewMode: DockViewMode;
  activeTerminalId: string | null;
  height: number; // Height of the drawer in pixels
  version: number;
}

class BottomDockManagerClass {
  private state = $state<BottomDockState>({
    isExpanded: false,
    viewMode: 'agents',
    activeTerminalId: null,
    height: 400, // Default height
    version: 0,
  });

  private readonly STORAGE_KEY = 'bottom-dock-state';
  private readonly MIN_HEIGHT = 200;
  private readonly MAX_HEIGHT = 800;

  constructor() {
    this.loadState();
  }

  // Getters
  get isExpanded() {
    return this.state.isExpanded;
  }

  get viewMode() {
    return this.state.viewMode;
  }

  get activeTerminalId() {
    return this.state.activeTerminalId;
  }

  get height() {
    return this.state.height;
  }

  // Actions
  toggle() {
    this.state.isExpanded = !this.state.isExpanded;
    this.state.version++;
    this.saveState();
    logger.debug('Toggled dock', { isExpanded: this.state.isExpanded });
  }

  expand() {
    if (!this.state.isExpanded) {
      this.state.isExpanded = true;
      this.state.version++;
      this.saveState();
      logger.debug('Expanded dock');
    }
  }

  collapse() {
    if (this.state.isExpanded) {
      this.state.isExpanded = false;
      this.state.version++;
      this.saveState();
      logger.debug('Collapsed dock');
    }
  }

  setViewMode(mode: DockViewMode) {
    this.state.viewMode = mode;
    this.state.version++;
    this.saveState();
    logger.debug('Set view mode', { mode });
  }

  selectTerminal(terminalId: string) {
    this.state.activeTerminalId = terminalId;
    this.state.viewMode = 'terminal';
    this.expand();
    this.state.version++;
    this.saveState();
    logger.debug('Selected terminal', { terminalId });
  }

  showAgents() {
    this.state.viewMode = 'agents';
    this.expand();
    this.state.version++;
    this.saveState();
    logger.debug('Showing agents');
  }

  setHeight(height: number) {
    // Clamp height between min and max
    const clampedHeight = Math.max(this.MIN_HEIGHT, Math.min(this.MAX_HEIGHT, height));
    this.state.height = clampedHeight;
    this.state.version++;
    this.saveState();
    logger.debug('Set height', { height: clampedHeight });
  }

  // Persistence
  private saveState() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        isExpanded: this.state.isExpanded,
        viewMode: this.state.viewMode,
        activeTerminalId: this.state.activeTerminalId,
        height: this.state.height,
      }));
    } catch (error) {
      logger.error('Failed to save dock state', error);
    }
  }

  private loadState() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Always start collapsed - don't restore isExpanded state
        this.state.isExpanded = false;
        this.state.viewMode = parsed.viewMode ?? 'agents';
        this.state.activeTerminalId = parsed.activeTerminalId ?? null;
        this.state.height = parsed.height ?? 400;
      }
    } catch (error) {
      logger.error('Failed to load dock state', error);
    }
  }
}

// Singleton instance
export const bottomDockManager = new BottomDockManagerClass();
