/**
 * Settings-events slice — saga-only trigger surface.
 *
 * Holds the typed FE action that mirrors the daemon's `settings:changed`
 * notification (PROTOCOL §6.5). The boot-hydration service and the daemon
 * events bridge both dispatch this action so panels can observe BE-owned
 * settings changes without polling. No state lives in this slice — per
 * `src/store/renderer/AGENTS.md` §8 a trigger-only slice deliberately omits
 * its reducer entry to keep the state tree free of empty branches.
 */
import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import type { AppliedSettingChange } from "$lib/client/app-client";

/**
 * Typed counterpart to the wire `settings:changed` event (§6.5). The payload
 * mirrors `data.changes` on the daemon notification — an applied
 * `{ path, value }` list with sensitive values pre-redacted by the BE. Boot
 * hydration synthesizes the action from the full `settings.list()` snapshot so
 * panels see one consistent action regardless of source.
 */
export const settingsChanged = createAction<[changes: AppliedSettingChange[]]>(
  "settings/changed",
);
