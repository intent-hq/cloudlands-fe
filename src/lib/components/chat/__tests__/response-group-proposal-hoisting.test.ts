import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import type { ContentBlockGroup } from '$lib/utils/messageParser';
import {
  hoistProposalBlocksFromResponseGroups,
  normalizeResponseGroups,
} from '../response-group-blocks';

function proposal(id: string): Proposal {
  return {
    kind: 'workspace-create',
    applyToolCallId: id,
    payload: { operation: 'workspace.create', params: { title: id } },
    preview: { title: id },
  };
}

function group(children: ContentBlock[]): ContentBlockGroup {
  return { type: 'content_group', name: 'Working', isStreaming: false, children };
}

describe('response group proposal hoisting', () => {
  it.each(['resource', 'legacy'] as const)(
    'hoists a %s proposal between ordered group segments',
    (shape) => {
      const before = { type: 'text', text: 'Before proposal' } as ContentBlock;
      const after = { type: 'text', text: 'After proposal' } as ContentBlock;
      const value = proposal(shape);
      const proposalBlock =
        shape === 'resource'
          ? ({
              type: 'resource',
              resource: createProposalResource(value),
            } as unknown as ContentBlock)
          : ({ type: 'proposal', proposal: value } as ContentBlock);

      expect(normalizeResponseGroups([group([before, proposalBlock, after])])).toEqual([
        group([before]),
        proposalBlock,
        group([after]),
      ]);
    },
  );

  it('leaves non-proposal resource blocks inside their group', () => {
    const resource = {
      type: 'resource',
      resource: { uri: 'intent://local/file/readme.txt', mimeType: 'text/plain', text: 'readme' },
    } as unknown as ContentBlock;
    const grouped = group([{ type: 'text', text: 'Before resource' }, resource] as ContentBlock[]);

    expect(hoistProposalBlocksFromResponseGroups([grouped])).toEqual([grouped]);
  });
});
