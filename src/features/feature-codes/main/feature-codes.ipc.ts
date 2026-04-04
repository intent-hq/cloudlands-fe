import { app, ipcMain } from 'electron';
import { FEATURE_CODES_CHANNELS } from '../../../shared/ipc/channels';
import { featureCodesService } from './feature-codes.service';



export async function setupFeatureCodesIPC() {
  // Initialize the service once before registering handlers
  await featureCodesService.init();

  ipcMain.handle(FEATURE_CODES_CHANNELS.ACTIVATE, async (_event, args: { code: string }) => {
    const result = featureCodesService.activateCode(args.code);
    if (!result.success) {
      return { status: 'invalid' };
    }
    return { status: result.alreadyActive ? 'already_active' : 'activated' };
  });

  ipcMain.handle(FEATURE_CODES_CHANNELS.GET_ACTIVE, async () => {
    return { features: featureCodesService.getActiveFeatures() };
  });

  ipcMain.handle(FEATURE_CODES_CHANNELS.DEACTIVATE, async (_event, args: { featureId: string }) => {
    const success = featureCodesService.deactivateFeature(args.featureId);
    return { success };
  });

  ipcMain.handle(FEATURE_CODES_CHANNELS.CLEAR, async () => {
    featureCodesService.clearAllCodes();
    return { success: true };
  });

  ipcMain.handle(FEATURE_CODES_CHANNELS.RESTART_APP, async () => {
    app.relaunch();
    app.quit();
  });
}

