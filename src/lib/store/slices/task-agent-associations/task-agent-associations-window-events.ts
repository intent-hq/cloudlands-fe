import { dispatchWindowEvent } from "$lib/utils/window-events";
import {
  AGENT_ASSOCIATIONS_REMOVED_EVENT,
  TASK_ASSOCIATION_CHANGED_EVENT,
} from "./task-agent-associations-slice";

export type AgentAssociationsRemovedDetail = {
  agentId: string;
  noteId: string;
  workspaceId: string;
};

export function dispatchTaskAssociationChangedEvent(): void {
  dispatchWindowEvent(TASK_ASSOCIATION_CHANGED_EVENT);
}

export function dispatchAgentAssociationsRemovedEvent(detail: AgentAssociationsRemovedDetail): void {
  dispatchWindowEvent(AGENT_ASSOCIATIONS_REMOVED_EVENT, detail);
}