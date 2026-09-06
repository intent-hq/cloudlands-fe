import type { SpecialistDef } from '$lib/client/app-client';
import type { Specialist } from '$lib/constants/specialists';
import type { RequireSharedKeys } from '$lib/utils/mapped-shape';
import type { SpecialistFileScope } from '$shared/specialist-file-types';
import type { FileSpecialist } from '../specialists-slice';

declare const def: SpecialistDef;
declare const builtin: Specialist;

// Positive: a literal that carries every key shared by the source and target
// (`reasoningEffort` included) satisfies the guard, while renamed fields
// (`model` -> `defaultModel`, `path` -> `filePath`) stay hand-mapped.
const completeFile = {
  id: def.id,
  name: def.name,
  description: def.description,
  codingAgent: def.codingAgent,
  model: def.model ?? '',
  behaviorPrompt: def.behaviorPrompt ?? '',
  roleReminder: def.roleReminder,
  filePath: def.path ?? '',
  source: def.source as SpecialistFileScope,
  hidden: def.hidden,
  modelOptions: def.modelOptions,
  reasoningEffort: def.reasoningEffort,
  resolvedModel: def.resolvedModel,
  resolvedProvider: def.resolvedProvider,
  role: def.role,
  teamAgents: def.teamAgents,
  icon: def.icon,
} satisfies RequireSharedKeys<SpecialistDef, FileSpecialist>;
const completeFileAsTarget: FileSpecialist = completeFile;
void completeFileAsTarget;

// Negative: dropping a shared optional key is a compile error even though the
// bare target type would accept the literal.
const fileMissingReasoningEffort = {
  id: def.id,
  name: def.name,
  description: def.description,
  codingAgent: def.codingAgent,
  model: def.model ?? '',
  behaviorPrompt: def.behaviorPrompt ?? '',
  roleReminder: def.roleReminder,
  filePath: def.path ?? '',
  source: def.source as SpecialistFileScope,
  hidden: def.hidden,
  modelOptions: def.modelOptions,
  resolvedModel: def.resolvedModel,
  resolvedProvider: def.resolvedProvider,
  role: def.role,
  teamAgents: def.teamAgents,
  icon: def.icon,
  // @ts-expect-error omitting the shared `reasoningEffort` key must not satisfy the guard
} satisfies RequireSharedKeys<SpecialistDef, FileSpecialist>;
void fileMissingReasoningEffort;

const bundledMissingOptionalKeys = {
  id: builtin.id,
  name: builtin.name,
  description: builtin.description,
  defaultBehaviorPrompt: builtin.defaultBehaviorPrompt,
  source: 'bundled',
  // @ts-expect-error a Specialist -> Specialist mapper must list every key, not just the required ones
} satisfies RequireSharedKeys<Specialist, Specialist>;
void bundledMissingOptionalKeys;
