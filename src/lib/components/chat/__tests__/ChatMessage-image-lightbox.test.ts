import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: vi.fn(),
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: Object.assign(
    () => ({
      subscribe: (run: (value: string | null) => void) => {
        run(null);
        return () => {};
      },
    }),
    { select: () => null },
  ),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: any[]) => void) => {
        run([]);
        return () => {};
      },
    }),
    { select: () => [] },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: any) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

import ChatMessage from '../ChatMessage.svelte';

describe('ChatMessage image lightbox', () => {
  const mockImageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const mockImageMimeType = 'image/png';

  function createMessageWithImage(): AgentMessage {
    return {
      id: 'msg-1',
      role: 'user',
      contentBlocks: [
        { type: 'text', text: 'Here is an image:' },
        { type: 'image', data: mockImageData, mimeType: mockImageMimeType },
      ],
      timestamp: new Date('2024-01-01T12:00:00Z'),
    };
  }

  function createMessageWithMultipleImages(): AgentMessage {
    return {
      id: 'msg-2',
      role: 'user',
      contentBlocks: [
        { type: 'text', text: 'Here are two images:' },
        { type: 'image', data: mockImageData, mimeType: mockImageMimeType },
        { type: 'image', data: mockImageData, mimeType: mockImageMimeType },
      ],
      timestamp: new Date('2024-01-01T12:00:00Z'),
    };
  }

  it('opens lightbox when image thumbnail is clicked', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    // Find the image button
    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });
    expect(imageButton).toBeTruthy();

    // Click the image
    await fireEvent.click(imageButton);

    // Check if lightbox dialog appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('opens lightbox with Enter key', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });

    // Press Enter key
    await fireEvent.keyDown(imageButton, { key: 'Enter' });

    // Check if lightbox appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('opens lightbox with Space key', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });

    // Press Space key
    await fireEvent.keyDown(imageButton, { key: ' ' });

    // Check if lightbox appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('closes lightbox when Escape is pressed', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });
    await fireEvent.click(imageButton);

    // Wait for lightbox to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Press Escape
    await fireEvent.keyDown(window, { key: 'Escape' });

    // Lightbox should close
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeFalsy();
    });
  });

  it('closes lightbox when close button is clicked', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });
    await fireEvent.click(imageButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Click close button
    const closeButton = screen.getByRole('button', { name: /close preview/i });
    await fireEvent.click(closeButton);

    // Lightbox should close
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeFalsy();
    });
  });

  it('closes lightbox when backdrop is clicked', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });
    await fireEvent.click(imageButton);

    // Wait for lightbox to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Click the backdrop (dialog element itself)
    const dialog = screen.getByRole('dialog', { name: /image preview/i });
    await fireEvent.click(dialog);

    // Lightbox should close and focus should return to image button
    await waitFor(() => {
      const dialogAfter = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialogAfter).toBeFalsy();
      expect(document.activeElement).toBe(imageButton);
    });
  });

  it('returns focus to image button when closed via Escape', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });
    await fireEvent.click(imageButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close via Escape
    await fireEvent.keyDown(window, { key: 'Escape' });

    // Wait for lightbox to close and check focus returned
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(imageButton);
    });
  });

  it('returns focus to image button when closed via X button', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', { name: /view attached image full size/i });
    await fireEvent.click(imageButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close via X button
    const closeButton = screen.getByRole('button', { name: /close preview/i });
    await fireEvent.click(closeButton);

    // Wait for lightbox to close and check focus returned
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(imageButton);
    });
  });

  it('handles multiple images in a single message', async () => {
    const message = createMessageWithMultipleImages();
    render(ChatMessage, { props: { message } });

    // Should have two image buttons
    const imageButtons = screen.getAllByRole('button', { name: /view attached image full size/i });
    expect(imageButtons).toHaveLength(2);

    // Click the first image
    await fireEvent.click(imageButtons[0]);

    // Lightbox should open
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close it
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
    });

    // Click the second image
    await fireEvent.click(imageButtons[1]);

    // Lightbox should open again
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Focus should return to second button when closed
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(imageButtons[1]);
    });
  });
});
