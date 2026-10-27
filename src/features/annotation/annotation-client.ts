import { store as appStore } from '$store/renderer/store';
import { selectAnnotationEvent } from '$store/renderer/slices/annotation/annotation-selectors';
import {
  addAnnotationTranscriptRequested,
  startAnnotationRequested,
} from '$store/renderer/slices/annotation/annotation-slice';
import type { AnnotationSessionState, StartAnnotationRequest } from '$shared/annotation';

export function startAnnotation(request: StartAnnotationRequest): Promise<void> {
  const action = startAnnotationRequested(request);
  appStore.dispatch(action);
  return action.promise;
}

export async function addAnnotationTranscript(text: string, startedAt?: number): Promise<void> {
  const action = addAnnotationTranscriptRequested(text, startedAt);
  appStore.dispatch(action);
  await action.promise;
}

export function subscribeToAnnotationState(
  listener: (state: AnnotationSessionState) => void,
): () => void {
  let revision = selectAnnotationEvent.select(appStore.state).eventRevision;
  return appStore.getReadableState().subscribe((state) => {
    const event = selectAnnotationEvent.select(state);
    if (event.eventRevision === revision || !event.lastEvent) return;
    revision = event.eventRevision;
    listener(event.lastEvent);
  });
}
