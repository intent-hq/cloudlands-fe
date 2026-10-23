import { providerRegistry } from '$lib/services/mentions/providers';
import { DebouncedSearchService } from '$lib/services/mentions/search-service';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { store } from '$store/renderer/store';
import {
  discussionCandidateReference,
  discussionReferenceMarkdown,
  parseDiscussionReference,
  type DiscussionReference,
} from './discussion-references';

function optionsFromReferences(references: DiscussionReference[]) {
  return [...new Map(references.map((reference) => [reference.url, reference])).values()].map(
    (reference) => ({
      value: discussionReferenceMarkdown(reference),
      label: reference.label,
      description: reference.url,
    }),
  );
}

function workspacePullRequests(workspaceId: string, query = '') {
  const workspace = selectWorkspaceById.select(store.state, workspaceId);
  return (workspace?.pullRequests ?? []).flatMap((pr) => {
    const reference = parseDiscussionReference(pr.url, `#${pr.number} ${pr.title}`, workspaceId);
    return reference && (!query || reference.label.toLowerCase().includes(query.toLowerCase()))
      ? [reference]
      : [];
  });
}

/** Reuse mention providers and their cancellation, with plain-text discussion serialization. */
export function createDiscussionReferenceSearch() {
  const search = new DebouncedSearchService();
  return {
    destroy: () => search.destroy(),
    initial(workspaceId: string) {
      const agents = selectAllWorkspaceAgents
        .select(store.state, workspaceId)
        .filter((agent) => !agent.retiredAt)
        .flatMap((agent) => {
          const reference = parseDiscussionReference(
            `intent://local/${workspaceId}/agent/${agent.id}`,
            agent.name || agent.id,
            workspaceId,
          );
          return reference ? [reference] : [];
        });
      return optionsFromReferences([...agents, ...workspacePullRequests(workspaceId)]);
    },
    async search(query: string, workspaceId: string) {
      const providers = ['agent', 'file'].flatMap((kind) => {
        const provider = providerRegistry.get(kind);
        return provider ? [provider] : [];
      });
      const candidates = await search.search(query, providers, { workspaceId });
      const references = candidates.flatMap((candidate) => {
        const reference = discussionCandidateReference(candidate, workspaceId);
        return reference ? [reference] : [];
      });
      references.push(...workspacePullRequests(workspaceId, query));
      const pasted = parseDiscussionReference(query.trim(), query.trim(), workspaceId);
      if (pasted?.kind === 'pr') references.unshift(pasted);
      return optionsFromReferences(references);
    },
  };
}
