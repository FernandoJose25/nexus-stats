const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const { autoUpdater } = require('electron-updater')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow = null
let pythonProcess = null
const PYTHON_PORT = 5174
const PYTHON_READY_TIMEOUT = 30000 // 30s para que Python arranque

// ─── Lanzar el motor Python ───────────────────────────────────────────────────

function getPythonExecutable() {
  // En producción: ejecutable PyInstaller empaquetado
  if (!isDev) {
    return { exe: path.join(process.resourcesPath, 'nexus_engine', 'nexus_engine.exe'), args: [] }
  }
  // En desarrollo en Windows usamos el launcher "py" con versión explícita
  // para asegurar el entorno que tiene fastapi/uvicorn/pandas instalados.
  if (process.platform === 'win32') {
    return {
      exe: 'py',
      args: ['-3.11', path.join(__dirname, '..', 'python', 'main.py')],
    }
  }
  return { exe: 'python3', args: [path.join(__dirname, '..', 'python', 'main.py')] }
}

function startPython() {
  return new Promise((resolve, reject) => {
    // En desarrollo, npm run dev:python ya lanzó el servidor.
    // Electron solo espera a que esté disponible sin duplicar el proceso.
    if (isDev) {
      console.log('[Python] Modo dev — esperando servidor en puerto', PYTHON_PORT)
      waitForPython(resolve, reject, Date.now())
      return
    }

    const { exe, args } = getPythonExecutable()
    console.log(`[Python] Lanzando: ${exe} ${args.join(' ')}`)

    pythonProcess = spawn(exe, args, {
      env: { ...process.env, NEXUS_PORT: String(PYTHON_PORT) },
      windowsHide: true,
    })

    pythonProcess.stdout.on('data', (d) => console.log(`[Python] ${d.toString().trim()}`))
    pythonProcess.stderr.on('data', (d) => console.error(`[Python err] ${d.toString().trim()}`))
    pythonProcess.on('error', (err) => { console.error('[Python] Error al lanzar:', err); reject(err) })
    pythonProcess.on('exit', (code) => console.log(`[Python] Salió con código ${code}`))

    waitForPython(resolve, reject, Date.now())
  })
}

function waitForPython(resolve, reject, startTime) {
  http
    .get(`http://localhost:${PYTHON_PORT}/health`, (res) => {
      if (res.statusCode === 200) {
        console.log('[Python] Motor listo en puerto', PYTHON_PORT)
        resolve()
      } else {
        retry(resolve, reject, startTime)
      }
    })
    .on('error', () => retry(resolve, reject, startTime))
}

function retry(resolve, reject, startTime) {
  if (Date.now() - startTime > PYTHON_READY_TIMEOUT) {
    reject(new Error('El motor Python no respondió a tiempo'))
    return
  }
  setTimeout(() => waitForPython(resolve, reject, startTime), 500)
}

function stopPython() {
  if (pythonProcess && !pythonProcess.killed) {
    console.log('[Python] Terminando proceso...')
    pythonProcess.kill('SIGTERM')
    pythonProcess = null
  }
}

// ─── Ventana principal ────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0F1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0F1117',
      symbolColor: '#94A3B8',
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    show: false, // Mostrar solo cuando esté listo para evitar flash blanco
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Abrir links externos en el navegador del sistema, no en Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ─── Auto-actualización ───────────────────────────────────────────────────────

function setupAutoUpdater() {
  // En dev no hay nada que actualizar
  if (isDev) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes ?? '',
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:download-progress', {
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message)
  })

  // Revisar actualizaciones 5 s después de que la ventana esté lista
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('app:get-python-port', () => PYTHON_PORT)

ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('app:open-external', (_, url) => {
  shell.openExternal(url)
})

ipcMain.handle('updater:download', () => {
  autoUpdater.downloadUpdate().catch(() => {})
})

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall()
})

// Diálogo nativo para abrir archivos (CSV, Excel, SPSS)
ipcMain.handle('dialog:open-file', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir archivo de datos',
    filters: [
      { name: 'Archivos de datos', extensions: ['csv', 'xlsx', 'xls', 'sav', 'sas7bdat', 'dta'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
      { name: 'SPSS', extensions: ['sav'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// Diálogo para guardar proyecto .nexus
ipcMain.handle('dialog:save-project', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar proyecto',
    defaultPath: 'proyecto.nexus',
    filters: [{ name: 'Proyecto Nexus Stats', extensions: ['nexus'] }],
  })
  return result.canceled ? null : result.filePath
})

// Diálogo para exportar PDF/Excel
ipcMain.handle('dialog:save-export', async (_, format) => {
  const { dialog } = require('electron')
  const filters =
    format === 'pdf'
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : [{ name: 'Excel', extensions: ['xlsx'] }]

  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Exportar resultados como ${format.toUpperCase()}`,
    defaultPath: `resultados.${format}`,
    filters,
  })
  return result.canceled ? null : result.filePath
})

// ─── Ciclo de vida de la app ───────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    await startPython()
    createWindow()
    setupAutoUpdater()
  } catch (err) {
    console.error('[App] Error fatal al arrancar:', err)
    const { dialog } = require('electron')
    dialog.showErrorBox(
      'Error al iniciar Nexus Stats',
      `No se pudo iniciar el motor estadístico.\n\n${err.message}\n\nIntenta reinstalar la aplicación.`
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  stopPython()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  stopPython()
})
