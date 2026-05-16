# DeepSpec Camera

Native iOS SwiftUI camera app.

This repo is intentionally reset to one thing right now: a camera-first iOS app built with Xcode, SwiftUI, and AVFoundation. There is no web app, backend, Expo app, or AI layer in this version.

## Open in Xcode

Open:

```text
DeepSpecCamera.xcodeproj
```

Then select the `DeepSpecCamera` target.

For the real camera test, run it on a connected iPhone. The iOS Simulator is useful for checking that the app opens, but it may not provide a usable live camera feed.

For a physical iPhone build, Xcode will ask for an Apple developer team under **Signing & Capabilities**.

## Current Scope

- Live camera preview
- Camera permission screen
- Scan-frame overlay
- Shutter button
- Front/back camera toggle
- Last captured photo thumbnail

AI identification will be added later after the camera app is stable.
