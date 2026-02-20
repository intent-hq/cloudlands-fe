/**
 * Keyboard shortcuts for the follow agent feature
 */

import { agentFollowStore } from '$features/agent/agent-follow.store.svelte';
import { agentService } from '$features/agent/agent.service';

export function setupFollowShortcuts() {
  const handleKeydown = (event: KeyboardEvent) => {
    // Cmd/Ctrl + Shift + F to toggle follow mode
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'F') {
      event.preventDefault();
      toggleFollowMode();
    }

    // Escape to stop following
    if (event.key === 'Escape' && agentFollowStore.isFollowing) {
      event.preventDefault();
      agentFollowStore.stopFollowing();
    }

    // Cmd/Ctrl + Shift + Arrow keys to cycle through agents
    if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        cycleToNextAgent();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        cycleToPreviousAgent();
      }
    }
  };

  function toggleFollowMode() {
    if (agentFollowStore.isFollowing) {
      agentFollowStore.stopFollowing();
    } else {
      // Start following the first active agent
      // Get workspace ID from the followed agent if available
      const workspaceId = agentFollowStore.followedAgent?.workspaceId || '';
      const activeAgents = workspaceId ? agentService.getActiveAgents(workspaceId) : [];
      if (activeAgents.length > 0) {
        agentFollowStore.startFollowing(activeAgents[0]);
      }
    }
  }

  function cycleToNextAgent() {
    const workspaceId = agentFollowStore.followedAgent?.workspaceId || '';
    const activeAgents = workspaceId ? agentService.getActiveAgents(workspaceId) : [];
    if (activeAgents.length === 0) return;

    const currentId = agentFollowStore.followedAgentId;
    const currentIndex = activeAgents.findIndex((a: any) => a.id === currentId);
    const nextIndex = (currentIndex + 1) % activeAgents.length;

    agentFollowStore.startFollowing(activeAgents[nextIndex]);
  }

  function cycleToPreviousAgent() {
    const workspaceId = agentFollowStore.followedAgent?.workspaceId || '';
    const activeAgents = workspaceId ? agentService.getActiveAgents(workspaceId) : [];
    if (activeAgents.length === 0) return;

    const currentId = agentFollowStore.followedAgentId;
    const currentIndex = activeAgents.findIndex((a: any) => a.id === currentId);
    const prevIndex = currentIndex <= 0 ? activeAgents.length - 1 : currentIndex - 1;

    agentFollowStore.startFollowing(activeAgents[prevIndex]);
  }

  // Add event listener
  window.addEventListener('keydown', handleKeydown);

  // Return cleanup function
  return () => {
    window.removeEventListener('keydown', handleKeydown);
  };
}
