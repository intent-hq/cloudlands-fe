import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const consumerFiles = [
  'src/features/agent/components/agent-avatar/AgentAvatarCatalog.svelte',
  'src/features/agent/components/agent-avatar/AgentAvatarWithState.svelte',
  'src/features/agent/components/agent-avatar/__tests__/AgentAvatarWaitingHost.svelte',
  'src/features/file-tracking/components/diff/PatchBlockContent.svelte',
  'src/features/layout/components/panel-tabs/Tab.svelte',
  'src/features/log/components/ActivityTimeline.svelte',
  'src/features/log/components/ActivityTimelineItem.svelte',
  'src/lib/components/CommandPalette.svelte',
  'src/lib/components/agent-overview/AgentHierarchyCard.svelte',
  'src/lib/components/agent-overview/AgentHierarchyGraph.svelte',
  'src/lib/components/agent-overview/AgentNodeCard.svelte',
  'src/lib/components/agent-overview/BackgroundAgentCard.svelte',
  'src/lib/components/chat/AgentCard.svelte',
  'src/lib/components/chat/AgentMessageAttributionHeader.svelte',
  'src/lib/components/chat/AgentsList.svelte',
  'src/lib/components/chat/ChatChangesPanel.svelte',
  'src/lib/components/chat/DelegationGroupSection.svelte',
  'src/lib/components/chat/EventWakeupBanner.svelte',
  'src/lib/components/chat/InlineAgentAvatar.svelte',
  'src/lib/components/chat/RegularAgentWelcome.svelte',
  'src/lib/components/chat/SpecialistDropdown.svelte',
  'src/lib/components/chat/SpecialistSwitcher.svelte',
  'src/lib/components/chat/ToolDetails.svelte',
  'src/lib/components/chat/input/EnhancedMentionList.svelte',
  'src/lib/components/file-explorer/VirtualizedFileTree.svelte',
  'src/lib/components/file-tracking/TreeNode.svelte',
  'src/lib/components/layout/panel-system/PanelTabBar.svelte',
  'src/lib/components/notes/primitives/AgentActionBlock.svelte',
  'src/lib/components/notes/primitives/CliBlock.svelte',
  'src/lib/components/notes/primitives/DiagramBlock.svelte',
  'src/lib/components/notes/primitives/ReferenceBlock.svelte',
  'src/lib/components/settings/AIBehaviorSidebar.svelte',
  'src/lib/components/shared/AgentAttributionBadge.svelte',
  'src/lib/components/terminal/TerminalSidebar.svelte',
  'src/lib/components/tiptap/LineAttributionGutter.svelte',
  'src/lib/components/tiptap/TaskAgentStatus.svelte',
  'src/lib/components/tiptap/comments/AgentPeekCard.svelte',
  'src/lib/components/workspace/MultiSelectTabbedSidebar.svelte',
  'src/lib/components/workspace/NoteMetadataBar.svelte',
  'src/lib/components/workspace/TaskProgressBar.svelte',
  'src/lib/components/workspace/WorkspaceHoverCard.svelte',
  'src/lib/components/workspace/initializer/InitialAgentPicker.svelte',
  'src/lib/components/workspace/initializer/SetupScriptAgent.svelte',
  'src/lib/components/workspace/sidebar/ActivityLogPreview.svelte',
  'src/lib/components/workspace/sidebar/CommitsTimeline.svelte',
  'src/lib/components/workspace/sidebar/FileChangesSection.svelte',
  'src/lib/components/workspace/sidebar/NotesPanel.svelte',
  'src/lib/components/workspace/sidebar/SecondaryRootChangesView.svelte',
  'src/lib/components/workspace/sidebar/SidebarActivityPanel.svelte',
] as const;

const overflowFiles = [
  'src/features/agent/components/agent-avatar/AgentAvatarStack.svelte',
  'src/lib/components/workspace/sidebar/NotesPanel.svelte',
] as const;

const canonicalStackConsumers = [
  'src/features/agent/components/agent-avatar/AgentAvatarCatalog.svelte',
  'src/features/layout/components/panel-tabs/Tab.svelte',
  'src/lib/components/chat/AgentSubscriptions.svelte',
  'src/lib/components/chat/DelegationGroupSection.svelte',
  'src/lib/components/chat/EventWakeupBanner.svelte',
  'src/lib/components/workspace/MultiSelectTabbedSidebar.svelte',
] as const;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function productionSvelteFiles(directory = 'src'): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return productionSvelteFiles(path);
      return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : [];
    },
  );
}

describe('agent avatar overlay inventory', () => {
  it('keeps every audited consumer on the icon-free canonical avatar surface', () => {
    expect(consumerFiles).toHaveLength(49);
    for (const path of consumerFiles) {
      const contents = source(path);
      expect(contents, path).not.toContain('/auggie-avatar/');
      expect(contents, path).not.toContain('data-avatar-overlay');
      expect(contents, path).not.toContain('status-indicator absolute');
      expect(contents, path).not.toContain('>★<');
    }
  });

  it('keeps every production runtime consumer behind the canonical compatibility boundary', () => {
    const runtimeConsumers = productionSvelteFiles().filter((path) => {
      const contents = source(path);
      return contents.includes('agent-avatar/') || contents.includes('data-agent-avatar');
    });

    expect(runtimeConsumers.length).toBeGreaterThanOrEqual(consumerFiles.length - 5);
    for (const path of runtimeConsumers) {
      const contents = source(path);
      expect(contents, path).not.toContain('/auggie-avatar/');
      expect(contents, path).not.toContain('/ui/agent-avatar/');
      expect(contents, path).not.toContain('data-avatar-overlay');
    }
  });

  it('resolves message-card identity from the live sender and uses named canonical geometry', () => {
    const contents = source('src/lib/components/chat/AgentMessageAttributionHeader.svelte');
    expect(contents).toContain('selectAgentSession(attribution.fromAgentId)');
    expect(contents).toContain('data-agent-message-leading-identity');
    expect(contents).toMatch(
      /<AgentAvatar[\s\S]*specialist=\{senderSpecialist\}[\s\S]*variant="standard"/,
    );
    expect(contents).not.toMatch(/<AgentAvatar[\s\S]{0,180}\bsize=/);
  });

  it('keeps every avatar-stack overflow count filled and rounded', () => {
    for (const path of overflowFiles) {
      const contents = source(path);
      expect(contents, path).toContain('data-agent-avatar-overflow');
      expect(contents, path).toMatch(/(?:text-xs|font-size:\s*0\.(?:6875|75)rem)/);
      expect(contents, path).toMatch(/(?:bg-muted|background:\s*hsl\(var\(--muted\)\))/);
      expect(contents, path).toMatch(/(?:rounded|border-radius)/);
    }
  });

  it('routes shared stack consumers through the canonical geometry primitive', () => {
    for (const path of canonicalStackConsumers) {
      const contents = source(path);
      expect(contents, path).toContain('<AgentAvatarStack');
      expect(contents, path).not.toMatch(/-space-x-|margin-inline-start:\s*calc\(-1/);
    }
  });

  it('keeps subscription and sidebar summaries on the same adaptive stack contract', () => {
    const subscription = source('src/lib/components/chat/AgentSubscriptions.svelte');
    const sidebar = source('src/lib/components/workspace/MultiSelectTabbedSidebar.svelte');
    for (const contents of [subscription, sidebar]) {
      expect(contents).toContain('<AgentAvatarStack');
      expect(contents).toContain('adaptive');
      expect(contents).not.toMatch(/-space-x-|margin-inline-start:\s*calc\(-1/);
    }
    expect(sidebar).toContain('itemContent={launcherAgentAvatar}');
    expect(sidebar).toContain('<AgentAvatarWithState');
    expect(sidebar).not.toContain('data-sidebar-agent-overflow');
  });

  it('uses parent-revealing participant cutouts without stack separator colors or icons', () => {
    const contents = source('src/features/agent/components/agent-avatar/AgentAvatarStack.svelte');
    expect(contents).toContain('mask-image: url(');
    expect(contents).toContain('border-radius: var(--agent-avatar-corner-radius)');
    expect(contents).not.toContain('radial-gradient');
    expect(contents).toContain('z-index: ${index + 1}');
    expect(contents).toContain('agent-avatar-stack-item--before-overflow');
    expect(contents).toContain('min-width: var(--agent-avatar-surface-size)');
    expect(contents).toContain('font-size: 0.75rem');
    expect(contents).toContain("x='17' y='-1' width='26' height='26'");
    expect(contents).not.toContain('svelte-fa');
    expect(contents).not.toContain('stack-icon');
    expect(contents).not.toMatch(/agent-avatar-stack-item[\s\S]{0,500}\bborder:/);
  });
});
