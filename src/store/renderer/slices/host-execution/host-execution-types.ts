import type { HostExecutionContext } from '$shared/types/host-execution';
export interface HostExecutionState {
  connection: string | null;
  generation: number;
  context: HostExecutionContext | null;
}
