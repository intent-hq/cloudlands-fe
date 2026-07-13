import { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;
export function getMainWindow() { return mainWindow; }
export function setMainWindow(w: BrowserWindow | null) { mainWindow = w; }
