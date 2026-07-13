/**
 * Hook for responsive comment behavior
 *
 * Automatically adjusts comment display based on available space
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('useResponsiveComments');

export interface ResponsiveConfig {
  iconModeThreshold?: number; // Width below which to show icon mode
  compactModeThreshold?: number; // Width below which to show compact mode
  enableAnimations?: boolean;
  enableOverlapDetection?: boolean;
}

const DEFAULT_CONFIG: Required<ResponsiveConfig> = {
  iconModeThreshold: 200,
  compactModeThreshold: 320,
  enableAnimations: true,
  enableOverlapDetection: true,
};

export class ResponsiveCommentsController {
  private config: Required<ResponsiveConfig>;
  private containerWidth: number = $state(400);
  private displayMode: 'full' | 'compact' | 'icon' = $state('full');
  private isTransitioning: boolean = $state(false);

  constructor(config: ResponsiveConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update container width and calculate display mode
   */
  updateWidth(width: number) {
    const previousMode = this.displayMode;
    this.containerWidth = width;

    // Calculate new display mode
    if (width < this.config.iconModeThreshold) {
      this.displayMode = 'icon';
    } else if (width < this.config.compactModeThreshold) {
      this.displayMode = 'compact';
    } else {
      this.displayMode = 'full';
    }

    // Handle mode transition
    if (previousMode !== this.displayMode && this.config.enableAnimations) {
      this.isTransitioning = true;
      setTimeout(() => {
        this.isTransitioning = false;
      }, 300);
    }

    logger.debug('Display mode updated', {
      width,
      mode: this.displayMode,
      previousMode,
    });
  }

  /**
   * Get current display mode
   */
  getDisplayMode(): 'full' | 'compact' | 'icon' {
    return this.displayMode;
  }

  /**
   * Check if currently transitioning between modes
   */
  getIsTransitioning(): boolean {
    return this.isTransitioning;
  }

  /**
   * Get responsive classes for comment container
   */
  getContainerClasses(): string {
    const classes = [`comment-mode-${this.displayMode}`];

    if (this.isTransitioning) {
      classes.push('comment-transitioning');
    }

    if (this.config.enableOverlapDetection) {
      classes.push('overlap-detection-enabled');
    }

    return classes.join(' ');
  }

  /**
   * Calculate optimal comment width based on container
   */
  getOptimalCommentWidth(): number {
    const padding = 40; // Space for margins

    if (this.displayMode === 'icon') {
      return 32; // Fixed icon size
    } else if (this.displayMode === 'compact') {
      return Math.min(this.containerWidth - padding, 240);
    } else {
      return Math.min(this.containerWidth - padding, 320);
    }
  }

  /**
   * Check if comments should stack vertically
   */
  shouldStackVertically(): boolean {
    return this.containerWidth < 480;
  }

  /**
   * Get animation duration based on mode transition
   */
  getAnimationDuration(fromMode?: string, toMode?: string): number {
    if (!this.config.enableAnimations) return 0;

    // Same mode = no animation
    if (fromMode === toMode) return 0;

    // Adjacent mode transitions = shorter
    if (
      (fromMode === 'full' && toMode === 'compact') ||
      (fromMode === 'compact' && toMode === 'full')
    ) {
      return 200;
    }

    // Icon transitions are also shorter
    if (
      (fromMode === 'compact' && toMode === 'icon') ||
      (fromMode === 'icon' && toMode === 'compact')
    ) {
      return 150;
    }

    // Full to/from icon = longer
    if ((fromMode === 'icon' && toMode === 'full') || (fromMode === 'full' && toMode === 'icon')) {
      return 300;
    }

    return 200;
  }
}

/**
 * Create a responsive comments controller
 */
export function createResponsiveController(config?: ResponsiveConfig) {
  return new ResponsiveCommentsController(config);
}
