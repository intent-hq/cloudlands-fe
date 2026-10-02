import { DevConsoleCaptureService } from './dev-console-capture';
/** Single production recorder, shared by the client pool and native console registry. */
export const devConsoleCapture = new DevConsoleCaptureService();
