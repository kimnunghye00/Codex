import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export type DiagnosticArea = 'bootstrap' | 'ui' | 'promise' | 'call' | 'sync';

const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 4;
const recentReports: number[] = [];

function scrub(value: string, limit: number) {
  return value
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(?:\+?82|0)1[016789][- ]?\d{3,4}[- ]?\d{4}/g, '[phone]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, limit);
}

function canReport() {
  const now = Date.now();
  while (recentReports.length && now - recentReports[0] > WINDOW_MS) recentReports.shift();
  if (recentReports.length >= MAX_REPORTS_PER_WINDOW) return false;
  recentReports.push(now);
  return true;
}

export async function reportOperationalError(area: DiagnosticArea, cause: unknown) {
  const user = auth.currentUser;
  if (!user || !canReport()) return;

  const error = cause instanceof Error ? cause : new Error(String(cause ?? 'unknown-error'));
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    await setDoc(doc(db, 'operationalErrors', id), {
      uid: user.uid,
      area,
      message: scrub(error.message || error.name || 'unknown-error', 240),
      name: scrub(error.name || 'Error', 60),
      platform: navigator.userAgent.includes('Android') ? 'android' : 'web',
      online: navigator.onLine,
      release: String(import.meta.env.VITE_APP_RELEASE || 'unknown').slice(0, 80),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Diagnostics must never affect the feature that originally failed.
  }
}
