# Mention System Documentation

A comprehensive @ mention system for the Augment workspace application, enabling users to reference files, folders, notes, tasks, and other entities in chat and notes.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start](#quick-start)
3. [Core Concepts](#core-concepts)
4. [Provider System](#provider-system)
5. [API Reference](#api-reference)
6. [Usage Examples](#usage-examples)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                          │
│  (TipTapEditor, EnhancedMentionList, RichTextarea)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    MentionSystem                             │
│  • Coordinates all mention functionality                     │
│  • Manages provider registry                                 │
│  • Handles search requests                                   │
│  • Manages breadcrumb navigation                             │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Search     │ │  Breadcrumb  │ │   Provider   │
│   Service    │ │  Controller  │ │   Registry   │
└──────────────┘ └──────────────┘ └──────┬───────┘
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
              ┌─────────────┐      ┌─────────────┐     ┌─────────────┐
              │    File     │      │    Note     │     │   Folder    │
              │  Provider   │      │  Provider   │     │  Provider   │
              └─────────────┘      └─────────────┘     └─────────────┘
```

### Data Flow

1. **User types `@`** → TipTap triggers mention suggestion
2. **Query sent to MentionSystem** → Determines which providers to use
3. **Providers search** → Each provider searches its domain (files, notes, etc.)
4. **Results combined** → DebouncedSearchService deduplicates and scores
5. **UI displays results** → EnhancedMentionList shows dropdown
6. **User selects** → Mention inserted into editor with metadata

### Key Design Patterns

- **Provider Pattern**: Extensible system for different mention types
- **Debounced Search**: Prevents excessive API calls during typing
- **LRU Caching**: Fast synchronous access to recent results
- **Abort Signals**: Cancels outdated searches
- **Retry Logic**: Handles transient failures gracefully

## Quick Start

### Basic Usage

```typescript
import { MentionSystem } from '$lib/services/mentions';

// Create mention system instance
const mentionSystem = new MentionSystem({
  debounceMs: 300,
  maxResults: 10
});

// Search for mentions
const results = await mentionSystem.search('@README', {
  workspaceId: 'workspace-123'
});

// Results contain MentionCandidate objects
results.forEach(candidate => {
  console.log(candidate.label, candidate.type, candidate.uri);
});
```

### Integration with TipTap

```typescript
import { Mention } from '@tiptap/extension-mention';
import { mentionSystem } from '$lib/services/mentions';

const editor = new Editor({
  extensions: [
    Mention.configure({
      suggestion: {
        char: '@',
        items: async ({ query }) => {
          return await mentionSystem.search(query, {
            workspaceId: workspace.id
          });
        },
        render: () => ({
          component: EnhancedMentionList
        })
      }
    })
  ]
});
```

## Core Concepts

### MentionCandidate

The fundamental data structure representing a mentionable entity:

```typescript
interface MentionCandidate {
  id: string;              // Unique identifier
  type: MentionType;       // 'file', 'note', 'folder', etc.
  label: string;           // Display name
  subtitle?: string;       // Secondary text (e.g., file path)
  description?: string;    // Detailed description
  icon?: string;           // Icon identifier
  uri: string;             // Unique resource identifier
  group?: string;          // Group label for categorization
  score?: number;          // Relevance score (0-1)
  meta?: MentionMeta;      // Type-specific metadata
}
```

### SearchContext

Provides context for search operations:

```typescript
interface SearchContext {
  workspaceId: string;     // Required: workspace identifier
  currentFile?: string;    // Current file being edited
  currentNote?: string;    // Current note being edited
  imports?: string[];      // Imported files (for relevance)
  recentFiles?: string[];  // Recently accessed files
  signal?: AbortSignal;    // For cancellation
}
```

### MentionTypes

Supported mention types:

- **Files**: `file`, `file-range` (with line numbers)
- **Folders**: `folder`, `source-folder`
- **Notes**: `note`, `note-range`
- **Tasks**: `task`
- **Rules**: `rule`
- **Commands**: `command`, `user-guidelines`, `agent-memories`
- **Personalities**: `personality`
- **External**: `external-source`
- **VCS**: `branch`, `commit`, `pr`
- **Issues**: `linear-issue`, `github-issue`
- **Other**: `workspace`, `agent`, `symbol`, `group`

## Provider System

### What is a Provider?

A provider is a plugin that supplies mention candidates for a specific domain (files, notes, etc.). Each provider implements the `Provider` interface and is registered with the system.

### Provider Interface

```typescript
interface Provider {
  id: string;                    // Unique provider identifier
  triggers?: string[];           // Trigger strings (e.g., '@file', '@note')
  default?: boolean;             // Include in default searches

  // Required: Search for candidates
  search(query: string, context: SearchContext): Promise<MentionCandidate[]>;

  // Optional: Enhanced capabilities
  supportsRanges?: boolean;      // Supports line/range selection
  supportsLivePreview?: boolean; // Supports live preview
  supportsQuickEdit?: boolean;   // Supports inline editing
  supportsSemantic?: boolean;    // Supports semantic search

  // Optional: Custom scoring and grouping
  scoreRelevance?(item: MentionCandidate, context: SearchContext): number;
  getGroups?(): MentionGroup[];
  getCategoryForItem?(item: MentionCandidate): string;
}
```

### Built-in Providers

#### FileProvider

Searches workspace files with smart scoring based on:
- Recent file access
- Same directory as current file
- Import relationships
- File type relevance

**Triggers**: `@file`, `@f`

**Features**:
- Range support (line numbers)
- Live preview
- Fallback to common files when search fails
- File icon mapping by extension

#### NoteProvider

Searches workspace notes with caching.

**Triggers**: `@note`, `@n`

**Features**:
- Range support (line numbers)
- Cached results for fast synchronous access
- Automatic cache refresh every 5 seconds

#### FolderProvider

Searches workspace folders.

**Triggers**: `@folder`, `@dir`

**Features**:
- File count metadata
- Smart folder icons based on name

### Creating a Custom Provider

Here's a complete example of creating a custom provider:

```typescript
import type { Provider, MentionCandidate, SearchContext } from '$lib/services/mentions/types';

export class CustomProvider implements Provider {
  id = 'custom';
  triggers = ['@custom', '@c'];
  default = false;
  supportsRanges = false;

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    // Validate context
    if (!context?.workspaceId) {
      return [];
    }

    // Check for abort signal
    if (context.signal?.aborted) {
      return [];
    }

    try {
      // Perform your search logic
      const results = await this.fetchCustomData(query, context);

      // Map to MentionCandidate format
      return results.map(item => ({
        id: `custom-${item.id}`,
        type: 'custom' as any, // Add to MentionType if needed
        label: item.name,
        subtitle: item.category,
        description: item.description,
        icon: '🔧',
        uri: `custom://${item.id}`,
        score: this.calculateScore(item, query),
        meta: {
          customField: item.data
        }
      }));
    } catch (error) {
      // Handle abort errors
      if (error.name === 'AbortError' || context.signal?.aborted) {
        return [];
      }

      // Log and return empty on error
      console.error('[CustomProvider] Search failed:', error);
      return [];
    }
  }

  scoreRelevance(item: MentionCandidate, context: SearchContext): number {
    let score = 0.5;

    // Boost based on your criteria
    if (item.meta?.customField === 'important') {
      score += 0.3;
    }

    return Math.min(score, 1);
  }

  private async fetchCustomData(query: string, context: SearchContext) {
    // Your data fetching logic
    return [];
  }

  private calculateScore(item: any, query: string): number {
    // Your scoring logic
    return 0.5;
  }
}
```

### Registering a Provider

```typescript
import { providerRegistry } from '$lib/services/mentions/providers';
import { CustomProvider } from './custom-provider';

// Register the provider
const customProvider = new CustomProvider();
providerRegistry.register(customProvider);

// Optionally set as default
providerRegistry.setDefault(['file', 'note', 'custom']);
```

### Provider Best Practices

1. **Always validate context**: Check for `workspaceId` and handle missing values
2. **Respect abort signals**: Check `context.signal?.aborted` before expensive operations
3. **Handle errors gracefully**: Return empty array instead of throwing
4. **Implement caching**: Cache results for synchronous access when possible
5. **Score relevance**: Implement `scoreRelevance` for better result ordering
6. **Provide fallbacks**: Return sensible defaults when search fails
7. **Validate results**: Ensure all returned candidates have required fields

## API Reference

### MentionSystem

The main service class for coordinating mention functionality.

#### Constructor

```typescript
new MentionSystem(config?: MentionSystemConfig)
```

**Config Options**:
```typescript
interface MentionSystemConfig {
  debounceMs?: number;          // Debounce delay (default: 300ms)
  maxResults?: number;          // Max results to return (default: 50)
  cacheMaxAge?: number;         // Cache TTL (default: 30000ms)
  enableSemantic?: boolean;     // Enable semantic search (default: false)
  enableLivePreview?: boolean;  // Enable live preview (default: true)
  enableCollaboration?: boolean; // Enable collaboration features (default: false)
}
```

#### Methods

##### search(query: string, context: SearchContext): Promise<MentionCandidate[]>

Asynchronous search for mention candidates. Performs debounced search with caching.

```typescript
const results = await mentionSystem.search('@README', {
  workspaceId: 'workspace-123',
  currentFile: 'src/index.ts'
});
```

**Returns**: Array of `MentionCandidate` objects sorted by relevance.

**Throws**: Logs errors but returns empty array on failure.

##### searchSync(query: string, context: SearchContext): MentionCandidate[]

Synchronous search using cached data. Used for TipTap compatibility.

```typescript
const results = mentionSystem.searchSync('@README', {
  workspaceId: 'workspace-123'
});
```

**Returns**: Cached results or default suggestions if no cache available.

##### resolve(uri: string): Promise<ResolveResult>

Resolves a mention URI to its content.

```typescript
const result = await mentionSystem.resolve('file:src/index.ts');
// Returns: { content: '...', metadata: {...} }
```

##### registerProvider(provider: Provider): void

Registers a new mention provider.

```typescript
mentionSystem.registerProvider(new CustomProvider());
```

##### registerResolver(resolver: Resolver): void

Registers a resolver for a specific URI scheme.

```typescript
mentionSystem.registerResolver(new CustomResolver());
```

##### getBreadcrumbController(): BreadcrumbController

Gets the breadcrumb navigation controller for hierarchical menus.

```typescript
const controller = mentionSystem.getBreadcrumbController();
controller.push(group);
```

### DebouncedSearchService

Handles debounced search with caching and cancellation.

#### Methods

##### search(query: string, providers: Provider[], context: SearchContext): Promise<MentionCandidate[]>

Performs debounced search across multiple providers.

**Features**:
- Automatic debouncing
- Request cancellation
- Result caching
- Retry logic (up to 2 retries)
- Result validation and deduplication

##### isLoading(): boolean

Returns whether a search is currently in progress.

##### clearCache(): void

Clears the search cache.

##### destroy(): void

Cancels pending searches and clears cache.

### BreadcrumbController

Manages hierarchical navigation in mention menus.

#### Properties

- `breadcrumbs`: Array of breadcrumb items
- `currentGroup`: Current group ID
- `currentItems`: Current items in view

#### Methods

##### push(group: MentionGroup): void

Navigates into a group.

```typescript
controller.push({
  id: 'files',
  label: 'Files',
  icon: '📁',
  items: [...]
});
```

##### pop(): boolean

Navigates back one level. Returns `false` if already at root.

##### navigateToRoot(): void

Navigates to the root level.

##### navigateToBreadcrumb(index: number): void

Navigates to a specific breadcrumb level.

##### handleKeyboard(event: KeyboardEvent): boolean

Handles keyboard navigation (ArrowLeft, Escape).

### ProviderRegistry

Manages provider registration and lookup.

#### Methods

##### register(provider: Provider): void

Registers a provider.

##### unregister(id: string): void

Unregisters a provider by ID.

##### get(id: string): Provider | undefined

Gets a provider by ID.

##### getAll(): Provider[]

Gets all registered providers.

##### getDefault(): Provider[]

Gets default providers (those with `default: true`).

##### getByTrigger(trigger: string): Provider[]

Gets providers that handle a specific trigger.

```typescript
const providers = providerRegistry.getByTrigger('@file');
```

### Utility Functions

#### toPromptToken(item: MentionCandidate): string

Converts a mention candidate to a prompt token string.

```typescript
import { toPromptToken } from '$lib/services/mentions/format';

const token = toPromptToken({
  type: 'file',
  id: 'src/index.ts',
  label: 'index.ts',
  meta: { fullPath: 'src/index.ts', range: { start: 10, end: 20 } }
});
// Returns: "@src/index.ts:L10-20"
```

#### getIconForType(type: string, subtype?: string): IconName

Gets the appropriate icon for a mention type.

```typescript
import { getIconForType } from '$lib/services/mentions/icon-map';

const icon = getIconForType('file', 'ts');
// Returns: "file-code"
```

## Usage Examples

### Example 1: Basic File Mention

```typescript
import { mentionSystem } from '$lib/services/mentions';

// Search for files
const files = await mentionSystem.search('@index', {
  workspaceId: 'workspace-123'
});

// Insert first result
if (files.length > 0) {
  const file = files[0];
  console.log(`Found: ${file.label} at ${file.meta?.path}`);
}
```

### Example 2: File with Line Range

```typescript
// Search for file with range
const results = await mentionSystem.search('@utils.ts', {
  workspaceId: 'workspace-123'
});

// Add range to mention
const mention = {
  ...results[0],
  meta: {
    ...results[0].meta,
    range: { start: 10, end: 20 }
  }
};

// Convert to prompt token
const token = toPromptToken(mention);
// Result: "@src/utils.ts:L10-20"
```

### Example 3: Custom Mention in Chat

```svelte
<script lang="ts">
  import RichTextarea from '$lib/components/chat/input/RichTextarea.svelte';
  import { workspace } from '$lib/stores/workspace';

  let value = '';
  let textarea;

  function handleSubmit() {
    const mentions = textarea.getMentions();
    const contextMentions = textarea.getContextMentions();

    console.log('Inline mentions:', mentions);
    console.log('Context mentions:', contextMentions);

    // Send to API with mentions
    sendMessage(value, { mentions, contextMentions });
  }
</script>

<RichTextarea
  bind:this={textarea}
  bind:value
  workspace={$workspace}
  placeholder="Type @ to mention files, notes, etc."
  onsubmit={handleSubmit}
/>
```

### Example 4: Programmatic Mention Insertion

```typescript
import { richTextarea } from './my-component';

// Insert a file mention
richTextarea.insertMention({
  id: 'file-src-utils',
  label: 'utils.ts',
  type: 'file',
  uri: 'file:src/utils.ts',
  meta: {
    path: 'src/utils.ts',
    language: 'typescript'
  }
});

// Insert a note mention
richTextarea.insertMention({
  id: 'note-spec',
  label: 'Spec',
  type: 'note',
  uri: 'note:spec',
  meta: {
    noteId: 'spec'
  }
});
```

### Example 5: Filtering by Type

```typescript
// Search only for notes
const notes = await mentionSystem.search('@meeting', {
  workspaceId: 'workspace-123'
});

// Filter results by type
const onlyNotes = notes.filter(item => item.type === 'note');
```

### Example 6: Context-Aware Search

```typescript
// Provide context for better results
const results = await mentionSystem.search('@component', {
  workspaceId: 'workspace-123',
  currentFile: 'src/pages/Dashboard.svelte',
  recentFiles: [
    'src/components/Header.svelte',
    'src/components/Sidebar.svelte'
  ],
  imports: [
    'src/lib/utils.ts',
    'src/lib/api.ts'
  ]
});

// Results will be scored higher for:
// - Files in same directory as currentFile
// - Files in recentFiles
// - Files in imports
```

### Example 7: Hierarchical Navigation

```typescript
import { mentionSystem } from '$lib/services/mentions';

const controller = mentionSystem.getBreadcrumbController();

// Navigate into a group
controller.push({
  id: 'files',
  label: 'Files',
  icon: '📁',
  items: fileItems
});

// Navigate deeper
controller.push({
  id: 'src',
  label: 'src',
  icon: '📂',
  items: srcItems
});

// Navigate back
controller.pop();

// Navigate to root
controller.navigateToRoot();

// Get current path
const path = controller.getCurrentPath();
// Returns: "Files › src"
```

## Testing

### Test Page

The mention system includes a standalone test page for development and QA:

**URL**: `http://localhost:5177/test-mentions`

**Features**:
- Mock data for all mention types
- Interactive controls for testing states
- Preview panel testing
- Keyboard navigation testing
- No IPC/Electron dependencies

**Usage**:

```bash
cd experimental/amelia/workspaces
pnpm dev:renderer
# Navigate to http://localhost:5177/test-mentions
```

### Test Controls

The test page provides:

1. **Show/Hide Menu**: Toggle mention dropdown visibility
2. **Show/Hide Preview**: Toggle preview panel
3. **Search Input**: Filter mentions by text
4. **Type Filter**: Filter by specific mention type
5. **Test States**: Quick buttons for edge cases
   - Reset: Clear all filters
   - Empty State: Show no results
   - Groups State: Show grouped results

### Compact Mode Testing

Test the compact workspace initializer mention behavior:

**URL**: `http://localhost:5177/test-mentions/compact`

**Features**:
- Tests mention behavior without workspace context
- Tests default suggestions
- Tests mention extraction
- Tests inline image handling

### Unit Testing

Example unit test for a custom provider:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CustomProvider } from './custom-provider';

describe('CustomProvider', () => {
  it('should return results for valid query', async () => {
    const provider = new CustomProvider();
    const results = await provider.search('test', {
      workspaceId: 'workspace-123'
    });

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('type');
    expect(results[0]).toHaveProperty('uri');
  });

  it('should handle abort signal', async () => {
    const provider = new CustomProvider();
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    const results = await provider.search('test', {
      workspaceId: 'workspace-123',
      signal: controller.signal
    });

    expect(results).toEqual([]);
  });

  it('should return empty array on error', async () => {
    const provider = new CustomProvider();

    // Mock error
    vi.spyOn(provider as any, 'fetchCustomData').mockRejectedValue(
      new Error('Network error')
    );

    const results = await provider.search('test', {
      workspaceId: 'workspace-123'
    });

    expect(results).toEqual([]);
  });
});
```

### Integration Testing

Test the full mention flow:

```typescript
import { describe, it, expect } from 'vitest';
import { MentionSystem } from '$lib/services/mentions';
import { FileProvider } from '$lib/services/mentions/providers';

describe('MentionSystem Integration', () => {
  it('should search across multiple providers', async () => {
    const system = new MentionSystem();

    const results = await system.search('@test', {
      workspaceId: 'workspace-123'
    });

    // Should include results from file, note, and other providers
    const types = new Set(results.map(r => r.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('should cache results', async () => {
    const system = new MentionSystem();

    // First search
    const results1 = await system.search('@test', {
      workspaceId: 'workspace-123'
    });

    // Second search (should use cache)
    const results2 = system.searchSync('@test', {
      workspaceId: 'workspace-123'
    });

    expect(results2).toEqual(results1);
  });
});
```

## Troubleshooting

### Common Issues

#### 1. Mention dropdown not appearing

**Symptoms**: Typing `@` doesn't show the mention dropdown.

**Possible Causes**:
- TipTap editor not properly configured
- Mention extension not registered
- Workspace context missing

**Solutions**:

```typescript
// Ensure Mention extension is configured
import { Mention } from '@tiptap/extension-mention';

const editor = new Editor({
  extensions: [
    Mention.configure({
      suggestion: mentionSuggestion // Must be configured
    })
  ]
});

// Ensure workspace context is provided
const context = {
  workspaceId: workspace?.id // Check this is not undefined
};
```

#### 2. No results returned

**Symptoms**: Mention dropdown appears but shows no results.

**Possible Causes**:
- Invalid workspace ID
- Provider search failing
- Cache issues
- Network/IPC errors

**Solutions**:

```typescript
// Check workspace ID
console.log('Workspace ID:', context.workspaceId);

// Check provider registration
const providers = providerRegistry.getAll();
console.log('Registered providers:', providers.map(p => p.id));

// Clear cache
mentionSystem.searchService.clearCache();

// Check browser console for errors
// Look for: [FileProvider], [NoteProvider], [SearchService] logs
```

#### 3. Stale results

**Symptoms**: Search results don't reflect recent file changes.

**Possible Causes**:
- Cache not invalidated
- Provider cache not refreshed

**Solutions**:

```typescript
// Clear search cache
mentionSystem.searchService.clearCache();

// For NoteProvider, cache refreshes every 5 seconds automatically
// For FileProvider, results come from IPC which should be fresh

// Force refresh by changing query slightly
```

#### 4. Slow search performance

**Symptoms**: Mention dropdown takes too long to appear.

**Possible Causes**:
- Debounce delay too high
- Too many providers
- Expensive provider operations
- No caching

**Solutions**:

```typescript
// Reduce debounce delay
const system = new MentionSystem({
  debounceMs: 150 // Default is 300ms
});

// Limit max results
const system = new MentionSystem({
  maxResults: 20 // Default is 50
});

// Implement caching in custom providers
class CustomProvider implements Provider {
  private cache = new Map();

  async search(query: string, context: SearchContext) {
    const cacheKey = `${context.workspaceId}:${query}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const results = await this.fetchData(query, context);
    this.cache.set(cacheKey, results);
    return results;
  }
}
```

#### 5. Memory leaks

**Symptoms**: Memory usage grows over time.

**Possible Causes**:
- Cache not bounded
- Event listeners not cleaned up
- Abort controllers not released

**Solutions**:

```typescript
// MentionSystem already implements LRU cache with limits
// MAX_CACHE_SIZE = 100 entries
// CACHE_CLEANUP_TARGET = 50 entries after cleanup

// Ensure cleanup on component unmount
onDestroy(() => {
  mentionSystem.searchService.destroy();
});

// For custom providers, implement cleanup
class CustomProvider implements Provider {
  private cache = new Map();

  destroy() {
    this.cache.clear();
  }
}
```

#### 6. Invalid mention candidates

**Symptoms**: Console warnings about invalid candidates being filtered.

**Possible Causes**:
- Provider returning incomplete data
- Missing required fields

**Solutions**:

```typescript
// Ensure all required fields are present
function isValidMentionCandidate(candidate: any): boolean {
  return !!(
    candidate &&
    candidate.id &&
    candidate.label &&
    candidate.type &&
    candidate.uri
  );
}

// Validate in your provider
async search(query: string, context: SearchContext) {
  const results = await this.fetchData(query, context);

  return results.filter(item => {
    if (!isValidMentionCandidate(item)) {
      console.warn('[CustomProvider] Invalid candidate:', item);
      return false;
    }
    return true;
  });
}
```

#### 7. Breadcrumb navigation not working

**Symptoms**: Can't navigate into groups or back.

**Possible Causes**:
- BreadcrumbController not initialized
- Groups not properly structured
- Keyboard events not handled

**Solutions**:

```typescript
// Ensure controller is initialized
const controller = mentionSystem.getBreadcrumbController();

// Ensure groups have required structure
const group: MentionGroup = {
  id: 'unique-id',
  label: 'Display Name',
  icon: '📁',
  items: [...] // Must have items or subgroups
};

// Handle keyboard events in component
function handleKeyDown(event: KeyboardEvent) {
  if (controller.handleKeyboard(event)) {
    // Controller handled the event
    return;
  }
  // Handle other keys
}
```

### Debugging Tips

#### Enable Debug Logging

```typescript
import { logger } from '$lib/utils/client-logger';

// Set log level to debug
logger.setLevel('debug');

// Look for these log prefixes:
// [MentionSystem] - Main system operations
// [SearchService] - Search coordination
// [FileProvider] - File search operations
// [NoteProvider] - Note search operations
// [BreadcrumbController] - Navigation operations
```

#### Inspect Search Context

```typescript
// Log the context being used
const context = {
  workspaceId: workspace?.id,
  currentFile: currentFile,
  recentFiles: recentFiles
};
console.log('Search context:', context);

// Verify workspace ID is valid
if (!context.workspaceId) {
  console.error('Missing workspace ID!');
}
```

#### Monitor Cache

```typescript
// Check cache size
const cacheSize = mentionSystem.cachedResults.size;
console.log('Cache entries:', cacheSize);

// Clear cache to test fresh results
mentionSystem.searchService.clearCache();
```

#### Test Providers Individually

```typescript
// Test a specific provider
const fileProvider = providerRegistry.get('file');
const results = await fileProvider.search('test', {
  workspaceId: 'workspace-123'
});
console.log('File provider results:', results);
```

### Performance Considerations

1. **Debouncing**: Default 300ms prevents excessive searches during typing
2. **Caching**: LRU cache with 100 entry limit, 5-second TTL
3. **Abort Signals**: Cancels outdated searches automatically
4. **Result Limits**: Default 50 results max per search
5. **Retry Logic**: Up to 2 retries with 500ms delay for failed providers
6. **Validation**: Invalid results filtered before display

### Known Limitations

1. **Workspace Required**: Most providers require a valid workspace ID
2. **No Offline Support**: Providers depend on IPC/API calls
3. **Cache Invalidation**: Manual cache clearing may be needed for some updates
4. **Provider Isolation**: Providers can't share state directly
5. **Synchronous Search**: `searchSync` only returns cached results
6. **Range Support**: Not all providers support line/range selection

### Getting Help

1. **Check Console**: Look for error messages and warnings
2. **Test Page**: Use `/test-mentions` to isolate issues
3. **Provider Logs**: Enable debug logging for specific providers
4. **Cache Clear**: Try clearing cache to rule out stale data
5. **Minimal Reproduction**: Test with minimal configuration

## Additional Resources

### Related Files

- `mention-system.ts` - Main system implementation
- `search-service.ts` - Debounced search with caching
- `providers/index.ts` - Provider implementations
- `types.ts` - Type definitions
- `format.ts` - Prompt token formatting
- `icon-map.ts` - Icon mappings
- `breadcrumb-controller.svelte.ts` - Navigation controller

### UI Components

- `EnhancedMentionList.svelte` - Main mention dropdown
- `TipTapEditor.svelte` - TipTap integration
- `RichTextarea.svelte` - Rich text input with mentions

### Test Pages

- `/test-mentions` - Standalone test page
- `/test-mentions/compact` - Compact mode testing

### Type Definitions

See `types.ts` for complete type definitions:
- `MentionCandidate`
- `MentionType`
- `SearchContext`
- `Provider`
- `Resolver`
- `MentionGroup`
- `MentionMeta`

---

**Last Updated**: 2024
**Version**: 1.0
**Maintainer**: Augment Team
