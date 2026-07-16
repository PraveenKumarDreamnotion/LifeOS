import { app } from 'electron';
import { join } from 'node:path';

/**
 * Resolve a shipped resource path. NEVER use __dirname for a resource — it points inside
 * the asar when packaged (14 §6). extraResources land in process.resourcesPath.
 */
export function resourcePath(...segments: string[]): string {
  return app.isPackaged
    ? join(process.resourcesPath, ...segments)
    : join(app.getAppPath(), 'resources', ...segments);
}

export const sttModelDir = () => resourcePath('models', 'stt');
