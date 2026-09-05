const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#1e1f22',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.env.PDF_EDITOR_DEBUG) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Esta app solo carga archivos locales propios (nunca contenido remoto),
// por eso el renderer usa nodeIntegration para leer/escribir PDFs directamente.
ipcMain.handle('dialog:openPdfPaths', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona uno o varios PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:openImagePath', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona una imagen',
    properties: ['openFile'],
    filters: [{ name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:savePdfPath', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar PDF',
    defaultPath: defaultName || 'documento.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled) return null;
  return result.filePath;
});
