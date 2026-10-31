import '../../../src/app.css';
import '@fontsource-variable/inter';
import '../../../src/store/renderer/seeders/voice-local-bridge-seeder';
import { mount } from 'svelte';
import Harness from './Harness.svelte';

// Do not install the CT mock bridge: placement must cross the production preload.
mount(Harness, { target: document.getElementById('fixture')! });
