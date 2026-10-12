import { backend } from '../backend/backend-transport';
import { createBackendSkillsClient } from '$lib/client/live/backend-skills-client';

export const skillsClient = createBackendSkillsClient(backend);
