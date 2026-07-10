// Electron wrapper that loads the deployed JZac Lead Generator web app.
// Loading the live Vercel URL means the desktop app gets the exact same
// frontend + backend (auth, Places, AI) with zero duplication.
//
// Set the deployment URL before building:
//   - edit APP_URL below, OR
//   - set the APP_URL environment variable when launching.
const { app, BrowserWindow, session, shell } = require('electron');

const APP_URL = process.env.APP_URL || 'https://YOUR-DEPLOYMENT.vercel.app';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 380,
    backgroundColor: '#0b1220',
    title: 'JZac Lead Generator',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Allow the geolocation prompt inside the desktop app.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'geolocation' || permission === 'notifications');
  });

  // Open external links (tel:, google maps) in the user's real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
