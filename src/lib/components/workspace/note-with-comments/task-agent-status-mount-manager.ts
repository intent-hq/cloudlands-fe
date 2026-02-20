import { mount, unmount } from 'svelte';
import TaskAgentStatus from '$lib/components/tiptap/TaskAgentStatus.svelte';

export interface TaskAgentStatusMountManagerOptions {
  /** Root element that contains the TipTap DOM (the `.tiptap-editor-wrapper` element). */
  getRootElement: () => HTMLElement | null;
  /** Called when the user clicks "view agent" on the task status pill. */
  onViewAgent: (agentId: string) => void;
}

export interface TaskAgentStatusMountManager {
  start: () => void;
  /** Forces a scan for containers and mounts/unmounts as needed. */
  refresh: () => void;
  stop: () => void;
  /** Idempotent; safe to call multiple times. */
  destroy: () => void;
}

/**
 * Bridges TipTap-generated DOM containers (in task node views) with a Svelte component
 * (`TaskAgentStatus`) by scanning for containers and mounting/unmounting as the DOM changes.
 */
export function createTaskAgentStatusMountManager(
  options: TaskAgentStatusMountManagerOptions,
): TaskAgentStatusMountManager {
  let observer: MutationObserver | null = null;
  const mounted = new Map<string, { component: any; container: Element }>();

  function mountForContainer(container: Element) {
    const agentId = container.getAttribute('data-agent-id');
    if (!agentId || mounted.has(agentId)) return;

    const component = mount(TaskAgentStatus, {
      target: container as HTMLElement,
      props: {
        agentId,
        onViewAgent: () => options.onViewAgent(agentId),
      },
    });

    mounted.set(agentId, { component, container });
  }

  function unmountForAgentId(agentId: string) {
    const entry = mounted.get(agentId);
    if (!entry) return;
    unmount(entry.component);
    mounted.delete(agentId);
  }

  function scan() {
    const root = options.getRootElement();
    if (!root) return;

    const containers = root.querySelectorAll('.task-agent-status-container[data-agent-id]');
    const currentAgentIds = new Set<string>();

    containers.forEach((container) => {
      const agentId = container.getAttribute('data-agent-id');
      if (!agentId) return;
      currentAgentIds.add(agentId);
      if (!mounted.has(agentId)) {
        mountForContainer(container);
      }
    });

    mounted.forEach((entry, agentId) => {
      if (!currentAgentIds.has(agentId) || !document.contains(entry.container)) {
        unmountForAgentId(agentId);
      }
    });
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function start() {
    const root = options.getRootElement();
    if (!root) return;

    stop();
    scan();

    observer = new MutationObserver((mutations) => {
      let needsScan = false;
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;

        for (const node of mutation.addedNodes) {
          if (
            node instanceof Element &&
            (node.classList?.contains('task-agent-status-container') ||
              node.querySelector?.('.task-agent-status-container'))
          ) {
            needsScan = true;
            break;
          }
        }
        if (needsScan) break;

        for (const node of mutation.removedNodes) {
          if (
            node instanceof Element &&
            (node.classList?.contains('task-agent-status-container') ||
              node.querySelector?.('.task-agent-status-container'))
          ) {
            needsScan = true;
            break;
          }
        }
        if (needsScan) break;
      }

      if (needsScan) {
        requestAnimationFrame(scan);
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  }

  function destroy() {
    stop();
    mounted.forEach((entry) => {
      unmount(entry.component);
    });
    mounted.clear();
  }

  return {
    start,
    refresh: scan,
    stop,
    destroy,
  };
}
