import { parseUiComponentMetadata } from './component-metadata';
import { principalAvatarFixtures } from './PrincipalAvatar.fixtures';

export const principalAvatarMetadata = parseUiComponentMetadata({
  id: 'principal-avatar',
  source: 'src/lib/components/ui/PrincipalAvatar.svelte',
  publicImport: '$lib/components/ui/PrincipalAvatar.svelte',
  legacyImports: [],
  exports: ['PrincipalAvatar'],
  category: 'primitive',
  owner: 'design-system',
  callers: [
    'src/features/notes/note-presence/NotePresenceAvatars.svelte',
    'src/features/presence/components/PresenceAvatarStack.svelte',
    'src/lib/component-catalog/renderers/PrincipalAvatarCatalogPreview.svelte',
    'src/lib/components/chat/ChatMessage.svelte',
    'src/lib/components/chat/QueuedMessageList.svelte',
    'src/lib/components/modals/ShareWorkspaceDialog.svelte',
    'src/lib/components/patterns/settings/custom-controls.ts',
    'src/lib/components/settings/HostedWorkspaceRoster.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/__tests__/PrincipalAvatar.test.ts',
  removalGate:
    'Retain while any principal renders an avatar; the raw avatar image audit stays at zero.',
  dynamicImports: [],
  useWhen: [
    'Show the avatar of a principal (a user, a workspace member, a message author) and fall back to the initial of their name when the image is missing or fails to load.',
    'Use fill inside a tile that owns the ring, background colour, and rounding, such as a presence stack.',
  ],
  dontUseWhen: [
    'Do not hand-roll an <img src={avatarUrl}>: it has no load-failure fallback and the raw avatar image audit rejects it.',
    'Do not use it for agents or providers; use the agent avatar and provider icon components instead.',
    'Do not rely on it for the accessible name: the image and the initial are aria-hidden, so the surrounding control or text must name the person.',
  ],
  usage: `<script lang="ts">
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
</script>

<PrincipalAvatar avatarUrl={member.avatarUrl} label={member.displayName ?? member.login ?? ''} size={24} />`,
  fixtures: principalAvatarFixtures,
});
