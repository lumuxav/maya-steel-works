# Maya Steel Works — Downloads

This page is the easiest place to find the current Maya Steel Works applications and live system.

## Android

**Direct APK:**

https://github.com/lumuxav/maya-steel-works/releases/download/maya-latest/Maya-Steel-Works.apk

**Latest release page:**

https://github.com/lumuxav/maya-steel-works/releases/tag/maya-latest

The Android APK is built from the `main` branch and connects to the live production system at:

https://maya-steel-works-mgt.vercel.app

> Android may ask you to allow installation from your browser or Files app because this is a direct APK installation rather than a Play Store installation.

## Desktop

The production desktop version currently runs through the web application:

https://maya-steel-works-mgt.vercel.app

It is fully responsive for desktop/laptop use. Native Windows `.exe` and macOS `.dmg` installers have not yet been packaged.

## iPhone / iPad

The Capacitor iOS project has passed an unsigned iPhone/iPad simulator build validation from `main`.

A directly installable signed iOS app is **not published yet** because Apple requires signing/distribution credentials. Until that step is completed, iPhone and iPad users can use the production web/PWA version:

https://maya-steel-works-mgt.vercel.app

## Source of truth

All production application work is kept on the `main` branch.

- Web production: `main` → Vercel
- Android: `main` → GitHub Actions → `maya-latest` GitHub Release
- iOS: `main` → iOS validation workflow

Do not download old APKs from older Actions runs unless you specifically need an older test build. For normal installation, always use the `maya-latest` release above.
