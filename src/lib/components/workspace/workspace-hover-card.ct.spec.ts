import { expect, test } from '../../../test/ct-test';
import WorkspaceHoverCardPreview from './workspace-hover-card.preview.svelte';
import {
  workspaceHoverCardPreview,
  type WorkspaceHoverCardPreviewProps,
} from './workspace-hover-card.preview-fixtures';

function fixture(stateName: string, cardKey?: string): WorkspaceHoverCardPreviewProps {
  const state = workspaceHoverCardPreview.states[stateName];
  if (!state) throw new Error(`Missing workspace hover-card fixture: ${stateName}`);
  const card = cardKey
    ? state.props.cards.find(({ key }) => key === cardKey)
    : state.props.cards[0];
  if (!card) throw new Error(`Missing workspace hover-card scenario: ${cardKey ?? stateName}`);
  return { ...state.props, cards: [card], setupData: true };
}

test('shows the real first question and its total count in the landscape activity column', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 560, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-question'),
  });
  const question = preview.locator('[data-workspace-hover-card-agent-context]');

  await expect(question).toHaveText('Which deployment region should receive the migration first?');
  const questionMeta = preview.locator('[data-workspace-hover-card-question-meta]');
  await expect(questionMeta.locator('[aria-hidden="true"]')).toHaveText('1/4');
  await expect(questionMeta).toHaveAccessibleName('Question 1 of 4');
  await expect(preview.locator('[data-workspace-hover-card-agent-preview]')).toHaveCount(0);
});

test('keeps activity sections accessible', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-wide'),
  });
  await expect(preview.locator('[data-workspace-hover-card] h3')).toHaveCount(0);
  await expect(preview.locator('[data-workspace-hover-card-activity]')).toHaveAccessibleName(
    'Agents',
  );
  await expect(preview.locator('[data-workspace-hover-card-pr-column]')).toHaveAccessibleName(
    'Pull requests',
  );
  await expect(preview.locator('[data-agent-group]')).toHaveCount(0);
});
