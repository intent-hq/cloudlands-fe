/**
 * Utility functions for playing notification sounds
 *
 * This module handles browser autoplay restrictions gracefully by:
 * 1. Attempting to play the notification sound
 * 2. Silently failing if audio cannot be played due to browser policies
 * 3. Providing a simple, focused API for notification sounds
 *
 * Usage:
 * - Use `playNotificationSound(volume)` to play the notification sound
 * - The function returns a Promise that resolves when playback completes or fails
 */

import agentCompleteSound from '../../assets/sounds/agent-complete.mp3?url';

/**
 * Extended HTMLAudioElement with unlock state
 */
interface AudioElementWithState extends HTMLAudioElement {
  _isUnlocked?: boolean;
}

/**
 * Singleton class for managing notification sounds
 */
class NotificationSoundManager {
  private static _instance: NotificationSoundManager;
  private audioElement: AudioElementWithState | null = null;

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): NotificationSoundManager {
    if (!NotificationSoundManager._instance) {
      NotificationSoundManager._instance = new NotificationSoundManager();
    }
    return NotificationSoundManager._instance;
  }

  /**
   * Get or create the audio element
   */
  private getAudioElement(): AudioElementWithState {
    if (!this.audioElement) {
      this.audioElement = new Audio() as AudioElementWithState;
      this.audioElement.src = agentCompleteSound;
      this.audioElement.preload = 'auto';
      this.audioElement._isUnlocked = false;
    }
    return this.audioElement;
  }

  /**
   * Play the notification sound with the specified volume
   * Gracefully handles browser autoplay restrictions by silently failing
   *
   * @param volume - Volume level (0.0 to 1.0)
   * @returns Promise that resolves when playback completes or fails
   */
  public async playNotificationSound(volume: number): Promise<void> {
    try {
      const audio = this.getAudioElement();

      // Clamp volume to valid range
      audio.volume = Math.max(0, Math.min(1, volume));

      // Reset the audio to the beginning in case it was played before
      audio.currentTime = 0;

      // Attempt to play the sound
      await audio.play();
    } catch (error) {
      // Silently fail if audio cannot be played due to browser autoplay restrictions
      // This is expected behavior - the browser requires user interaction to play audio
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        // Browser autoplay policy prevents playback - this is normal
        return;
      }

      // For other errors, also silently fail to avoid disrupting the application
      // Log only in development if needed
      if (typeof window !== 'undefined' && (window as any).__DEV__) {
        console.debug('Failed to play notification sound:', error);
      }
    }
  }

  /**
   * Dispose of the audio element and cleanup resources
   */
  public dispose(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement._isUnlocked = false;
      this.audioElement = null;
    }
  }
}

/**
 * Get the singleton instance of NotificationSoundManager
 */
const notificationSoundManager = NotificationSoundManager.getInstance();

/**
 * Play a notification sound with the specified volume
 * Handles browser autoplay restrictions gracefully (silent fail)
 *
 * @param volume - Volume level (0.0 to 1.0), defaults to 0.5
 * @returns Promise that resolves when playback completes or fails
 */
export async function playNotificationSound(volume: number = 0.5): Promise<void> {
  return notificationSoundManager.playNotificationSound(volume);
}

/**
 * Dispose of notification sound resources
 * Call this when cleaning up to release audio resources
 */
export function disposeNotificationSound(): void {
  notificationSoundManager.dispose();
}

/**
 * Export the singleton instance for advanced use cases
 */
export { notificationSoundManager };
