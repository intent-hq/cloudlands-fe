import type {
  ActorType,
  EventActor,
  WorkspaceEvent,
  WorkspaceEventType,
} from '$features/events/types';

const VALID_ACTOR_TYPES = new Set<ActorType>(['user', 'agent', 'system', 'external', 'tool']);

const STRING_ARRAY_KEYS = new Set([
  'agentIds',
  'artifacts',
  'deliveredEventIds',
  'eventTypes',
  'files',
  'filesModified',
  'readyTaskIds',
  'sections',
  'tags',
]);

const STRING_FIELD_KEYS = new Set([
  'action',
  'branch',
  'changedAt',
  'command',
  'computedAt',
  'content',
  'cwd',
  'description',
  'diff',
  'email',
  'error',
  'fileName',
  'filePath',
  'filterDescription',
  'finishReason',
  'hash',
  'id',
  'initialMessage',
  'language',
  'lastResponseSummary',
  'message',
  'model',
  'name',
  'newContent',
  'newContentSha',
  'newPath',
  'newStatus',
  'noteTitle',
  'oldContent',
  'oldContentSha',
  'oldPath',
  'operation',
  'output',
  'path',
  'previousStatus',
  'priority',
  'reason',
  'relativePath',
  'remote',
  'scriptName',
  'source',
  'specialist',
  'status',
  'stream',
  'summary',
  'text',
  'timestamp',
  'title',
  'topic',
  'type',
  'url',
  'workingDirectory',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function isExpectedStringField(key: string): boolean {
  return (
    STRING_FIELD_KEYS.has(key) ||
    key.endsWith('Id') ||
    key.endsWith('ID') ||
    key.endsWith('Name') ||
    key.endsWith('Title') ||
    key.endsWith('Path') ||
    key.endsWith('Url') ||
    key.endsWith('URL') ||
    key.endsWith('Sha')
  );
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(coerceString).filter((item): item is string => item !== undefined);
}

function sanitizeSerializable(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (STRING_ARRAY_KEYS.has(key)) return sanitizeStringArray(value);
  if (isExpectedStringField(key)) return coerceString(value);
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return undefined;
    seen.add(value);

    try {
      if (Array.isArray(value)) {
        const items = value
          .map((item) => sanitizeSerializable(item, '', seen))
          .filter((item) => item !== undefined);
        return items;
      }
      if (!isRecord(value)) return undefined;

      const sanitized: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        const sanitizedValue = sanitizeSerializable(childValue, childKey, seen);
        if (sanitizedValue !== undefined) {
          sanitized[childKey] = sanitizedValue;
        }
      }
      return sanitized;
    } finally {
      seen.delete(value);
    }
  }

  return undefined;
}

function sanitizeActor(value: unknown, seen: WeakSet<object>): EventActor {
  const actor = isRecord(value) ? value : {};
  const type = coerceString(actor.type);
  const sanitizedActor: EventActor = {
    type: type && VALID_ACTOR_TYPES.has(type as ActorType) ? (type as ActorType) : 'system',
  };

  for (const key of ['id', 'name', 'email', 'model'] as const) {
    const stringValue = coerceString(actor[key]);
    if (stringValue !== undefined) {
      sanitizedActor[key] = stringValue;
    }
  }

  const metadata = sanitizeSerializable(actor.metadata, 'metadata', seen);
  if (isRecord(metadata)) {
    sanitizedActor.metadata = metadata;
  }

  return sanitizedActor;
}

export function sanitizeWorkspaceEvent(
  value: unknown,
  fallbackWorkspaceId?: string,
): WorkspaceEvent | null {
  if (!isRecord(value)) return null;

  const id = coerceString(value.id);
  const workspaceId = coerceString(value.workspaceId) ?? fallbackWorkspaceId;
  const timestamp = coerceString(value.timestamp);
  const type = coerceString(value.type);

  if (!id || !workspaceId || !timestamp || !type) return null;

  const createSeen = () => {
    const seen = new WeakSet<object>();
    seen.add(value);
    return seen;
  };

  const event: WorkspaceEvent = {
    id,
    workspaceId,
    timestamp,
    type: type as WorkspaceEventType,
    actor: sanitizeActor(value.actor, createSeen()),
  };

  for (const key of [
    'sessionId',
    'correlationId',
    'parentEventId',
    'title',
    'description',
    'relatedChatMessageId',
    'relatedAgentId',
    'relatedToolCallId',
    'agentId',
    'exchangeId',
  ] as const) {
    const stringValue = coerceString(value[key]);
    if (stringValue !== undefined) {
      event[key] = stringValue;
    }
  }

  for (const key of ['metadata', 'data', 'codeChange', 'provenance'] as const) {
    const sanitizedValue = sanitizeSerializable(value[key], key, createSeen());
    if (sanitizedValue !== undefined) {
      event[key] = sanitizedValue as never;
    }
  }

  return event;
}

export function sanitizeWorkspaceEventsList(
  value: unknown,
  fallbackWorkspaceId?: string,
): WorkspaceEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((event) => sanitizeWorkspaceEvent(event, fallbackWorkspaceId))
    .filter((event): event is WorkspaceEvent => event !== null);
}
