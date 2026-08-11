import '../../../../app.css';
import { mount } from 'svelte';
import OperatePatternsVisualHarness from './OperatePatternsVisualHarness.svelte';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const view = params.get('view');
const target = document.querySelector('#operate-patterns-root');

document.documentElement.classList.add(theme);

if (!(target instanceof HTMLElement)) throw new Error('Operate patterns root is missing');

mount(OperatePatternsVisualHarness, {
  target,
  props: {
    view: view === 'menu' || view === 'dialog' || view === 'sheet' ? view : 'patterns',
  },
});
