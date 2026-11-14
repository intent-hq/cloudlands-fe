/**
 * `WorkspaceHome` (PROTOCOL `methods/nodes.md` → "Workspace homes"): the one
 * machine that holds a workspace's home checkout on an orchestrator. Present
 * on `workspace.get` and list rows only there; changes arrive as
 * `workspace:updated { changes: { home } }`.
 */
import { z } from 'zod';

export const WORKSPACE_HOME_STATES = ['attached', 'detached', 'moving'] as const;
export type WorkspaceHomeState = (typeof WORKSPACE_HOME_STATES)[number];

const WorkspaceHomeSchema = z.object({
  /** This home's generation: a new id at create and at every move. */
  homeId: z.string().min(1),
  /** An exposed machine, or a running cloud home's machine row. */
  nodeId: z.string().min(1).optional(),
  /** A cloud home's entry. */
  cloudMachineId: z.string().min(1).optional(),
  /** The machine's or entry's name. */
  name: z.string(),
  state: z.enum(WORKSPACE_HOME_STATES),
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
