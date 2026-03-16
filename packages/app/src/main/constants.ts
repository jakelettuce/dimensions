import { app } from 'electron'
import path from 'path'

export const DIMENSIONS_DIR = process.env.DIMENSIONS_HOME || path.join(app.getPath('home'), 'Dimensions')
export const HOME_SCENE_DIR = path.join(DIMENSIONS_DIR, 'home')
export const DB_PATH = path.join(DIMENSIONS_DIR, 'dimensions.db')

export const SCHEME_DIMENSIONS = 'dimensions'
export const SCHEME_ASSET = 'dimensions-asset'

// Security: full webPreferences lockdown applied to ALL windows/WCVs
export const SECURE_WEB_PREFERENCES = {
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
  safeDialogs: true,
} as const
