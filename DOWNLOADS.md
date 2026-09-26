# Maya Steel Works — Downloads

Use this page for the current Maya Steel Works application and production system.

## Android — current official install

**Latest Release page**  
https://github.com/lumuxav/maya-steel-works/releases/latest

**Direct APK**  
https://github.com/lumuxav/maya-steel-works/releases/download/maya-latest/Maya-Steel-Works.apk

For normal installation, always use the **Latest Release** above instead of downloading an older artifact from GitHub Actions.

The current release is built from `main` and includes the native Capacitor App plugin for Android Back-button handling:

- sub-pages navigate back through Maya rather than immediately closing the application
- if no useful app history exists, Back returns to Home
- Home is the screen from which Android Back may exit the application

It also includes the existing cross-device safe-area, keyboard and system-bar support.

> Android may ask you to allow installation from your browser or Files app because this is a direct APK installation rather than a Play Store installation.

### Updating an existing APK

The current pipeline produces a debug-signed internal APK. If Android refuses to install a newer APK over an older build because the signatures differ, the old Maya app must be removed before installing the new APK. That can clear local app storage/session state, so the user may need to sign in once again.

For reliable long-term in-place upgrades, configure a stable production signing keystore.

## Desktop

Production desktop/laptop system:

https://maya-steel-works-mgt.vercel.app

The responsive web application is the official desktop experience. Native Windows `.exe` and macOS `.dmg` installers have not yet been packaged.

## iPhone / iPad

The Capacitor iOS project passes unsigned simulator/native build validation, including the native App plugin used for navigation support.

A signed installable iOS package is not published yet because Apple signing/provisioning is still required.

Until native iOS distribution is configured, iPhone/iPad users can use:

https://maya-steel-works-mgt.vercel.app

## Source of truth

- Web production: `main` → Vercel (`maya-steel-works-eboa`)
- Android: `main` → GitHub Actions → `maya-latest` GitHub Release
- iOS: `main` → iOS validation workflow

Do not use old APKs from historical workflow runs for normal staff installation.
