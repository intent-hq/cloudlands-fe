import type { NotePageRequest } from '$lib/client/note-pages';
import { NOTE_WINDOW_LIMITS } from './note-window-reader';
import type { NoteResourceCost, NoteResourceReservation } from './note-resource-ledger';

export interface NoteAssemblyLease {
  owner: string;
  data: string;
  control: string;
}
/** A cumulative construction allowance, not a reusable per-frame allowance or
 * heap claim. Covers bounded response graphs, fragment assembly, JSON inspection,
 * canonical materialization and the returned window. Native projection/DOM has
 * separate admission. Retain the allowance until the LAST data lease disappears.
 * This conservative allowance remains subject to producer/runtime acceptance. */
const transcript = NOTE_WINDOW_LIMITS.requests * NOTE_WINDOW_LIMITS.wireBytes;
export const NOTE_ASSEMBLY_DATA_COST: NoteResourceCost = {
  payloadBytes: 8 * transcript,
  stringUnits: 8 * transcript,
  objectNodes: 8 * transcript,
  domNodes: 0,
  physicalReads: 0,
  assemblies: 0,
};
// Sponsor, one sequential IO owner, four cache owners, a window with two view
// slots, and reserved completion slack. No late global metadata admission.
export const NOTE_ASSEMBLY_OWNER_SLOTS = 12;
export function noteAssemblyResources(lease: NoteAssemblyLease): NoteResourceReservation[] {
  return [
    { id: lease.data, cost: { ...NOTE_ASSEMBLY_DATA_COST } },
    {
      id: lease.control,
      cost: {
        payloadBytes: 0,
        stringUnits: 0,
        objectNodes: 0,
        domNodes: 0,
        physicalReads: 1,
        assemblies: 1,
      },
    },
  ];
}
/** Distinct sponsors never join each other's queued physical request. This avoids
 * a waiter holding the only completion credit needed by its producer. */
export function notePageRequestKey(request: NotePageRequest, assembly?: NoteAssemblyLease): string {
  const key = JSON.stringify(
    Object.fromEntries(Object.entries(request).sort(([a], [b]) => a.localeCompare(b))),
  );
  return assembly ? `${key}|${assembly.owner}` : key;
}
