/**
 * Accessibility Utilities
 *
 * Provides utilities for improving accessibility (a11y) across the application
 */

import { logger } from './client-logger';

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
  const onActivate = options.onActivate;
  if (onActivate) {
    element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    });
  }
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
