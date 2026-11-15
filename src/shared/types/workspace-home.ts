/**
 * `WorkspaceHome` (PROTOCOL `methods/nodes.md` → "Workspace homes"): the one
 * machine that holds a workspace's home checkout on an orchestrator. Present
 * on `workspace.get` and list rows only there; changes arrive as
 * `workspace:updated { changes: { home } }`.
 */
import { z } from 'zod';

/**
 * The documented states. `starting`: a cloud home's sandbox is starting,
 * resuming or being rebuilt (nodes.md "Cloud homes" 6). A later backend may
 * send a state this app does not know; it is kept as served and shown as
 * unavailable, never dropped.
 */
export type KnownWorkspaceHomeState = 'attached' | 'detached' | 'moving' | 'starting';
export type WorkspaceHomeState = KnownWorkspaceHomeState | (string & {});

const WorkspaceHomeSchema = z.object({
  /** This home's generation: a new id at create and at every move. */
  homeId: z.string().min(1),
  /** An exposed machine, or a running cloud home's machine row. */
  nodeId: z.string().min(1).optional(),
  /** A cloud home's entry. */
  cloudMachineId: z.string().min(1).optional(),
  /** The machine's or entry's name. */
  name: z.string(),
  state: z.string().min(1) as z.ZodType<WorkspaceHomeState>,
  /** When `state` last changed. */
  since: z.string(),
  /** The last push of home/head or home/wip the orchestrator holds. */
  lastBackupAt: z.string().optional(),
  /** True once backups have failed for 15 minutes. */
  backupWarning: z.boolean().optional(),
});

export type WorkspaceHome = z.infer<typeof WorkspaceHomeSchema>;

/** The served home, or undefined when the value is outside the contract. */
export function parseWorkspaceHome(raw: unknown): WorkspaceHome | undefined {
  const parsed = WorkspaceHomeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** `workspace.setHome` `to` (PROTOCOL `methods/nodes.md` → "Moving the home"). */
export type MoveHomeTarget =
  | { agentId: string }
  | { kind: 'machine'; nodeId: string }
  | { kind: 'cloud'; cloudMachineId: string };
