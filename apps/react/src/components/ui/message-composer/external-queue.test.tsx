import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MessageComposer } from './message-composer';

it('external queue activation neither clears text nor drains a local queue on idle', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node), enqueue=vi.fn(), send=vi.fn(), change=vi.fn(), local=vi.fn();
  const props = { value:'  follow-up Ω  ', onValueChange:change, onSend:send, onEnqueue:enqueue, onQueueChange:local, queue:[{id:'local',text:'must not replay',files:[]}] };
  try {
    await act(async () => root.render(<MessageComposer {...props} status="streaming" />));
    const textarea=node.querySelector('textarea')!;
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    expect(enqueue).toHaveBeenCalledExactlyOnceWith('follow-up Ω');
    expect(change).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    await act(async () => root.render(<MessageComposer {...props} status="idle" />));
    expect(send).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  } finally {await act(async () => root.unmount()); node.remove();vi.unstubAllGlobals();}
});
