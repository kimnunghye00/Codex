const { app, BrowserWindow, net, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROUTE_URL = 'https://meluni-f4e00.web.app';
const ROUTE_ORIGIN = new URL(ROUTE_URL).origin;
const DIST_DIR = path.join(process.resourcesPath, 'dist');

const WINDOWS_APP_CHROME_CSS = `
  .topbar,
  .page > .topbar,
  .home-dashboard > .topbar,
  .home-page > .topbar {
    -webkit-app-region: drag;
    padding-right: max(
      126px,
      calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px) - 8px)
    ) !important;
  }

  .topbar .header-actions,
  .topbar button,
  .topbar a,
  .topbar input,
  .topbar textarea,
  .topbar select,
  .topbar [role='button'] {
    -webkit-app-region: no-drag;
  }

  @media (max-width: 560px) {
    .topbar .header-actions {
      gap: 0 !important;
    }

    .topbar .header-actions button {
      min-width: 40px !important;
      width: 40px !important;
      min-height: 40px !important;
      height: 40px !important;
    }
  }
`;

app.setAppUserModelId('com.route.couple');

function isTrustedUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === ROUTE_ORIGIN;
  } catch {
    return false;
  }
}

function forwardNetworkRequest(request) {
  return net.fetch(request, { bypassCustomProtocolHandlers: true });
}

function resolveBundledFile(pathname) {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(DIST_DIR, relativePath);
  const relative = path.relative(DIST_DIR, candidate);
  const safe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (!safe) return null;

  try {
    if (fs.statSync(candidate).isFile()) return candidate;
  } catch {
    // Missing packaged resource: handled by SPA or network fallback below.
  }
  return null;
}

function configureBundledAppProtocol(ses) {
  ses.protocol.handle('https', (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== ROUTE_ORIGIN) return forwardNetworkRequest(request);

    // Firebase's reserved auth/hosting endpoints must stay on the real network.
    if (requestUrl.pathname.startsWith('/__/') || !['GET', 'HEAD'].includes(request.method)) {
      return forwardNetworkRequest(request);
    }

    const bundledFile = resolveBundledFile(requestUrl.pathname);
    if (bundledFile) return net.fetch(pathToFileURL(bundledFile).toString());

    // Client-side ROUTE pages have no extension, so serve the packaged app shell.
    if (!path.extname(requestUrl.pathname)) {
      const appShell = path.join(DIST_DIR, 'index.html');
      if (fs.existsSync(appShell)) return net.fetch(pathToFileURL(appShell).toString());
    }

    // Keep a network fallback for reserved/unknown static resources.
    return forwardNetworkRequest(request);
  });
}

function configureSession() {
  const ses = session.defaultSession;

  // Keep the browser identity Chrome-like so Firebase/reCAPTCHA web flows
  // behave the same way as they do on the authorized ROUTE web origin.
  const currentUserAgent = ses.getUserAgent();
  ses.setUserAgent(currentUserAgent.replace(/\sElectron\/\S+/g, ''));

  configureBundledAppProtocol(ses);

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
    title: 'ROUTE',
    width: 430,
    height: 860,
    minWidth: 360,
    minHeight: 640,
    useContentSize: true,
    center: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#fffaf8',
    icon: path.join(process.resourcesPath, 'build', 'icons', 'route.ico'),
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#5f554f',
        height: 64,
      },
    } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (process.platform === 'win32') {
    win.webContents.on('dom-ready', () => {
      void win.webContents.insertCSS(WINDOWS_APP_CHROME_CSS).catch(() => {
        // Cosmetic only: keep the app usable even if title-bar CSS injection fails.
      });
    });
  }

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: 'allow' };
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
