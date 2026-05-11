/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

import TaskStatusIcon from '../TaskStatusIcon.svelte';

function renderTitle(status: unknown) {
  const { container } = render(TaskStatusIcon, { props: { status } });
  const button = container.querySelector('button.task-status-icon');

  expect(button).not.toBeNull();
  return button!.getAttribute('title');
}

describe('TaskStatusIcon', () => {
  afterEach(() => cleanup());

  it.each([
    ['not_started', 'Status: not started'],
    ['in_progress', 'Status: in progress'],
    ['complete', 'Status: complete'],
    ['waiting', 'Status: waiting'],
    ['discussion_needed', 'Status: discussion needed'],
    ['review_required', 'Status: review required'],
    ['cancelled', 'Status: cancelled'],
    ['todo', 'Status: not started'],
    ['in-progress', 'Status: in progress'],
    ['done', 'Status: complete'],
  ])('normalizes %s to %s', (status, expectedTitle) => {
    expect(renderTitle(status)).toBe(expectedTitle);
  });

  it.each([null, undefined, { status: 'complete' }, 'unexpected'])(
    'falls back to unknown for invalid status %#',
    (status) => {
      expect(renderTitle(status)).toBe('Status: unknown');
    },
  );
});