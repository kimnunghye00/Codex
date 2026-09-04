# ROUTE Android / iOS native setup

ROUTE uses Capacitor so the existing React/Vite app can run as a native Android and iOS app.

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

## External setup still required before production release

Some functions cannot be completed by source code alone and require platform accounts, credentials, or backend services:

1. **Push notifications**: Firebase Cloud Messaging/APNs credentials and the native Firebase configuration files are required.
2. **Phone authentication**: Android SHA fingerprints and iOS APNs/reCAPTCHA/Firebase app configuration must be registered in Firebase.
3. **Real voice/video calls and screen sharing**: camera/microphone/screen-capture permissions are prepared, but a WebRTC signaling/TURN backend is required for reliable calls between two devices.
4. **Scheduled messages while the app is closed**: a server scheduler such as Firebase Cloud Functions/Cloud Tasks is required.
5. **Background location**: platform permission declarations are prepared, but production-grade continuous tracking requires a native background-location service and must comply with Play Store/App Store background-location policies.
6. **Alternate launcher icons**: the web preview/favicons work now; native launcher icon switching requires native Android activity aliases and iOS alternate icon assets to be added after final icon artwork is chosen.
7. **Paid emoticons/gifts**: Google Play Billing / StoreKit and a server-side purchase entitlement check are required before real payments can be enabled.
8. **iOS distribution**: an Apple Developer account, signing certificate, provisioning profile, and an Apple device or macOS/Xcode are required.

## Android test APK

A GitHub Actions workflow is included at `.github/workflows/android-debug-apk.yml`. It creates a temporary Android project, builds ROUTE, and uploads `ROUTE-debug-apk` as an Actions artifact.

For a local debug APK after the Android project exists:

```bash
npm run native:sync
npm run native:configure
cd android
./gradlew assembleDebug
```

The APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`.
