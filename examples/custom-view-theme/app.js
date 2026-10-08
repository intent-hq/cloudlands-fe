import { createCustomViewTheme } from '/sdk/index.js';

const parentOrigin = new URLSearchParams(window.location.search).get('parentOrigin');
const theme = createCustomViewTheme(parentOrigin ? { parentOrigin } : undefined);
const unsubscribe = theme.subscribe((snapshot) => {
  document.querySelector('#status').textContent =
    `${snapshot.mode} theme · ${snapshot.reducedMotion ? 'reduced' : 'full'} motion`;
  document.querySelector('#snapshot').textContent = JSON.stringify(theme.getSnapshot(), null, 2);
});

window.addEventListener(
  'pagehide',
  () => {
    unsubscribe();
    theme.dispose();
  },
  { once: true },
);
