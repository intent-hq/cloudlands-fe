# Multi-ACP Provider Support Spec

## Overview

Add support for multiple ACP (Agent Client Protocol) providers in the Intent app. Currently only Auggie is supported, but this spec enables adding other ACP-compatible agents like OpenCode, Gemini CLI, Claude Code (via adapter), Goose, etc.

The model picker will use **grouped dropdowns** where models are organized by provider, allowing users to switch between different ACP agents within a single workspace.

## Goals

1. Support multiple ACP providers (Auggie, OpenCode, etc.) in the same workspace
2. Model picker shows models grouped by provider
3. Minimal changes to existing architecture - reuse `ACPProvider` class
4. Provider-specific configurations (command, args, model naming)
5. Correct agent name shown in permission requests and UI

## Current State

### What Exists

- `ProviderRegistry` in `src/features/agent/main/provider-registry.ts` - Maps provider names to factories
- `ACPProvider` in `src/features/agent/main/agent-providers/acp-provider.ts` - ~5000 line implementation
- `ModelPicker.svelte` in `src/lib/components/chat/input/ModelPicker.svelte` - Single-level dropdown
- `ModelInfoRegistryEntry` type already has `modelGroup` and `modelGroupPriority` fields
- Permission UI shows agent name from `agentName` option passed to `permissionIPCBridge.requestPermission()`

### Key Files to Modify

| File | Change |
|------|--------|
| `src/features/agent/main/provider-registry.ts` | Add OpenCode factory, provider config |
| `src/features/agent/main/agent-providers/acp-provider.ts` | Use provider-specific agent name |
| `src/lib/components/chat/input/ModelPicker.svelte` | Group models by provider |
| `src/features/auggie/auggie-models.client.ts` | Extend to support multi-provider models |
| `src/shared/types/agent.types.ts` | Update `AgentProvider` type |

## Architecture

### Provider Configuration

```typescript
// src/features/agent/main/provider-config.ts (NEW FILE)

export interface ACPProviderConfig {
  id: string;                    // 'auggie' | 'opencode' | 'gemini-cli' etc.
  displayName: string;           // 'Auggie' | 'OpenCode' | 'Gemini CLI'
  command: string;               // CLI command to spawn
  baseArgs: string[];            // Default args for ACP mode
  modelFlag?: string;            // Flag for model selection (e.g., '--model')
  supportedModels?: string[];    // Optional: filter available models
  iconPath?: string;             // Optional: provider icon
}

export const ACP_PROVIDERS: Record<string, ACPProviderConfig> = {
  auggie: {
    id: 'auggie',
    displayName: 'Auggie',
    command: 'auggie',
    baseArgs: ['--acp', '--allow-indexing'],
    modelFlag: '--model',
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    baseArgs: ['--acp'],  // Verify actual flag from OpenCode docs
    modelFlag: '--model',
  },
  // Add more providers as needed
};
```

### Model ID Format

To uniquely identify a model across providers, use compound IDs:

```
Format: {providerId}:{modelId}
Examples:
  - auggie:sonnet4.5
  - auggie:gemini25-pro
  - opencode:claude-sonnet-4
  - opencode:gpt-4o
```

The model picker displays these grouped by provider, but stores the full compound ID.

### Updated Model Registry Entry

```typescript
// Extend existing ModelInfoRegistryEntry
interface ExtendedModelInfo extends ModelInfoRegistryEntry {
  providerId: string;           // 'auggie' | 'opencode'
  providerDisplayName: string;  // 'Auggie' | 'OpenCode'
  rawModelId: string;           // Model ID without provider prefix
}
```

## Implementation Phases

### Phase 1: Provider Registry Updates

#### 1.1 Create Provider Config (`src/features/agent/main/provider-config.ts`)

New file defining provider configurations as shown above.

#### 1.2 Update Provider Registry (`src/features/agent/main/provider-registry.ts`)

```typescript
import { ACP_PROVIDERS, type ACPProviderConfig } from './provider-config';

async function getACP(
  config: AgentConfig,
  autoInitialize: boolean = true,
  providerConfig?: ACPProviderConfig,
): Promise<BaseAgentProvider> {
  const { ACPProvider } = await import('./agent-providers/acp-provider.js');

  const pConfig = providerConfig || ACP_PROVIDERS.auggie;

  config.command = pConfig.command;
  config.args = [...pConfig.baseArgs];

  if (config.model && pConfig.modelFlag) {
    // Extract raw model ID if compound format
    const rawModelId = config.model.includes(':')
      ? config.model.split(':')[1]
      : config.model;
    config.args.push(pConfig.modelFlag, rawModelId);
  }

  // Store provider info for permission UI
  config._providerConfig = pConfig;

  const provider = new ACPProvider(config);
  if (autoInitialize) await provider.initialize();
  return provider;
}

// In createDefault():
for (const [id, pConfig] of Object.entries(ACP_PROVIDERS)) {
  reg.register(id, (cfg, autoInit) => getACP(cfg, autoInit, pConfig));
}
```

#### 1.3 Update ACPProvider for Agent Name

In `acp-provider.ts`, use the provider config for permission requests:

```typescript
// Around line 1729 in handleACPPermission
const providerConfig = this.config._providerConfig;
const agentName = providerConfig?.displayName || 'Auggie';

const outcome = await permissionIPCBridge.requestPermission(
  permissionSessionId,
  title,
  description,
  options,
  { agentName },
);
```

### Phase 2: Model Store Updates

#### 2.1 Update Model Store (`src/features/auggie/auggie-models.client.ts`)

```typescript
// Rename to multi-provider-models.client.ts or keep and extend

interface ProviderModelEntry {
  providerId: string;
  providerDisplayName: string;
  models: AuggieModel[];
}

// Fetch models for each provider and merge
async function fetchAllProviderModels(): Promise<ProviderModelEntry[]> {
  // For now, all providers use Augment's model list
  // In future, each provider could have its own model endpoint
  const auggieModels = await fetchAuggieModels();

  return Object.values(ACP_PROVIDERS).map(provider => ({
    providerId: provider.id,
    providerDisplayName: provider.displayName,
    models: auggieModels.map(m => ({
      ...m,
      value: `${provider.id}:${m.value}`,  // Compound ID
    })),
  }));
}
```

### Phase 3: Model Picker UI Updates

#### 3.1 Update ModelPicker (`src/lib/components/chat/input/ModelPicker.svelte`)

The existing `Dropdown` component supports grouping. Update to group by provider:

```typescript
// Convert to grouped dropdown options
const modelOptions = $derived<DropdownOption[]>(() => {
  const options: DropdownOption[] = [
    {
      value: USE_DEFAULT_VALUE,
      label: 'Use default',
      description: 'Let the system choose the best model',
    },
  ];

  // Group models by provider
  for (const providerEntry of providerModels) {
    // Add group header
    options.push({
      value: `__group_${providerEntry.providerId}`,
      label: providerEntry.providerDisplayName,
      isGroupHeader: true,
      disabled: true,
    });

    // Add models under this provider
    for (const model of providerEntry.models) {
      options.push({
        value: model.value,  // Compound ID: 'auggie:sonnet4.5'
        label: model.label,
        description: model.description,
        indent: true,  // Visual indent under group
      });
    }
  }

  return options;
});
```

**UI Mockup:**
```
┌─────────────────────────────────┐
│ Use default                     │
├─────────────────────────────────┤
│ ▼ Auggie                        │  ← Group header (not selectable)
│   Claude Sonnet 4.5             │
│   Claude Haiku 4.5              │
│   Gemini 2.5 Pro                │
├─────────────────────────────────┤
│ ▼ OpenCode                      │  ← Group header (not selectable)
│   Claude Sonnet 4.5             │
│   Claude Haiku 4.5              │
│   GPT-4o                        │
└─────────────────────────────────┘
```

#### 3.2 Update Settings Model Dropdowns

Apply same grouping pattern to:
- `src/routes/settings/+page.svelte` - Default model setting
- `src/lib/components/settings/ModeSettings.svelte` - Per-mode model

### Phase 4: Agent Config Updates

#### 4.1 Parse Provider from Model ID

When creating an agent, extract provider from compound model ID:

```typescript
// In agent-factory.ts or agent-backend-handler.ts
function parseModelSelection(compoundModelId: string): {
  providerId: string;
  modelId: string;
} {
  if (compoundModelId.includes(':')) {
    const [providerId, modelId] = compoundModelId.split(':', 2);
    return { providerId, modelId };
  }
  // Default to auggie for backwards compatibility
  return { providerId: 'auggie', modelId: compoundModelId };
}

// Usage:
const { providerId, modelId } = parseModelSelection(config.model);
config.provider = providerId;
config.model = modelId;
```

#### 4.2 Update AgentConfig Type

```typescript
// src/shared/types/agent.types.ts
export type AgentProvider = 'auggie' | 'opencode' | 'gemini-cli' | string;
```

## Testing Checklist

- [ ] Auggie provider works as before (backwards compatibility)
- [ ] OpenCode provider spawns correctly with `opencode --acp`
- [ ] Model picker displays grouped models
- [ ] Selecting a model from OpenCode group uses OpenCode provider
- [ ] Permission dialog shows correct agent name ("OpenCode" vs "Auggie")
- [ ] Settings dropdowns show grouped models
- [ ] Model selection persists correctly with compound IDs
- [ ] Fallback to Auggie when provider not specified

## Migration & Backwards Compatibility

- Existing model IDs without provider prefix default to `auggie:`
- Stored preferences with old format (`sonnet4.5`) map to `auggie:sonnet4.5`
- No database migration needed - handled at runtime

## Future Enhancements

1. **Provider-specific model lists**: Each provider could expose its own available models
2. **Provider availability detection**: Check if CLI is installed before showing provider
3. **Provider settings**: Per-provider configuration (API keys, custom args)
4. **Provider icons**: Visual distinction in dropdowns
5. **Hot-swap providers**: Change provider mid-conversation

## Dependencies

- OpenCode CLI installed and in PATH
- Other providers as needed

## Open Questions

1. **OpenCode ACP flag**: Need to verify exact CLI flags for ACP mode. Check:
   - https://github.com/sst/opencode
   - https://opencode.ai/docs

2. **Model compatibility**: Do all providers support the same model IDs, or do they have provider-specific naming?

3. **Authentication**: How do different providers handle auth? (API keys, OAuth, etc.)
