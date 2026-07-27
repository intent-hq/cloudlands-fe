/**
 * Host Requirements Types
 *
 * Renderer-side view of the daemon-host tool requirements the onboarding
 * gate cares about: git availability and a Node.js runtime meeting
 * MINIMUM_NODE_VERSION. All probing happens on the daemon host (host.checkGit
 * / host.findBinary via the system:check-git / system:check-node bridges) —
 * this state only mirrors those terminal answers.
 */

/** Terminal probe result for git on the daemon host. */
export interface GitRequirementStatus {
  /** Whether the git probe has settled at least once. */
  checked: boolean;
  /** `host.checkGit` availability answer; false until checked. */
  available: boolean;
  /** Probed version string, when the daemon reported one. */
  version?: string;
}

/** Terminal probe result for Node.js on the daemon host. */
export interface NodeRequirementStatus {
  /** Whether the node probe has settled at least once. */
  checked: boolean;
  /** Whether node is present AND meets MINIMUM_NODE_VERSION; false until checked. */
  ok: boolean;
  /** Probed version string (leading `v` stripped), when reported. */
  version?: string;
}

export interface HostRequirementsState {
  git: GitRequirementStatus;
  node: NodeRequirementStatus;
  /** True while a requirements check group is in flight. */
  checking: boolean;
  /** Flips true once the first check group settles (success OR failure). */
  hasCheckedOnce: boolean;
}
