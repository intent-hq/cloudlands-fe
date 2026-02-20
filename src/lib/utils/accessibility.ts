/**
 * Accessibility Utilities
 *
 * Provides utilities for improving accessibility (a11y) across the application
 */

import { logger } from './client-logger';

/**
 * Announce a message to screen readers
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite',
): void {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.style.position = 'absolute';
  announcement.style.left = '-10000px';
  announcement.style.width = '1px';
  announcement.style.height = '1px';
  announcement.style.overflow = 'hidden';
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

/**
 * Trap focus within a container (useful for modals)
 */
export class FocusTrap {
  private container: HTMLElement;
  private previousFocus: HTMLElement | null = null;
  private firstFocusable: HTMLElement | null = null;
  private lastFocusable: HTMLElement | null = null;
  private handleKeyDown: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.handleKeyDown = this.onKeyDown.bind(this);
  }

  activate(): void {
    // Store current focus
    this.previousFocus = document.activeElement as HTMLElement;

    // Find focusable elements
    const focusableElements = this.container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
        'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    if (focusableElements.length > 0) {
      this.firstFocusable = focusableElements[0];
      this.lastFocusable = focusableElements[focusableElements.length - 1];

      // Focus first element
      this.firstFocusable.focus();
    }

    // Add event listener
    document.addEventListener('keydown', this.handleKeyDown);
  }

  deactivate(): void {
    // Remove event listener
    document.removeEventListener('keydown', this.handleKeyDown);

    // Restore previous focus
    if (this.previousFocus) {
      this.previousFocus.focus();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;

    if (!this.firstFocusable || !this.lastFocusable) return;

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === this.firstFocusable) {
        e.preventDefault();
        this.lastFocusable.focus();
      }
    } else {
      // Tab
      if (document.activeElement === this.lastFocusable) {
        e.preventDefault();
        this.firstFocusable.focus();
      }
    }
  }
}

/**
 * Add ARIA labels to elements
 */
export function addAriaLabels(element: HTMLElement, labels: Record<string, string>): void {
  Object.entries(labels).forEach(([key, value]) => {
    element.setAttribute(`aria-${key}`, value);
  });
}

/**
 * Make an element keyboard navigable
 */
export function makeKeyboardNavigable(
  element: HTMLElement,
  options: {
    role?: string;
    label?: string;
    description?: string;
    onActivate?: () => void;
  } = {},
): void {
  // Set tabindex if not already set
  if (!element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '0');
  }

  // Set role if provided
  if (options.role) {
    element.setAttribute('role', options.role);
  }

  // Set aria-label if provided
  if (options.label) {
    element.setAttribute('aria-label', options.label);
  }

  // Set aria-describedby if provided
  if (options.description) {
    const descId = `desc-${Math.random().toString(36).substring(2, 11)}`;
    const descElement = document.createElement('span');
    descElement.id = descId;
    descElement.style.display = 'none';
    descElement.textContent = options.description;
    element.appendChild(descElement);
    element.setAttribute('aria-describedby', descId);
  }

  // Add keyboard activation
  if (options.onActivate) {
    element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        options.onActivate!();
      }
    });
  }
}

/**
 * Skip links for keyboard navigation
 */
export function createSkipLink(
  targetId: string,
  text: string = 'Skip to main content',
): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = `#${targetId}`;
  link.className = 'skip-link';
  link.textContent = text;

  // Style for skip link (visible only on focus)
  link.style.cssText = `
    position: absolute;
    left: -10000px;
    top: auto;
    width: 1px;
    height: 1px;
    overflow: hidden;
  `;

  // Make visible on focus
  link.addEventListener('focus', () => {
    link.style.cssText = `
      position: absolute;
      left: 10px;
      top: 10px;
      width: auto;
      height: auto;
      overflow: visible;
      z-index: 10000;
      padding: 8px 16px;
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      border: 2px solid var(--color-border-focus);
      border-radius: 4px;
      text-decoration: none;
    `;
  });

  link.addEventListener('blur', () => {
    link.style.cssText = `
      position: absolute;
      left: -10000px;
      top: auto;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
  });

  return link;
}

/**
 * Check color contrast ratio
 */
export function checkColorContrast(
  foreground: string,
  background: string,
): { ratio: number; passes: { aa: boolean; aaa: boolean } } {
  // Convert hex to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
      : null;
  };

  // Calculate relative luminance
  const getLuminance = (rgb: { r: number; g: number; b: number }) => {
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((val) => {
      val = val / 255;
      return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);

  if (!fgRgb || !bgRgb) {
    logger.warn('Invalid color values for contrast check', { foreground, background });
    return { ratio: 0, passes: { aa: false, aaa: false } };
  }

  const fgLuminance = getLuminance(fgRgb);
  const bgLuminance = getLuminance(bgRgb);

  const ratio =
    (Math.max(fgLuminance, bgLuminance) + 0.05) / (Math.min(fgLuminance, bgLuminance) + 0.05);

  return {
    ratio,
    passes: {
      aa: ratio >= 4.5, // WCAG AA standard
      aaa: ratio >= 7, // WCAG AAA standard
    },
  };
}

/**
 * Add keyboard shortcuts with proper ARIA announcements
 */
export class KeyboardShortcuts {
  private shortcuts: Map<string, { handler: () => void; description: string }> = new Map();
  private handleKeyDown: (e: KeyboardEvent) => void;

  constructor() {
    this.handleKeyDown = this.onKeyDown.bind(this);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  add(key: string, handler: () => void, description: string): void {
    this.shortcuts.set(key.toLowerCase(), { handler, description });
  }

  remove(key: string): void {
    this.shortcuts.delete(key.toLowerCase());
  }

  private onKeyDown(e: KeyboardEvent): void {
    const key = this.getKeyString(e);
    const shortcut = this.shortcuts.get(key);

    if (shortcut) {
      e.preventDefault();
      shortcut.handler();
      announceToScreenReader(`Activated: ${shortcut.description}`);
    }
  }

  private getKeyString(e: KeyboardEvent): string {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('meta');
    parts.push(e.key.toLowerCase());
    return parts.join('+');
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    this.shortcuts.clear();
  }
}

/**
 * Initialize accessibility features
 */
export function initializeAccessibility(): void {
  // Add skip links
  const skipLink = createSkipLink('main-content', 'Skip to main content');
  document.body.insertBefore(skipLink, document.body.firstChild);

  // Set up live region for announcements
  const liveRegion = document.createElement('div');
  liveRegion.id = 'live-region';
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.style.position = 'absolute';
  liveRegion.style.left = '-10000px';
  document.body.appendChild(liveRegion);

  logger.info('Accessibility features initialized');
}
