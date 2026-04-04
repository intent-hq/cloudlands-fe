/**
 * Agent Follow Saga
 *
 * Handles side effects for the agent-follow feature:
 * - Emitting window CustomEvents (follow, file-change, note-change, animation)
 * - Animation queue processing
 * - Auto-pause/resume timeouts
 * - Error recovery (animation queue overflow)
 */

import { call, delay, put, select, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  startFollowing,
  stopFollowing,
  pauseFollowing,
  resumeFollowing,
  setCurrentFile,
  setCurrentNote,
  queueTextAnimation,
  setIsAnimating,
} from "../agent-follow-slice";
import {
  selectIsFollowing,
  selectFollowedAgentId,
  selectAgentColor,
  selectIsPaused,
  selectCurrentFile,
  selectTypingSpeed,
} from "../agent-follow-selectors";

// ---------------------------------------------------------------------------
// Window event emitters
// ---------------------------------------------------------------------------

function emitFollowEvent(type: string, agentId: string | null, agentColor: any): void {
  window.dispatchEvent(
    new CustomEvent("agent-follow", {
      detail: { type, agent: agentId ? { id: agentId } : null, color: agentColor },
    }),
  );
}

function emitFileChangeEvent(file: string, agentId: string | null): void {
  window.dispatchEvent(
    new CustomEvent("agent-follow-file", {
      detail: { file, agentId },
    }),
  );
}

function emitNoteChangeEvent(noteId: string, agentId: string | null): void {
  window.dispatchEvent(
    new CustomEvent("agent-follow-note", {
      detail: { noteId, agentId },
    }),
  );
}

function emitAnimationEvent(details: {
  file: string;
  content: string;
  isAddition: boolean;
  speed: number;
}): void {
  window.dispatchEvent(
    new CustomEvent("agent-follow-animation", {
      detail: details,
    }),
  );
}

// ---------------------------------------------------------------------------
// Saga handlers
// ---------------------------------------------------------------------------

function* handleStartFollowing(action: ReturnType<typeof startFollowing>): SagaGenerator<void> {
  const [agentId] = action.payload;
  const agentColor = yield* select(selectAgentColor.select);
  yield* call(emitFollowEvent, "start", agentId, agentColor);
}

function* handleStopFollowing(): SagaGenerator<void> {
  yield* call(emitFollowEvent, "stop", null, null);
}

function* handlePauseFollowing(): SagaGenerator<void> {
  const agentId = yield* select(selectFollowedAgentId.select);
  const agentColor = yield* select(selectAgentColor.select);
  yield* call(emitFollowEvent, "pause", agentId, agentColor);
}

function* handleResumeFollowing(): SagaGenerator<void> {
  const agentId = yield* select(selectFollowedAgentId.select);
  const agentColor = yield* select(selectAgentColor.select);
  yield* call(emitFollowEvent, "resume", agentId, agentColor);
}

function* handleSetCurrentFile(action: ReturnType<typeof setCurrentFile>): SagaGenerator<void> {
  const [file] = action.payload;
  const agentId = yield* select(selectFollowedAgentId.select);
  yield* call(emitFileChangeEvent, file, agentId);
}

function* handleQueueTextAnimation(
  action: ReturnType<typeof queueTextAnimation>,
): SagaGenerator<void> {
  const [file, content, isAddition] = action.payload;
  const isFollowing = yield* select(selectIsFollowing.select);
  if (!isFollowing) return;

  // Wait while paused
  let paused = yield* select(selectIsPaused.select);
  while (paused) {
    yield* delay(100);
    paused = yield* select(selectIsPaused.select);
    const stillFollowing = yield* select(selectIsFollowing.select);
    if (!stillFollowing) return;
  }

  yield* put(setIsAnimating(true));

  // Ensure we're on the right file
  const currentFile = yield* select(selectCurrentFile.select);
  if (currentFile !== file) {
    yield* put(setCurrentFile(file));
    yield* delay(300); // Wait for file to open
  }

  // Emit animation event for the editor
  const speed = yield* select(selectTypingSpeed.select);
  yield* call(emitAnimationEvent, { file, content, isAddition, speed });

  // Wait for animation to complete (approximate)
  const animationDuration = content.length * speed;
  yield* delay(animationDuration);

  yield* put(setIsAnimating(false));
}

function* handleSetCurrentNote(action: ReturnType<typeof setCurrentNote>): SagaGenerator<void> {
  const [noteId] = action.payload;
  const agentId = yield* select(selectFollowedAgentId.select);
  yield* call(emitNoteChangeEvent, noteId, agentId);
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* agentFollowSaga(): SagaGenerator<void> {
  yield* takeEvery(startFollowing, handleStartFollowing);
  yield* takeEvery(stopFollowing, handleStopFollowing);
  yield* takeEvery(pauseFollowing, handlePauseFollowing);
  yield* takeEvery(resumeFollowing, handleResumeFollowing);
  yield* takeEvery(setCurrentFile, handleSetCurrentFile);
  yield* takeEvery(setCurrentNote, handleSetCurrentNote);
  yield* takeEvery(queueTextAnimation, handleQueueTextAnimation);
}
