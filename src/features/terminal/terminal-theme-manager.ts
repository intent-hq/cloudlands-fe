/**
 * Terminal Theme Manager
 *
 * Manages terminal color schemes with smooth transitions
 * and proper dark/light mode support
 */

import type { ITheme } from '@xterm/xterm';
import { Logger } from '../../shared/logger';
import { themeManager } from '$lib/utils/theme';
import { dispatchWindowEvent } from '$lib/utils/window-events';

const logger = new Logger('TerminalThemeManager');

export interface TerminalTheme extends ITheme {
  name: string;
  isDark: boolean;
}

export class TerminalThemeManager {
  private static readonly TRANSITION_DURATION = 200; // ms

  // Sleek dark theme with better contrast
  private static readonly DARK_THEME: TerminalTheme = {
    name: 'sleek-dark',
    isDark: true,
    background: '#0B0B0E',
    foreground: '#e4e4e7',
    cursor: '#fbbf24',
    cursorAccent: '#1a1a1a',
    selectionBackground: '#3f3f46',
    selectionForeground: '#F7F7F7',
    selectionInactiveBackground: '#27272a',

    // ANSI colors - more vibrant but balanced
    black: '#18181b',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#d4d4d8',

    // Bright ANSI colors
    brightBlack: '#52525b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#f4f4f5',
  };

  // Sleek light theme with soft colors
  private static readonly LIGHT_THEME: TerminalTheme = {
    name: 'sleek-light',
    isDark: false,
    background: '#F7F7F8',
    foreground: '#18181b',
    cursor: '#f59e0b',
    cursorAccent: '#F7F7F7',
    selectionBackground: '#e4e4e7',
    selectionForeground: '#09090b',
    selectionInactiveBackground: '#f4f4f5',

    // ANSI colors - adjusted for light background
    black: '#18181b',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#e4e4e7',

    // Bright ANSI colors
    brightBlack: '#71717a',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#eab308',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#F7F7F7',
  };

  private currentTheme: TerminalTheme;
  private customTerminalTheme: TerminalTheme | null = null;
  private themeObserver: MutationObserver | null = null;
  private transitionTimeout: NodeJS.Timeout | null = null;
  private darkModeQuery: MediaQueryList | null = null;
  private darkModeChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;
  private themeChangeHandler: ((e: Event) => void) | null = null;

  constructor(private container?: HTMLElement) {
    this.currentTheme = this.detectSystemTheme();
    this.setupThemeObserver();
  }

  /**
   * Get current theme
   */
  getCurrentTheme(): TerminalTheme {
    return this.currentTheme;
  }

  /**
   * Apply theme with smooth transition
   */
  applyTheme(xterm: any, theme?: TerminalTheme): void {
    const targetTheme = theme || this.detectSystemTheme();

    // Skip if same theme
    if (targetTheme.name === this.currentTheme.name) {
      return;
    }

    try {
      // Add transition class to container
      if (this.container) {
        this.container.style.transition = `background-color ${TerminalThemeManager.TRANSITION_DURATION}ms ease`;
      }

      // Apply theme to XTerm
      xterm.options.theme = targetTheme;

      // Update container background
      if (this.container) {
        this.container.style.backgroundColor = targetTheme.background || 'transparent';
      }

      // Force refresh
      xterm.refresh(0, xterm.rows - 1);

      this.currentTheme = targetTheme;
      logger.debug(`Applied theme: ${targetTheme.name}`);

      // Remove transition after animation
      if (this.transitionTimeout) {
        clearTimeout(this.transitionTimeout);
      }

      this.transitionTimeout = setTimeout(() => {
        if (this.container) {
          this.container.style.transition = '';
        }
      }, TerminalThemeManager.TRANSITION_DURATION);
    } catch (error) {
      logger.error('Failed to apply theme:', error);
    }
  }

  /**
   * Detect system theme preference
   */
  private detectSystemTheme(): TerminalTheme {
    // If a custom terminal theme is active, use it
    if (this.customTerminalTheme) {
      return this.customTerminalTheme;
    }

    // Check for class-based theming (primary method used by the app)
    const isDarkClass = document.documentElement.classList.contains('dark');
    const isLightClass = document.documentElement.classList.contains('light');

    if (isDarkClass) {
      return TerminalThemeManager.DARK_THEME;
    } else if (isLightClass) {
      return TerminalThemeManager.LIGHT_THEME;
    }

    // Check for data-theme attribute (fallback)
    const htmlTheme = document.documentElement.getAttribute('data-theme');
    if (htmlTheme === 'dark') {
      return TerminalThemeManager.DARK_THEME;
    } else if (htmlTheme === 'light') {
      return TerminalThemeManager.LIGHT_THEME;
    }

    // Check CSS variable
    const rootStyles = getComputedStyle(document.documentElement);
    const bgColor = rootStyles.getPropertyValue('--background').trim();

    // Simple heuristic: if background is dark, use dark theme
    if (bgColor && this.isColorDark(bgColor)) {
      return TerminalThemeManager.DARK_THEME;
    }

    // Use ThemeManager as primary source of truth
    if (themeManager.isDark()) {
      return TerminalThemeManager.DARK_THEME;
    }

    return TerminalThemeManager.LIGHT_THEME;
  }

  /**
   * Check if a color is dark
   */
  private isColorDark(color: string): boolean {
    // Convert color to RGB
    const rgb = this.colorToRgb(color);
    if (!rgb) return false;

    // Calculate luminance
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance < 0.5;
  }

  /**
   * Convert color string to RGB
   */
  private colorToRgb(color: string): { r: number; g: number; b: number } | null {
    // Handle hex colors
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
        };
      } else if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        };
      }
    }

    // Handle rgb() colors
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3]),
      };
    }

    return null;
  }

  /**
   * Setup theme observer for automatic updates
   */
  private setupThemeObserver(): void {
    if (typeof window === 'undefined') return;

    // Observe changes to class and data-theme attributes
    this.themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;

          // Check for class or data-theme changes
          if (attrName === 'class' || attrName === 'data-theme') {
            const newTheme = this.detectSystemTheme();

            // Only update if theme actually changed
            if (newTheme.name !== this.currentTheme.name) {
              logger.debug(`Theme change detected: ${this.currentTheme.name} -> ${newTheme.name}`);
              // Don't update currentTheme here - let applyTheme do it
              // so the check in applyTheme doesn't skip the update

              // Emit custom event for components to react
              dispatchWindowEvent('terminal-theme-changed', { theme: newTheme });
            }
          }
        }
      }
    });

    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    // Listen for media query changes
    this.darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.darkModeChangeHandler = () => {
      logger.debug('System theme preference changed');
      const newTheme = this.detectSystemTheme();

      if (newTheme.name !== this.currentTheme.name) {
        // Don't update currentTheme here - let applyTheme do it
        // so the check in applyTheme doesn't skip the update

        // Emit custom event
        dispatchWindowEvent('terminal-theme-changed', { theme: newTheme });
      }
    };
    this.darkModeQuery.addEventListener('change', this.darkModeChangeHandler);

    // Listen for custom theme-changed event from the app
    this.themeChangeHandler = (event: any) => {
      const isDark = event.detail?.isDark;
      const terminalColors = event.detail?.terminalColors;

      let newTheme: TerminalTheme;

      if (terminalColors && Object.keys(terminalColors).length > 0) {
        // Custom VS Code theme provides terminal colors
        const baseTheme = isDark ? TerminalThemeManager.DARK_THEME : TerminalThemeManager.LIGHT_THEME;
        newTheme = {
          ...baseTheme,
          ...terminalColors,
          name: 'custom',
          isDark,
        };
        this.customTerminalTheme = newTheme;
      } else {
        // No custom theme — revert to base
        this.customTerminalTheme = null;
        newTheme = isDark ? TerminalThemeManager.DARK_THEME : TerminalThemeManager.LIGHT_THEME;
      }

      if (newTheme.name !== this.currentTheme.name || terminalColors) {
        logger.debug(`App theme changed to ${newTheme.name}`);
        // Don't update currentTheme here - let applyTheme do it
        // so the check in applyTheme doesn't skip the update

        // Emit terminal-specific event
        dispatchWindowEvent('terminal-theme-changed', { theme: newTheme });
      }
    };
    window.addEventListener('theme-changed', this.themeChangeHandler);
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }

    if (this.darkModeQuery && this.darkModeChangeHandler) {
      this.darkModeQuery.removeEventListener('change', this.darkModeChangeHandler);
      this.darkModeQuery = null;
      this.darkModeChangeHandler = null;
    }

    if (this.themeChangeHandler) {
      window.removeEventListener('theme-changed', this.themeChangeHandler);
      this.themeChangeHandler = null;
    }

    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = null;
    }
  }
}
