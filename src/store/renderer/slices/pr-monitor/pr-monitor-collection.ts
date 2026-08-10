import { getItem, type Collection } from "@augmentcode/themis/utils/collections/collection-utils";
import type { PrMonitorRow } from "$features/pr-monitor/pr-monitor-service";

export function getPrMonitorSubscriptionLeaseKey(
  monitors: Collection<PrMonitorRow, "monitorId">,
  workspaceId: string,
): string {
  let key = workspaceId;
  while (getItem(monitors, key)) key += "\0";
  return key;
}
