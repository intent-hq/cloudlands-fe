/**
 * Agent Follow Saga
 *
 * Handles side effects for the agent-follow feature:
 * - Animation queue processing (emits `agent-follow-animation` window event for editors)
 * - Auto-pause/resume timeouts
 * - Error recovery (animation queue overflow)
 */

import {
  call,
  delay,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  setCurrentFile,
  queueTextAnimation,
  setIsAnimating,
} from "../agent-follow-slice";
import {
  selectIsFollowing,
  selectIsPaused,
  selectCurrentFile,
  selectTypingSpeed,
} from "../agent-follow-selectors";
import { dispatchWindowEvent } from "$lib/utils/window-events";

// ---------------------------------------------------------------------------
// Window event emitters
// ---------------------------------------------------------------------------

function emitAnimationEvent(details: {
  file: string;
  content: string;
  isAddition: boolean;
  speed: number;
}): void {
  dispatchWindowEvent("agent-follow-animation", details);
}

// ---------------------------------------------------------------------------
// Saga handlers
// ---------------------------------------------------------------------------

function* handleQueueTextAnimation(
  action: ReturnType<typeof queueTextAnimation>,
): SagaGenerator<void> {
  const [file, content, isAddition] = action.payload;
  const isFollowing = yield* selectIsFollowing.effect();
  if (!isFollowing) return;

  // Wait while paused
  let paused = yield* selectIsPaused.effect();
  while (paused) {
    yield* delay(100);
    paused = yield* selectIsPaused.effect();
    const stillFollowing = yield* selectIsFollowing.effect();
    if (!stillFollowing) return;
  }

  yield* put(setIsAnimating(true));

  // Ensure we're on the right file
  const currentFile = yield* selectCurrentFile.effect();
  if (currentFile !== file) {
    yield* put(setCurrentFile(file));
    yield* delay(300); // Wait for file to open
  }

  // Emit animation event for the editor
  const speed = yield* selectTypingSpeed.effect();
  yield* call(emitAnimationEvent, { file, content, isAddition, speed });

  // Wait for animation to complete (approximate)
  const animationDuration = content.length * speed;
  yield* delay(animationDuration);

  yield* put(setIsAnimating(false));
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* agentFollowSaga(): SagaGenerator<void> {
  yield* takeEvery(queueTextAnimation, handleQueueTextAnimation);
}
