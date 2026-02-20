import { BrowserWindow, dialog, screen } from 'electron';
import { join, dirname } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { ConfigManager } from '../services/config-manager';
import { Logger } from '../../lib/utils/logger';

// ESM polyfill for __dirname (not available in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WindowManager {
  private windows: Map<string, BrowserWindow> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private logger: Logger;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.logger = new Logger({ category: 'WindowManager' });
  }

  async createMainWindow(): Promise<BrowserWindow> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus();
      return this.mainWindow;
    }

    const { width, height } = this.getOptimalWindowSize();

    this.mainWindow = new BrowserWindow({
      width,
      height,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // __dirname is dist/shared/main, preload is at dist/preload
        preload: join(__dirname, '../../preload/index.js'),
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      frame: process.platform !== 'darwin',
      backgroundColor: '#1e1e1e',
      show: false,
      icon: this.getAppIcon(),
    });

    // Store window reference
    this.windows.set('main', this.mainWindow);

    // Load the app
    if (process.env.NODE_ENV === 'development') {
      await this.mainWindow.loadURL('http://localhost:2345');
      this.mainWindow.webContents.openDevTools();
    } else {
      const indexPath = join(__dirname, '../../renderer/index.html');
      await this.mainWindow.loadURL(pathToFileURL(indexPath).toString());
    }

    // Window event handlers
    this.setupWindowEventHandlers(this.mainWindow);

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
      this.logger.info('Main window shown');
    });

    return this.mainWindow;
  }

  private setupWindowEventHandlers(window: BrowserWindow): void {
    // Save window state before closing
    window.on('close', () => {
      if (window === this.mainWindow) {
        const bounds = window.getBounds();
        this.configManager.set('window.bounds', bounds);
      }
    });

    // Clean up reference when closed
    window.on('closed', () => {
      if (window === this.mainWindow) {
        this.mainWindow = null;
        this.windows.delete('main');
      }
    });

    // Handle window focus
    window.on('focus', () => {
      this.sendToRenderer('window:focus');
    });

    window.on('blur', () => {
      this.sendToRenderer('window:blur');
    });

    // Handle fullscreen
    window.on('enter-full-screen', () => {
      this.sendToRenderer('window:fullscreen', true);
    });

    window.on('leave-full-screen', () => {
      this.sendToRenderer('window:fullscreen', false);
    });
  }

  private getOptimalWindowSize(): { width: number; height: number } {
    // Get saved bounds
    const savedBounds = this.configManager.get('window.bounds' as any);
    if (savedBounds) {
      return { width: savedBounds.width, height: savedBounds.height };
    }

    // Calculate optimal size based on screen
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    return {
      width: Math.min(1400, Math.floor(width * 0.8)),
      height: Math.min(900, Math.floor(height * 0.8)),
    };
  }

  private getAppIcon(): string | undefined {
    if (process.platform === 'win32') {
      return join(__dirname, '../../assets/icon.ico');
    } else if (process.platform === 'linux') {
      return join(__dirname, '../../assets/icon.png');
    }
    return undefined; // macOS uses icon from app bundle
  }

  async createWindow(
    id: string,
    options: Electron.BrowserWindowConstructorOptions,
  ): Promise<BrowserWindow> {
    if (this.windows.has(id)) {
      const existingWindow = this.windows.get(id)!;
      if (!existingWindow.isDestroyed()) {
        existingWindow.focus();
        return existingWindow;
      }
    }

    const window = new BrowserWindow({
      ...options,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // __dirname is dist/shared/main, preload is at dist/preload
        preload: join(__dirname, '../../preload/index.js'),
        ...options.webPreferences,
      },
    });

    this.windows.set(id, window);

    window.on('closed', () => {
      this.windows.delete(id);
    });

    return window;
  }

  getWindow(id: string): BrowserWindow | undefined {
    return this.windows.get(id);
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values()).filter((w) => !w.isDestroyed());
  }

  hasWindows(): boolean {
    return this.getAllWindows().length > 0;
  }

  focusMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    }
  }

  sendToRenderer(channel: string, ...args: any[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }

  sendToWindow(windowId: string, channel: string, ...args: any[]): void {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  }

  async showOpenDialog(options: Electron.OpenDialogOptions): Promise<string[] | undefined> {
    const window = this.mainWindow || BrowserWindow.getFocusedWindow();
    if (!window) return undefined;

    const result = await dialog.showOpenDialog(window, options);
    return result.canceled ? undefined : result.filePaths;
  }

  async showSaveDialog(options: Electron.SaveDialogOptions): Promise<string | undefined> {
    const window = this.mainWindow || BrowserWindow.getFocusedWindow();
    if (!window) return undefined;

    const result = await dialog.showSaveDialog(window, options);
    return result.canceled ? undefined : result.filePath;
  }

  async showMessageBox(
    options: Electron.MessageBoxOptions,
  ): Promise<Electron.MessageBoxReturnValue> {
    const window = this.mainWindow || BrowserWindow.getFocusedWindow();
    if (!window) {
      return dialog.showMessageBox(options);
    }
    return dialog.showMessageBox(window, options);
  }

  showAboutDialog(): void {
    const options: Electron.MessageBoxOptions = {
      type: 'info',
      title: 'About Spaces',
      message: 'Spaces',
      detail: `Version: ${process.env.npm_package_version || '0.1.0'}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\nChrome: ${process.versions.chrome}`,
      buttons: ['OK'],
    };
    this.showMessageBox(options);
  }

  closeAllWindows(): void {
    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.close();
      }
    });
  }
}
