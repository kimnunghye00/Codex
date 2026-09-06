import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`P3 migration pattern missing: ${label}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`P3 migration did not change: ${label}`);
  return next;
}

const appPath = 'src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8');
app = replaceOnce(
  app,
  `import { useEffect, useMemo, useRef, useState } from 'react';\nimport { ChatPage } from './components/chat/ChatPage';\nimport { MemoriesPage, type HubTabId } from './components/memories/MemoriesPage';\nimport { LocationPage, type LocationTabId } from './components/location/LocationPage';\nimport { AccountSettings } from './components/auth/AccountSettings';`,
  `import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';\nimport type { HubTabId } from './components/memories/MemoriesPage';\nimport type { LocationTabId } from './components/location/LocationPage';`,
  'App heavy imports',
);
app = replaceOnce(
  app,
  `import { NotificationPanel } from './components/notifications/NotificationPanel';`,
  ``,
  'NotificationPanel import',
);
app = replaceOnce(
  app,
  `import { MoreServices, type MoreNavigationTarget } from './components/more/MoreServices';`,
  `import type { MoreNavigationTarget } from './components/more/MoreServices';`,
  'MoreServices import',
);
app = replaceOnce(
  app,
  `type Tab = AppTab;`,
  `const ChatPage = lazy(() => import('./components/chat/ChatPage').then((module) => ({ default: module.ChatPage })));\nconst MemoriesPage = lazy(() => import('./components/memories/MemoriesPage').then((module) => ({ default: module.MemoriesPage })));\nconst LocationPage = lazy(() => import('./components/location/LocationPage').then((module) => ({ default: module.LocationPage })));\nconst AccountSettings = lazy(() => import('./components/auth/AccountSettings').then((module) => ({ default: module.AccountSettings })));\nconst NotificationPanel = lazy(() => import('./components/notifications/NotificationPanel').then((module) => ({ default: module.NotificationPanel })));\nconst MoreServices = lazy(() => import('./components/more/MoreServices').then((module) => ({ default: module.MoreServices })));\n\ntype Tab = AppTab;`,
  'App lazy declarations',
);
app = replaceOnce(
  app,
  `    <div className="app-shell"><main>\n      {tab === 'home'`,
  `    <div className="app-shell"><main><Suspense fallback={<div className="page auth-loading" role="status" aria-live="polite"><div className="loading-mark" /><p>화면을 불러오는 중이에요</p></div>}>\n      {tab === 'home'`,
  'App Suspense open',
);
app = replaceOnce(
  app,
  `      {tab === 'more' && <MorePage onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} onNavigate={navigateMoreTarget} />}\n    </main><BottomNav`,
  `      {tab === 'more' && <MorePage onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} onNavigate={navigateMoreTarget} />}\n    </Suspense></main><BottomNav`,
  'App Suspense close',
);
app = replaceOnce(
  app,
  `    {settingsOpen && <AccountSettings user={user} profile={profile} onProfileChange={handleProfileChange} onClose={() => setSettingsOpen(false)} />}\n    {notificationsOpen && <NotificationPanel items={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={() => { const next = markAllNotificationsRead(notifications); setNotifications(next); saveNotifications(user.uid, next); }} onClear={clearNotifications} />}`,
  `    <Suspense fallback={null}>\n      {settingsOpen && <AccountSettings user={user} profile={profile} onProfileChange={handleProfileChange} onClose={() => setSettingsOpen(false)} />}\n      {notificationsOpen && <NotificationPanel items={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={() => { const next = markAllNotificationsRead(notifications); setNotifications(next); saveNotifications(user.uid, next); }} onClear={clearNotifications} />}\n    </Suspense>`,
  'App overlay Suspense',
);
fs.writeFileSync(appPath, app);

const rootPath = 'src/Root.tsx';
let root = fs.readFileSync(rootPath, 'utf8');
root = replaceOnce(root, `import { useEffect, useState } from 'react';`, `import { lazy, Suspense, useEffect, useState } from 'react';`, 'Root React import');
root = replaceOnce(root, `import App from './App';\n`, ``, 'Root App import');
root = replaceOnce(root, `import { loadProfile, saveProfile, type UserProfile } from './utils/profile';\n`, `import { loadProfile, saveProfile, type UserProfile } from './utils/profile';\n\nconst App = lazy(() => import('./App'));\n`, 'Root lazy App');
root = replaceOnce(root, `  if (!user) return <App />;`, `  if (!user) return <AuthFlow />;`, 'Root signed-out route');
root = replaceOnce(root, `  return <App />;`, `  return <Suspense fallback={<div className="app-shell auth-loading" role="status" aria-live="polite"><Wordmark /><div className="loading-mark" /><p>ROUTE를 불러오는 중이에요</p></div>}><App /></Suspense>;`, 'Root App Suspense');
fs.writeFileSync(rootPath, root);

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
main = replaceOnce(
  main,
  `import { applySavedRouteAppIcon } from './components/more/MoreServices';`,
  `import { applySavedRouteAppIcon } from './utils/appIcon';`,
  'startup app icon import',
);
fs.writeFileSync(mainPath, main);

console.log('P3 route-level code splitting migration applied.');
