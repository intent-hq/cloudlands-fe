<!-- Example usage of the List components for workspace sidebar -->
<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { ListContainer, ListItem, ListSection, ListEmpty } from './index';
  import {
    faStickyNote,
    faFile,
    faTerminal,
    faPlus,
    faStar,
  } from '@fortawesome/free-solid-svg-icons';
  import AuggieAvatar from '../auggie-avatar/AuggieAvatar.svelte';
  import { faNote } from '$lib/icons/faNote';

  // Example data
  let selectedNoteId = $state('note-1');
  let selectedAgentId = $state('agent-1');
  let collapsedSections = $state<Record<string, boolean>>({
    notes: false,
    agents: false,
    files: false,
  });

  const notes = [
    { id: 'spec', title: 'Spec', isSpec: true },
    { id: 'note-1', title: 'Project Overview' },
    { id: 'note-2', title: 'Meeting Notes' },
    { id: 'note-3', title: 'Todo List' },
  ];

  const agents = [
    { id: 'agent-1', name: 'Code Assistant', status: 'Active', lastMessage: 'Analyzing code...' },
    { id: 'agent-2', name: 'Test Runner', status: 'Idle', lastMessage: 'Last run: 5 min ago' },
  ];

  const files = [
    { id: 'file-1', name: 'index.ts', path: 'src/index.ts' },
    { id: 'file-2', name: 'App.svelte', path: 'src/App.svelte' },
    { id: 'file-3', name: 'utils.ts', path: 'src/lib/utils.ts' },
  ];

  const terminals = [
    { id: 'term-1', name: 'Terminal 1', lastCommand: 'npm run dev' },
    { id: 'term-2', name: 'Terminal 2', lastCommand: 'git status' },
  ];

  function handleNoteClick(noteId: string) {
    selectedNoteId = noteId;
    logger.info('Selected note:', noteId);
  }

  function handleAgentClick(agentId: string) {
    selectedAgentId = agentId;
    logger.info('Selected agent:', agentId);
  }

  function createNote() {
    logger.info('Create new note');
  }

  function toggleSection(section: string) {
    collapsedSections[section] = !collapsedSections[section];
  }
</script>

<div class="w-64 h-screen bg-background border-r p-2 space-y-4">
  <!-- Notes Section with ListSection wrapper -->
  <ListSection
    title="Notes"
    icon={faStickyNote}
    actionIcon={faPlus}
    actionLabel="Create Note"
    onAction={createNote}
    collapsible={true}
    collapsed={collapsedSections.notes}
    onToggleCollapse={() => toggleSection('notes')}
  >
    {#if notes.length === 0}
      <ListEmpty message="No notes yet" icon={faStickyNote} />
    {:else}
      <ListContainer spacing="compact">
        {#each notes as note (note.id)}
          <ListItem
            selected={selectedNoteId === note.id}
            icon={note.isSpec ? faStar : faNote}
            title={note.title}
            onclick={() => handleNoteClick(note.id)}
            size="sm"
          />
        {/each}
      </ListContainer>
    {/if}
  </ListSection>

  <!-- Agents Section -->
  <ListSection
    title="Agents"
    collapsible={true}
    collapsed={collapsedSections.agents}
    onToggleCollapse={() => toggleSection('agents')}
  >
    {#if agents.length === 0}
      <ListEmpty message="No agents running" />
    {:else}
      <ListContainer spacing="compact">
        {#each agents as agent (agent.id)}
          <ListItem
            selected={selectedAgentId === agent.id}
            iconComponent={AuggieAvatar}
            iconProps={{ agentId: agent.id, size: 16 }}
            title={agent.name}
            subtitle={agent.lastMessage}
            badge={agent.status}
            badgeClass={agent.status === 'Active' ? 'bg-green-500/20 text-green-500' : undefined}
            onclick={() => handleAgentClick(agent.id)}
            size="sm"
          />
        {/each}
      </ListContainer>
    {/if}
  </ListSection>

  <!-- Files Section (non-collapsible) -->
  <ListSection title="Files">
    {#if files.length === 0}
      <ListEmpty message="No files" icon={faFile} />
    {:else}
      <ListContainer spacing="normal">
        {#each files as file (file.name)}
          <ListItem icon={faFile} title={file.name} subtitle={file.path} size="sm" />
        {/each}
      </ListContainer>
    {/if}
  </ListSection>

  <!-- Terminals with different spacing -->
  <ListSection title="Terminals">
    <ListContainer spacing="relaxed">
      {#each terminals as terminal (terminal.name)}
        <ListItem
          icon={faTerminal}
          title={terminal.name}
          subtitle={terminal.lastCommand}
          size="md"
        />
      {/each}
    </ListContainer>
  </ListSection>
</div>
