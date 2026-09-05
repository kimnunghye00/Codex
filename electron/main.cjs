const { app, BrowserWindow, shell, session } = require('electron');

const ROUTE_URL = 'https://meluni-f4e00.web.app';
const ROUTE_ORIGIN = new URL(ROUTE_URL).origin;

app.setAppUserModelId('com.route.couple');

function isTrustedUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === ROUTE_ORIGIN;
  } catch {
    return false;
  }
}

function configureSession() {
  const ses = session.defaultSession;

  // Keep the browser identity Chrome-like so Firebase/reCAPTCHA web flows
  // behave the same way as they do in the installed PWA.
  const currentUserAgent = ses.getUserAgent();
  ses.setUserAgent(currentUserAgent.replace(/\sElectron\/\S+/g, ''));

  const allowedPermissions = new Set([
    'geolocation',
    'notifications',
    'media',
    'camera',
    'microphone',
    'clipboard-read',
  ]);

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return requestingOrigin.startsWith(ROUTE_ORIGIN) && allowedPermissions.has(permission);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestUrl = details?.requestingUrl || webContents.getURL();
    callback(isTrustedUrl(requestUrl) && allowedPermissions.has(permission));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 420,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#fffaf8',
    icon: require('path').join(__dirname, '..', 'build', 'icons', 'route.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void win.loadURL(ROUTE_URL);
}

app.whenReady().then(() => {
  configureSession();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
