import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { store } from './store';
// eslint-disable-next-line themis/react-forbidden-component-import -- Browser bootstrap is the explicit saga startup and teardown owner.
import { catalogSaga } from './store/catalog/sagas/catalog-saga';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('React mount container is missing');

// Initialize before any selector consumer renders. This bootstrap owns teardown.
const disposeStore = store.init();
const cancelCatalogSaga = store.runSaga(catalogSaga);
const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

function dispose() {
  root.unmount();
  cancelCatalogSaga();
  disposeStore();
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(dispose);
}
