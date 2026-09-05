# ROUTE release guardrails

These are non-negotiable product requirements for every feature addition, refactor, web deploy, Android APK build, and future iOS build.

## 1. NAVER Maps must survive environment changes

- Production web/Windows uses the canonical Firebase Hosting origin: `https://meluni-f4e00.web.app`.
- Android/Capacitor must use a stable, pre-registered origin and must not depend on a temporary Codespaces hostname.
- Temporary development hosts must never be a production dependency.
- If the current page origin is not authorized by NAVER Maps, ROUTE should fall back to a canonical map surface hosted under the production Firebase domain instead of leaving the user with a dead map.
- Changes to map loading must preserve retry/error diagnostics and must not crash the rest of the app.

## 2. User data must survive uninstall/reinstall

Local storage is cache only. It is not the source of truth for durable user data.

Durable cloud storage targets:
- Firestore: profiles, relationship state, messages/text metadata, schedules, date plans, memory metadata, settings needed across devices, and synced location visit records.
- Firebase Storage: album photos/videos, chat photos/GIFs, and other binary media.

Retention policy:
- ROUTE must keep cloud data for at least 30 days.
- Prefer retaining user content until the user explicitly deletes it.
- User-initiated deletion should use a 30-day recoverable soft-delete/trash period where practical before permanent deletion.
- Signing in again after reinstall must automatically restore cloud-backed data.
- A failed cloud write must not silently discard the local copy; queue/retry or show a clear sync state.

## 3. Stability is a release requirement

Before considering a change ready:
- TypeScript/Vite production build must pass.
- Android APK build and signing verification must pass for Android changes.
- Web/PWA build must pass for web changes.
- Critical flows must not regress: authentication/profile restore, home, chat, memories/album, schedules, map/location, settings, back navigation.
- React render errors must be contained by the app error boundary rather than producing a blank screen.
- New async operations must handle rejection and show recoverable UI.
- Do not remove an existing fallback, retry path, or cloud/local safety mechanism without replacing it with an equal or stronger one.

## Critical smoke-check list

1. Existing user logs in without profile onboarding repeating.
2. Home renders and navigation works.
3. Text chat sends and reloads.
4. Album opens, saves, edits, and closes dialogs correctly.
5. Personal schedule and shared appointment save successfully.
6. NAVER map renders or a stable canonical fallback renders.
7. Settings opens/closes and theme/icon actions do not navigate to unrelated files.
8. Browser/Android back navigation returns to the previous ROUTE screen.
9. Refresh/relaunch/reinstall restores cloud-backed records.
10. No action leaves the app on a blank screen.
