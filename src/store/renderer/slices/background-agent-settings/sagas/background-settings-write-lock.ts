import { buffers, channel } from 'redux-saga';

// A renderer has one settings client. These three saga writers share a lock so
// an outgoing quick-action save settles before a provider switch writes its bundle.
// Only synchronization lives here; settings and pending intent remain in Redux.
export const backgroundSettingsWriteLock = channel<boolean>(buffers.fixed(1));
backgroundSettingsWriteLock.put(true);
