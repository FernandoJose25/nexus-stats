const { contextBridge, ipcRenderer } = require('electron')

// Bridge seguro: expone una API controlada al renderer (React)
// Nunca exponer ipcRenderer completo al renderer por razones de seguridad
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Información de la app ──────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPythonPort: () => ipcRenderer.invoke('app:get-python-port'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  // ── Diálogos nativos ───────────────────────────────────────────────
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  saveProject: () => ipcRenderer.invoke('dialog:save-project'),
  saveExport: (format) => ipcRenderer.invoke('dialog:save-export', format),

  // ── Eventos del proceso principal → renderer ───────────────────────
  onPythonStatus: (callback) => {
    ipcRenderer.on('python:status', (_, status) => callback(status))
    return () => ipcRenderer.removeAllListeners('python:status')
  },

  // ── Auto-actualización ─────────────────────────────────────────────
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('updater:update-available', (_, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('updater:update-available')
  },
  onDownloadProgress: (cb) => {
    ipcRenderer.on('updater:download-progress', (_, p) => cb(p))
    return () => ipcRenderer.removeAllListeners('updater:download-progress')
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on('updater:update-downloaded', () => cb())
    return () => ipcRenderer.removeAllListeners('updater:update-downloaded')
  },
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
})
