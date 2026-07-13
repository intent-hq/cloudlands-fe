<script lang="ts">
  import EnhancedMentionList from '$lib/components/chat/input/EnhancedMentionList.svelte';
  import type { MentionCandidate, MentionGroup, MentionType } from '$lib/services/mentions/types';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('TestMentions');

  // State for testing different scenarios
  let showMenu = $state(true);
  let selectedMentionType = $state<'all' | MentionType>('all');
  let searchQuery = $state('');
  let selectedItem = $state<MentionCandidate | null>(null);

  // Mock data for all mention types
  const mockMentions: MentionCandidate[] = [
    // Files
    {
      id: 'file-1',
      type: 'file',
      label: 'SimpleRichInput.svelte',
      subtitle: 'src/lib/components/chat/input',
      description: 'Main input component with mention support',
      icon: '📄',
      uri: 'devspace://file/src/lib/components/chat/input/SimpleRichInput.svelte',
      meta: { path: 'src/lib/components/chat/input/SimpleRichInput.svelte', language: 'svelte' },
      group: 'Files',
    },
    {
      id: 'file-2',
      type: 'file',
      label: 'mention-system.ts',
      subtitle: 'src/lib/services/mentions',
      description: 'Core mention system service',
      icon: '📄',
      uri: 'devspace://file/src/lib/services/mentions/mention-system.ts',
      meta: { path: 'src/lib/services/mentions/mention-system.ts', language: 'typescript' },
      group: 'Files',
    },
    // Folders
    {
      id: 'folder-1',
      type: 'folder',
      label: 'src',
      subtitle: 'Root source directory',
      description: 'Main source code directory',
      icon: '📁',
      uri: 'devspace://folder/src',
      meta: { path: 'src', fileCount: 150 },
      group: 'Folders',
    },
    {
      id: 'folder-2',
      type: 'folder',
      label: 'components',
      subtitle: 'src/lib/components',
      description: 'Reusable UI components',
      icon: '📁',
      uri: 'devspace://folder/src/lib/components',
      meta: { path: 'src/lib/components', fileCount: 45 },
      group: 'Folders',
    },
    // Notes
    {
      id: 'note-1',
      type: 'note',
      label: 'Architecture Overview',
      subtitle: 'Design documentation',
      description: 'High-level system architecture and design decisions',
      icon: '📝',
      uri: 'devspace://note/arch-overview',
      meta: { preview: 'The system follows a modular architecture...' },
      group: 'Notes',
    },
    {
      id: 'note-2',
      type: 'note',
      label: 'Meeting Notes - 2024-01-15',
      subtitle: 'Team sync',
      description: 'Weekly team meeting notes and action items',
      icon: '📝',
      uri: 'devspace://note/meeting-2024-01-15',
      group: 'Notes',
    },
    // Tasks
    {
      id: 'task-1',
      type: 'task',
      label: 'Implement authentication',
      subtitle: 'in_progress • John Doe',
      description: 'Add OAuth2 authentication flow',
      icon: '📋',
      uri: 'devspace://task/task-1',
      meta: { taskStatus: 'in_progress', assignee: 'John Doe' },
      group: 'Tasks',
    },
    {
      id: 'task-2',
      type: 'task',
      label: 'Write integration tests',
      subtitle: 'not_started • Jane Smith',
      description: 'Add comprehensive integration test suite',
      icon: '📋',
      uri: 'devspace://task/task-2',
      meta: { taskStatus: 'not_started', assignee: 'Jane Smith' },
      group: 'Tasks',
    },
    {
      id: 'task-3',
      type: 'task',
      label: 'Deploy to production',
      subtitle: 'completed • Bob Johnson',
      description: 'Production deployment completed successfully',
      icon: '📋',
      uri: 'devspace://task/task-3',
      meta: { taskStatus: 'completed', assignee: 'Bob Johnson' },
      group: 'Tasks',
    },
    // Personalities
    {
      id: 'personality-1',
      type: 'personality',
      label: 'Code Reviewer',
      subtitle: 'Expert code review assistant',
      description: 'Provides detailed code reviews with best practices',
      icon: '🤖',
      uri: 'devspace://personality/code-reviewer',
      group: 'Personalities',
    },
    {
      id: 'personality-2',
      type: 'personality',
      label: 'Documentation Writer',
      subtitle: 'Technical writing specialist',
      description: 'Helps write clear and comprehensive documentation',
      icon: '🤖',
      uri: 'devspace://personality/doc-writer',
      group: 'Personalities',
    },
    // Rules
    {
      id: 'rule-1',
      type: 'rule',
      label: 'Frontend Rules',
      subtitle: '.augment/rules/frontend.md',
      description: 'Frontend development guidelines and best practices',
      icon: '📚',
      uri: 'devspace://rule/frontend.md',
      meta: { path: '.augment/rules/frontend.md' },
      group: 'Rules',
    },
    {
      id: 'rule-2',
      type: 'rule',
      label: 'Python Rules',
      subtitle: '.augment/rules/python.md',
      description: 'Python coding standards and conventions',
      icon: '📚',
      uri: 'devspace://rule/python.md',
      meta: { path: '.augment/rules/python.md' },
      group: 'Rules',
    },
  ];

  // Mock groups for testing breadcrumb navigation
  const mockGroups: MentionGroup[] = [
    {
      id: 'group-files',
      label: 'Recent Files',
      icon: '📁',
      items: mockMentions.filter((m) => m.type === 'file'),
    },
    {
      id: 'group-tasks',
      label: 'My Tasks',
      icon: '📋',
      items: mockMentions.filter((m) => m.type === 'task'),
    },
  ];

  // Filtered items based on search and type
  const filteredItems = $derived.by(() => {
    let items: MentionCandidate[] = [...mockMentions];

    // Filter by type
    if (selectedMentionType !== 'all') {
      items = items.filter((item) => item.type === selectedMentionType);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          item.label.toLowerCase().includes(query) ||
          item.subtitle?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query),
      );
    }

    return items;
  });

  // Handle mention selection
  function handleCommand(item: MentionCandidate) {
    logger.info('Mention selected:', item);
    selectedItem = item;
  }

  // Reset state
  function reset() {
    searchQuery = '';
    selectedMentionType = 'all';
    selectedItem = null;
  }

  // Test different states
  function loadEmptyState() {
    searchQuery = 'zzzzzzzzz'; // No matches
  }

  function loadGroupsState() {
    // This would show groups in the real implementation
    logger.info('Groups state - would show:', mockGroups);
  }
</script>

<div class="test-mentions-page">
  <div class="header">
    <h1>Mention System Test Page</h1>
    <p class="subtitle">
      Standalone browser-only test page for all mention system states and interactions
    </p>
  </div>

  <div class="content">
    <!-- Controls Panel -->
    <div class="controls-panel">
      <h2>Controls</h2>

      <div class="control-group">
        <label>
          <input type="checkbox" bind:checked={showMenu} />
          Show Mention Menu
        </label>
      </div>

      <div class="control-group">
        <label for="search">Search Query:</label>
        <input
          id="search"
          type="text"
          bind:value={searchQuery}
          placeholder="Type to filter mentions..."
          class="search-input"
        />
      </div>

      <div class="control-group">
        <label for="type-filter">Filter by Type:</label>
        <select id="type-filter" bind:value={selectedMentionType} class="type-select">
          <option value="all">All Types</option>
          <option value="file">Files</option>
          <option value="folder">Folders</option>
          <option value="note">Notes</option>
          <option value="task">Tasks</option>
          <option value="personality">Personalities</option>
          <option value="rule">Rules</option>
        </select>
      </div>

      <div class="control-group">
        <h3>Test States:</h3>
        <button onclick={reset} class="test-button">Reset</button>
        <button onclick={loadEmptyState} class="test-button">Empty State</button>
        <button onclick={loadGroupsState} class="test-button">Groups State</button>
      </div>

      <div class="control-group">
        <h3>Stats:</h3>
        <div class="stats">
          <div>Total mentions: {mockMentions.length}</div>
          <div>Filtered: {filteredItems.length}</div>
          <div>Selected: {selectedItem?.label || 'None'}</div>
        </div>
      </div>
    </div>

    <!-- Mention Menu Display -->
    <div class="mention-display">
      <h2>Mention Menu</h2>

      {#if showMenu}
        <div class="mention-wrapper">
          <EnhancedMentionList
            items={filteredItems}
            command={handleCommand}
          />
        </div>
      {:else}
        <div class="placeholder">
          <p>Menu hidden - check "Show Mention Menu" to display</p>
        </div>
      {/if}
    </div>
  </div>

  <!-- Selected Item Debug -->
  {#if selectedItem}
    <div class="debug-panel">
      <h3>Last Selected Item:</h3>
      <pre>{JSON.stringify(selectedItem, null, 2)}</pre>
    </div>
  {/if}
</div>

<style>
  .test-mentions-page {
    min-height: 100vh;
    padding: 2rem;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  .header {
    margin-bottom: 2rem;
  }

  .header h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: hsl(var(--muted-foreground));
    font-size: 0.875rem;
  }

  .content {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 2rem;
    max-width: 1400px;
  }

  .controls-panel {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0;
    padding: 1.5rem;
    height: fit-content;
  }

  .controls-panel h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .controls-panel h3 {
    font-size: 0.875rem;
    font-weight: 600;
    margin-top: 1rem;
    margin-bottom: 0.5rem;
    color: hsl(var(--muted-foreground));
  }

  .control-group {
    margin-bottom: 1rem;
  }

  .control-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .control-group input[type='checkbox'] {
    cursor: pointer;
  }

  .search-input,
  .type-select {
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.25rem;
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border));
    border-radius: 0;
    color: hsl(var(--foreground));
    font-size: 0.875rem;
  }

  .search-input:focus,
  .type-select:focus {
    outline: none;
    border-color: hsl(var(--primary));
  }

  .test-button {
    display: block;
    width: 100%;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    border: none;
    border-radius: 0;
    cursor: pointer;
    font-size: 0.875rem;
    transition: opacity 0.2s;
  }

  .test-button:hover {
    opacity: 0.9;
  }

  .stats {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.6;
  }

  .mention-display {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0;
    padding: 1.5rem;
  }

  .mention-display h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .mention-wrapper {
    display: inline-block;
    margin-top: 1rem;
  }

  .placeholder {
    padding: 3rem;
    text-align: center;
    color: hsl(var(--muted-foreground));
    background: hsl(var(--muted) / 0.2);
    border-radius: 0;
  }

  .debug-panel {
    margin-top: 2rem;
    padding: 1.5rem;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0;
    max-width: 1400px;
  }

  .debug-panel h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .debug-panel pre {
    background: hsl(var(--muted) / 0.3);
    padding: 1rem;
    border-radius: 0;
    overflow-x: auto;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  @media (max-width: 1024px) {
    .content {
      grid-template-columns: 1fr;
    }
  }
</style>
