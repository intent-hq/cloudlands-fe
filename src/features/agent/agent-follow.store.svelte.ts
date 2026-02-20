/**
 * Agent Follow Store
 *
 * Manages the state for following agents in the workspace.
 * Tracks which agent is being followed and handles file opening/animation.
 */

import type { AgentSession } from '$shared/types';
import { getAvatarColors } from '$lib/components/ui/auggie-avatar/avatar-constants';

import { Logger } from '$lib/utils/logger';
const logger = new Logger({ category: 'AgentFollowStore' });

interface AgentFollowState {
  isFollowing: boolean;
  followedAgentId: string | null;
  followedAgent: AgentSession | null;
  agentColor: { start: string; end: string; gradient: string } | null;
  currentFile: string | null;
  currentNoteId: string | null;
  isAnimating: boolean;
  pendingChanges: PendingChange[];
}

interface PendingChange {
  file: string;
  content: string;
  isAddition: boolean;
  timestamp: number;
}

class AgentFollowStore {
  // State
  #state = $state<AgentFollowState>({
    isFollowing: false,
    followedAgentId: null,
    followedAgent: null,
    agentColor: null,
    currentFile: null,
    currentNoteId: null,
    isAnimating: false,
    pendingChanges: [],
  });

  // Animation settings
  #typingSpeed = 30; // ms per character
  #animationQueue: Array<() => Promise<void>> = [];
  #isProcessingQueue = false;

  // Expose a read-only view of the animation queue for UI components
  get animationQueue() {
    return this.#animationQueue;
  }

  // Pause state
  #isPaused = $state(false);
  #pausedByUser = false;
  #pauseTimeout?: NodeJS.Timeout;

  // Getters
  get isFollowing() {
    return this.#state.isFollowing;
  }

  get followedAgentId() {
    return this.#state.followedAgentId;
  }

  get followedAgent() {
    return this.#state.followedAgent;
  }

  get agentColor() {
    return this.#state.agentColor;
  }

  get currentFile() {
    return this.#state.currentFile;
  }

  get isPaused() {
    return this.#isPaused;
  }

  get isAnimating() {
    return this.#state.isAnimating;
  }

  get focusRingStyle() {
    if (!this.#state.isFollowing || !this.#state.agentColor) {
      return '';
    }
    // Create a focus ring using the avatar colors
    const color = this.#state.agentColor;
    return `box-shadow: 0 0 0 3px ${color.start}40, 0 0 0 1px ${color.start}`;
  }

  /**
   * Start following an agent
   */
  startFollowing(agent: AgentSession) {
    try {
      // Stop any existing following first
      if (this.#state.isFollowing) {
        this.stopFollowing();
      }

      this.#state.isFollowing = true;
      this.#state.followedAgentId = agent.id;
      this.#state.followedAgent = agent;
      this.#state.agentColor = getAvatarColors(agent.id);

      // Set up error recovery
      this.#setupErrorRecovery();

      // Emit event for UI updates
      this.#emitFollowEvent('start', agent);
    } catch (error) {
      logger.error(
        '[AgentFollowStore] Error starting follow:',
        error instanceof Error ? error : undefined,
        error instanceof Error ? undefined : { error },
      );
      this.stopFollowing();
    }
  }

  /**
   * Set up error recovery mechanisms
   */
  #setupErrorRecovery() {
    // Monitor animation queue health
    if (!this.#recoveryInterval) {
      this.#recoveryInterval = setInterval(() => {
        // Clear stale animations if queue gets too large
        if (this.#animationQueue.length > 20) {
          logger.warn('[AgentFollowStore] Animation queue overflow, clearing old animations');
          this.#animationQueue = this.#animationQueue.slice(-10);
        }
      }, 5000);
    }
  }

  #recoveryInterval?: NodeJS.Timeout;

  /**
   * Stop following the current agent
   */
  stopFollowing() {
    const agent = this.#state.followedAgent;

    // Clear recovery mechanisms
    if (this.#recoveryInterval) {
      clearInterval(this.#recoveryInterval);
      this.#recoveryInterval = undefined;
    }

    // Clear animation queue
    this.#animationQueue = [];
    this.#state.pendingChanges = [];

    this.#state.isFollowing = false;
    this.#state.followedAgentId = null;
    this.#state.followedAgent = null;
    this.#state.agentColor = null;
    this.#state.currentFile = null;
    this.#state.pendingChanges = [];

    // Clear animation queue
    this.#animationQueue = [];
    this.#state.isAnimating = false;

    if (agent) {
      this.#emitFollowEvent('stop', agent);
    }
  }

  /**
   * Toggle following for an agent
   */
  toggleFollowing(agent?: AgentSession) {
    if (this.#state.isFollowing) {
      this.stopFollowing();
    } else if (agent) {
      this.startFollowing(agent);
    }
  }

  /**
   * Pause following (animations continue to queue)
   */
  pauseFollowing(userInitiated = false) {
    this.#isPaused = true;
    this.#pausedByUser = userInitiated;

    // Clear auto-resume timeout if paused by user
    if (userInitiated && this.#pauseTimeout) {
      clearTimeout(this.#pauseTimeout);
      this.#pauseTimeout = undefined;
    }

    this.#emitFollowEvent('pause', this.#state.followedAgent);
  }

  /**
   * Resume following
   */
  resumeFollowing() {
    this.#isPaused = false;
    this.#pausedByUser = false;

    // Clear any pending timeout
    if (this.#pauseTimeout) {
      clearTimeout(this.#pauseTimeout);
      this.#pauseTimeout = undefined;
    }

    // Resume processing queue
    if (!this.#isProcessingQueue && this.#animationQueue.length > 0) {
      this.#processAnimationQueue();
    }

    this.#emitFollowEvent('resume', this.#state.followedAgent);
  }

  /**
   * Auto-pause on user interaction
   */
  handleUserInteraction() {
    if (!this.#isPaused && this.#state.isFollowing) {
      this.pauseFollowing(false);

      // Auto-resume after delay
      this.#pauseTimeout = setTimeout(() => {
        if (!this.#pausedByUser) {
          this.resumeFollowing();
        }
      }, 3000); // Resume after 3 seconds of inactivity
    }
  }

  /**
   * Update the current file being edited
   */
  setCurrentFile(file: string) {
    if (this.#state.currentFile !== file) {
      logger.debug('[AgentFollowStore] Setting current file:', {
        oldFile: this.#state.currentFile,
        newFile: file,
        isFollowing: this.#state.isFollowing,
        agentId: this.#state.followedAgentId,
      });
      this.#state.currentFile = file;
      this.#state.currentNoteId = null; // Clear note when switching to file
      this.#emitFileChangeEvent(file);
    }
  }

  /**
   * Update the current note being edited
   */
  setCurrentNote(noteId: string) {
    if (this.#state.currentNoteId !== noteId) {
      logger.debug('[AgentFollowStore] Setting current note:', {
        oldNote: this.#state.currentNoteId,
        newNote: noteId,
        isFollowing: this.#state.isFollowing,
        agentId: this.#state.followedAgentId,
      });
      this.#state.currentNoteId = noteId;
      this.#state.currentFile = null; // Clear file when switching to note
      this.#emitNoteChangeEvent(noteId);
    }
  }

  /**
   * Queue a text change animation
   */
  queueTextAnimation(file: string, content: string, isAddition: boolean) {
    if (!this.#state.isFollowing) return;

    this.#state.pendingChanges.push({
      file,
      content,
      isAddition,
      timestamp: Date.now(),
    });

    // Add to animation queue
    this.#animationQueue.push(async () => {
      await this.#animateTextChange(file, content, isAddition);
    });

    // Process queue if not already processing
    if (!this.#isProcessingQueue) {
      this.#processAnimationQueue();
    }
  }

  /**
   * Process the animation queue
   */
  async #processAnimationQueue() {
    if (this.#isProcessingQueue || this.#animationQueue.length === 0) {
      return;
    }

    this.#isProcessingQueue = true;
    this.#state.isAnimating = true;

    while (this.#animationQueue.length > 0 && this.#state.isFollowing) {
      // Wait if paused
      while (this.#isPaused && this.#state.isFollowing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const animation = this.#animationQueue.shift();
      if (animation) {
        await animation();
      }
    }

    this.#state.isAnimating = false;
    this.#isProcessingQueue = false;
  }

  /**
   * Animate a text change
   */
  async #animateTextChange(file: string, content: string, isAddition: boolean) {
    // Ensure we're on the right file
    if (this.#state.currentFile !== file) {
      this.setCurrentFile(file);
      // Wait a bit for file to open
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Emit animation event for the editor to handle
    this.#emitAnimationEvent({
      file,
      content,
      isAddition,
      speed: this.#typingSpeed,
    });

    // Wait for animation to complete (approximate)
    const animationDuration = content.length * this.#typingSpeed;
    await new Promise((resolve) => setTimeout(resolve, animationDuration));
  }

  /**
   * Emit a follow event
   */
  #emitFollowEvent(type: 'start' | 'stop' | 'pause' | 'resume', agent: AgentSession | null) {
    window.dispatchEvent(
      new CustomEvent('agent-follow', {
        detail: { type, agent, color: this.#state.agentColor },
      }),
    );
  }

  /**
   * Emit a file change event
   */
  #emitFileChangeEvent(file: string) {
    logger.debug('[AgentFollowStore] Emitting agent-follow-file event:', {
      file,
      agentId: this.#state.followedAgentId,
    });
    window.dispatchEvent(
      new CustomEvent('agent-follow-file', {
        detail: { file, agentId: this.#state.followedAgentId },
      }),
    );
  }

  /**
   * Emit a note change event
   */
  #emitNoteChangeEvent(noteId: string) {
    logger.debug('[AgentFollowStore] Emitting agent-follow-note event:', {
      noteId,
      agentId: this.#state.followedAgentId,
    });
    window.dispatchEvent(
      new CustomEvent('agent-follow-note', {
        detail: { noteId, agentId: this.#state.followedAgentId },
      }),
    );
  }

  /**
   * Emit an animation event
   */
  #emitAnimationEvent(details: any) {
    window.dispatchEvent(
      new CustomEvent('agent-follow-animation', {
        detail: details,
      }),
    );
  }

  /**
   * Check if a specific agent is being followed
   */
  isFollowingAgent(agentId: string): boolean {
    return this.#state.isFollowing && this.#state.followedAgentId === agentId;
  }

  /**
   * Get the typing speed setting
   */
  get typingSpeed() {
    return this.#typingSpeed;
  }

  /**
   * Set the typing speed (ms per character)
   */
  setTypingSpeed(speed: number) {
    this.#typingSpeed = Math.max(10, Math.min(100, speed));
  }
}

// Export singleton instance
export const agentFollowStore = new AgentFollowStore();
