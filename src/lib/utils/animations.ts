/**
 * Animation utilities and configurations
 */

import { debugConfig } from '$lib/config/debug';
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import type { FlyParams, SlideParams, ScaleParams } from 'svelte/transition';

/**
 * Get animation duration from debug config
 */
export function getAnimationDuration(): number {
  return debugConfig.get('animationDuration') || 300;
}

/**
 * Check if animations are enabled
 */
export function areAnimationsEnabled(): boolean {
  return debugConfig.get('enableComponentTransitions');
}

/**
 * Standard fade transition with debug config
 */
export function fadeConfig(delay = 0): TransitionConfig {
  if (!areAnimationsEnabled()) {
    return { duration: 0 };
  }

  return {
    delay,
    duration: getAnimationDuration(),
  };
}

/**
 * Standard fly transition with debug config
 */
export function flyConfig(y = 20, delay = 0): FlyParams {
  if (!areAnimationsEnabled()) {
    return { duration: 0 };
  }

  return {
    delay,
    duration: getAnimationDuration(),
    y,
    easing: cubicOut,
  };
}

/**
 * Standard slide transition with debug config
 */
export function slideConfig(axis: 'x' | 'y' = 'y', delay = 0): SlideParams {
  if (!areAnimationsEnabled()) {
    return { duration: 0 };
  }

  return {
    delay,
    duration: getAnimationDuration(),
    axis,
    easing: cubicOut,
  };
}

/**
 * Scale transition with debug config
 */
export function scaleConfig(start = 0.95, delay = 0): ScaleParams {
  if (!areAnimationsEnabled()) {
    return { duration: 0 };
  }

  return {
    delay,
    duration: getAnimationDuration(),
    start,
    easing: cubicOut,
  };
}

/**
 * Stagger animation helper for lists
 */
export function staggerConfig(index: number, baseDelay = 0, staggerDelay = 50): FlyParams {
  if (!areAnimationsEnabled()) {
    return { duration: 0 };
  }

  return {
    delay: baseDelay + index * staggerDelay,
    duration: getAnimationDuration(),
    y: 10,
    easing: cubicOut,
  };
}

/**
 * Page transition configuration
 */
export function pageTransitionConfig(): FlyParams {
  if (!debugConfig.get('enablePageTransitions')) {
    return { duration: 0 };
  }

  return {
    duration: getAnimationDuration(),
    y: 20,
    easing: cubicOut,
  };
}

/**
 * Creation animation configuration
 */
export function creationAnimationConfig(): FlyParams {
  if (!debugConfig.get('enableCreationAnimation')) {
    return { duration: 0 };
  }

  return {
    duration: getAnimationDuration() * 2, // Longer for creation
    y: 30,
    easing: cubicOut,
  };
}

/**
 * CSS animation classes based on debug config
 */
export function getAnimationClasses(type: 'fade' | 'slide' | 'scale' | 'bounce' = 'fade'): string {
  if (!areAnimationsEnabled()) {
    return '';
  }

  const duration = getAnimationDuration();
  const durationClass =
    duration <= 200
      ? 'duration-200'
      : duration <= 300
        ? 'duration-300'
        : duration <= 500
          ? 'duration-500'
          : 'duration-700';

  const baseClasses = `transition-all ${durationClass} ease-out`;

  switch (type) {
    case 'fade':
      return `${baseClasses} opacity-0 animate-fadeIn`;
    case 'slide':
      return `${baseClasses} translate-y-4 animate-slideUp`;
    case 'scale':
      return `${baseClasses} scale-95 animate-scaleIn`;
    case 'bounce':
      return `${baseClasses} animate-bounce`;
    default:
      return baseClasses;
  }
}
