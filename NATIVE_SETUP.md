# 단둘이 Android / iOS native setup

단둘이 uses Capacitor so the existing React/Vite app can run as a native Android and iOS app.

## First-time setup

```bash
npm install
npm run build
npx cap add android
npx cap add ios
npm run native:configure
npx cap sync
```

Android can be opened with:

```bash
npm run android:open
```

iOS can be opened on macOS with:

```bash
npm run ios:open
```

After web changes:

```bash
npm run native:sync
npm run native:configure
```

## Native permissions prepared

- Camera
- Microphone
- Photo library
- Foreground location
- Background location declarations
- Local notifications
- Push notification declarations
- Android foreground service declarations
- iOS background location/audio/remote notification modes

The app initializes native status bar, keyboard, splash screen, Android back button handling, and exposes native permission helpers in `src/lib/native.ts`.

## NAVER Maps authentication in 단둘이

단둘이 uses NAVER Maps JavaScript Dynamic Map through one fixed Firebase Hosting origin instead of authenticating every Codespaces URL or Capacitor WebView origin separately.

The fixed map host is:

```text
https://meluni-f4e00.web.app/naver-map-host.html
```

The NAVER Maps JavaScript SDK now uses the current `ncpKeyId` query parameter. The map host is the only page that loads the NAVER SDK, while Android, iOS, Codespaces, and desktop web communicate with that page through `postMessage`.

In NAVER Cloud Platform > Application Services > Maps > Application, the application that owns 단둘이's Client ID must have **Dynamic Map** enabled and its **Web service URL** must match the fixed host domain. Register the host only, without a port or path:

```text
http://meluni-f4e00.web.app
```

NAVER Cloud treats HTTP and HTTPS as the same host for this setting. Do not register `/naver-map-host.html`, a Codespaces URL, a port number, or a changing preview URL.

Because 단둘이 is using the Web Dynamic Map SDK through the fixed host, adding each new GitHub Codespaces domain is not required. The Android package name remains:

```text
com.route.couple
```

That package name is relevant if Mobile Dynamic Map/native NAVER SDK is added later, but the current 단둘이 map renderer authenticates through the fixed web host above.

If the map shows an authentication error, check these items in order:

1. The application is the current **Application Services > Maps** application, not an obsolete Maps application.
2. **Dynamic Map** is selected for that application.
3. The Client ID in `public/naver-map-host.html` belongs to that same application.
4. The Web service URL contains `meluni-f4e00.web.app` only, with no path or port.
5. The fixed Firebase Hosting page has been deployed after any map-host code change.

## Location tracking behavior

단둘이 uses the Capacitor Geolocation plugin on installed Android/iOS apps and browser geolocation on the web. Fine location is preferred, but Android approximate-location permission is accepted instead of being treated as a denial.

The current product records movement while 단둘이 is actively running. A saved "location sharing on" preference does not turn the current JavaScript implementation into a production-grade background tracker by itself. Continuous background tracking should only be enabled after a dedicated native background-location service is implemented and store policies are reviewed.

## Android alternate launcher icons

Android launcher icon switching is implemented natively using activity aliases and `RouteAppIcon`. The More > App icon picker can switch among 단둘이 default, heart, night, and cream icons on an installed APK. Some Android launchers may refresh the home-screen icon with a short delay.

Final production artwork can replace the current drawable assets without changing the switching logic.

## External setup still required before production release

Some functions cannot be completed by source code alone and require platform accounts, credentials, or backend services:

1. **Push notifications**: Firebase Cloud Messaging/APNs credentials and the native Firebase configuration files are required.
2. **Phone authentication**: Android SHA fingerprints and iOS APNs/reCAPTCHA/Firebase app configuration must be registered in Firebase.
3. **Real voice/video calls and screen sharing**: camera/microphone/screen-capture permissions are prepared, but a WebRTC signaling/TURN backend is required for reliable calls between two devices.
4. **Scheduled messages while the app is closed**: a server scheduler such as Firebase Cloud Functions/Cloud Tasks is required.
5. **Background location**: platform permission declarations are prepared, but production-grade continuous tracking requires a native background-location service and must comply with Play Store/App Store background-location policies.
6. **iOS alternate launcher icons**: Android switching is implemented; iOS still needs final alternate icon assets plus the iOS alternate-icon configuration.
7. **Paid emoticons/gifts**: Google Play Billing / StoreKit and a server-side purchase entitlement check are required before real payments can be enabled.
8. **iOS distribution**: an Apple Developer account, signing certificate, provisioning profile, and an Apple device or macOS/Xcode are required.

## Android test APK

A GitHub Actions workflow is included at `.github/workflows/android-debug-apk.yml`. It builds 단둘이 from the committed Android project and uploads `단둘이-debug-apk` as an Actions artifact. The workflow uses concurrency so only the newest main-branch APK build continues when several fixes are pushed in succession.

For a local debug APK after the Android project exists:

```bash
npm run native:sync
npm run native:configure
cd android
./gradlew assembleDebug
```

The APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`.
