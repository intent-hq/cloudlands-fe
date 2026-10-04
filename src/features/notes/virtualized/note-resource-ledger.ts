/** Separate accounting units. Payload/string sizes are not JavaScript heap estimates. */
export interface NoteResourceCost {
  payloadBytes: number;
  stringUnits: number;
  objectNodes: number;
  domNodes: number;
  physicalReads: number;
  assemblies: number;
}
export interface NoteResourceReservation {
  /** Identifies an actual retained allocation, never merely equal content. */
  id: string;
  cost: NoteResourceCost;
}
interface PendingReservation {
  owner: string;
  resources: NoteResourceReservation[];
}
export interface NoteResourceLedger {
  limit: NoteResourceCost;
  used: NoteResourceCost;
  metadataLimit: { owners: number; resources: number; pending: number };
  resources: Record<string, { cost: NoteResourceCost; owners: string[] }>;
  owners: Record<string, string[]>;
  pending: PendingReservation[];
}
const dimensions = [
  'payloadBytes',
  'stringUnits',
  'objectNodes',
  'domNodes',
  'physicalReads',
  'assemblies',
] as const;
const zero = (): NoteResourceCost => ({
  payloadBytes: 0,
  stringUnits: 0,
  objectNodes: 0,
  domNodes: 0,
  physicalReads: 0,
  assemblies: 0,
});
const own = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;
const equalCost = (a: NoteResourceCost, b: NoteResourceCost) =>
  dimensions.every((key) => a[key] === b[key]);
const fits = (cost: NoteResourceCost, limit: NoteResourceCost) =>
  dimensions.every((key) => Number.isSafeInteger(cost[key]) && cost[key] <= limit[key]);
function validateCost(cost: NoteResourceCost) {
  if (dimensions.some((key) => !Number.isSafeInteger(cost[key]) || cost[key] < 0))
    throw new Error('Invalid note resource cost');
}
function validateId(id: string) {
  if (!id || id.length > 1024) throw new Error('Invalid note resource identity');
}
function add(target: NoteResourceCost, value: NoteResourceCost, sign = 1) {
  for (const key of dimensions) target[key] += value[key] * sign;
}
export function createNoteResourceLedger(
  limit: NoteResourceCost,
  metadataLimit = { owners: 256, resources: 256, pending: 64 },
): NoteResourceLedger {
  validateCost(limit);
  if (Object.values(metadataLimit).some((v) => !Number.isSafeInteger(v) || v < 1))
    throw new Error('Invalid note resource metadata limit');
  return {
    limit: { ...limit },
    used: zero(),
    metadataLimit: { ...metadataLimit },
    resources: {},
    owners: {},
    pending: [],
  };
}
function incremental(ledger: NoteResourceLedger, request: PendingReservation) {
  const cost = { ...ledger.used };
  let resources = Object.keys(ledger.resources).length;
  for (const resource of request.resources)
    if (!own(ledger.resources, resource.id)) {
      add(cost, resource.cost);
      resources++;
    }
  return { cost, resources };
}
function canAdmit(ledger: NoteResourceLedger, request: PendingReservation) {
  const { cost, resources } = incremental(ledger, request);
  return (
    fits(cost, ledger.limit) &&
    resources <= ledger.metadataLimit.resources &&
    Object.keys(ledger.owners).length < ledger.metadataLimit.owners
  );
}
function admit(ledger: NoteResourceLedger, request: PendingReservation): NoteResourceLedger {
  const resources = { ...ledger.resources };
  const used = { ...ledger.used };
  for (const resource of request.resources) {
    const existing = own(resources, resource.id);
    if (!existing) add(used, resource.cost);
    resources[resource.id] = {
      cost: { ...resource.cost },
      owners: [...(existing?.owners ?? []), request.owner],
    };
  }
  return {
    ...ledger,
    used,
    resources,
    owners: { ...ledger.owners, [request.owner]: request.resources.map((r) => r.id) },
  };
}
function drain(initial: NoteResourceLedger): NoteResourceLedger {
  let ledger = initial;
  while (ledger.pending[0] && canAdmit(ledger, ledger.pending[0])) {
    const [first, ...pending] = ledger.pending;
    ledger = admit({ ...ledger, pending }, first);
  }
  return ledger;
}
/** Call BEFORE IO/decode/construction. A queued request owns no allocation credit. */
export function requestNoteResources(
  ledger: NoteResourceLedger,
  owner: string,
  resources: NoteResourceReservation[],
): { ledger: NoteResourceLedger; status: 'admitted' | 'queued' | 'impossible' | 'capacity' } {
  validateId(owner);
  const minimum = zero();
  const ids = new Set<string>();
  for (const resource of resources) {
    validateId(resource.id);
    validateCost(resource.cost);
    if (ids.has(resource.id)) throw new Error('Duplicate note resource identity');
    ids.add(resource.id);
    add(minimum, resource.cost);
    const existing = own(ledger.resources, resource.id);
    const pending = ledger.pending.flatMap((p) => p.resources).find((r) => r.id === resource.id);
    if (
      (existing && !equalCost(existing.cost, resource.cost)) ||
      (pending && !equalCost(pending.cost, resource.cost))
    )
      throw new Error('Shared note resource cost changed');
  }
  if (!fits(minimum, ledger.limit) || resources.length > ledger.metadataLimit.resources)
    return { ledger, status: 'impossible' };
  const existing = own(ledger.owners, owner);
  if (existing) {
    if (existing.length !== ids.size || existing.some((id) => !ids.has(id)))
      throw new Error('Dispose and release note resources before replacing an owner');
    return { ledger, status: 'admitted' };
  }
  const request = { owner, resources: resources.map((r) => ({ id: r.id, cost: { ...r.cost } })) };
  const pendingIndex = ledger.pending.findIndex((p) => p.owner === owner);
  // Retaining an existing object must not wait behind a request for new allocations.
  const sharesOnly = resources.every((r) => own(ledger.resources, r.id));
  if ((ledger.pending.length === 0 || sharesOnly) && canAdmit(ledger, request)) {
    const pending = ledger.pending.filter((p) => p.owner !== owner);
    return { ledger: admit({ ...ledger, pending }, request), status: 'admitted' };
  }
  if (pendingIndex < 0 && ledger.pending.length >= ledger.metadataLimit.pending)
    return { ledger, status: 'capacity' };
  const pending = [...ledger.pending];
  if (pendingIndex < 0) pending.push(request);
  else pending[pendingIndex] = request;
  const next = drain({ ...ledger, pending });
  return { ledger: next, status: own(next.owners, owner) ? 'admitted' : 'queued' };
}
/** Release only after the actual promise/DOM/object owner has settled or disposed. */
export function releaseNoteResources(
  ledger: NoteResourceLedger,
  owner: string,
): NoteResourceLedger {
  const held = own(ledger.owners, owner);
  if (!held && !ledger.pending.some((p) => p.owner === owner)) return ledger;
  const resources = { ...ledger.resources };
  const owners = { ...ledger.owners };
  const used = { ...ledger.used };
  for (const id of held ?? []) {
    const resource = resources[id];
    const remaining = resource.owners.filter((id) => id !== owner);
    if (remaining.length) resources[id] = { ...resource, owners: remaining };
    else {
      add(used, resource.cost, -1);
      delete resources[id];
    }
  }
  delete owners[owner];
  return drain({
    ...ledger,
    used,
    resources,
    owners,
    pending: ledger.pending.filter((p) => p.owner !== owner),
  });
}
/** Atomic accepted handoff. Rejected handoffs leave the originating owner responsible. */
export function transferNoteResources(
  ledger: NoteResourceLedger,
  from: string,
  to: string,
): NoteResourceLedger {
  validateId(to);
  if (from === to) return ledger;
  if (own(ledger.owners, to) || ledger.pending.some((p) => p.owner === to))
    throw new Error('Note resource transfer target is occupied');
  const held = own(ledger.owners, from);
  if (!held) throw new Error('Note resource transfer owner is missing');
  const resources = { ...ledger.resources };
  for (const id of held) {
    const resource = resources[id];
    resources[id] = { ...resource, owners: resource.owners.map((id) => (id === from ? to : id)) };
  }
  const owners = { ...ledger.owners, [to]: held };
  delete owners[from];
  return { ...ledger, resources, owners };
}
