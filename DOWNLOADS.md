# Maya Steel Works — Official Downloads and Installation

**Product:** Maya Steel Works, Maya Branch only  
**Production website:** https://maya-steel-works-mgt.vercel.app  
**Private repository:** https://github.com/lumuxav/maya-steel-works

## Android — install the latest APK

**[Open the latest Maya Android release](https://github.com/lumuxav/maya-steel-works/releases/latest)**

1. Sign into GitHub using an account authorized to access this private repository.
2. Open **Releases → Latest**.
3. Expand **Assets** and download **`Maya-Steel-Works.apk`**.
4. Allow Android installation from that file/browser if the device asks you.
5. Open Maya and sign in with your own Maya staff account.
6. Verify the navigation: open a subpage, press Android Back to return; on Home press Back twice within about 2.2 seconds to exit.

New releases use **versioned tags**, for example `maya-android-build-17`; the exact current version may be newer. The older fixed `maya-latest` tag is a **legacy build** and should not be used for the latest install. Avoid APKs obtained from an old GitHub Actions build/run.

### Updating an installed APK

The existing pipeline produces **debug-signed** internal APKs. An update may fail if the current APK was signed with a different debug key. If Android rejects an in-place update, verify important work has synchronized with Supabase, then uninstall the old app and install the current release. Uninstalling may erase local session/preferences and require logging in again; server-stored Maya transactions are separate.

For large-scale long-term distribution, arrange a stable release keystore and versioning process. No signed Google Play release is claimed.

Native code in `android-native/MainActivity.java` provides phone Back behavior and the double-Back exit safeguard. Business/web interface changes generally arrive through Vercel without requiring a new APK, but native changes need the new installer.

## Desktop, laptop and PWA

- **Official desktop/web app:** https://maya-steel-works-mgt.vercel.app
- Supported desktop browsers can open Maya directly.
- On supported phones/desktops use **Install app** / **Add to Home Screen** to create a shortcut or PWA.
- There is **no officially packaged** Windows `.exe` or macOS `.dmg` at this time.

## iPhone / iPad

Use https://maya-steel-works-mgt.vercel.app in Safari or another supported browser. There is a native iOS simulator-validation workflow, but no signed and distributed IPA/TestFlight app in this repository at present.

## Where builds come from

| Output | GitHub workflow | Distribution |
| --- | --- | --- |
| Web | `main` GitHub → `maya-steel-works-eboa` Vercel | Production website |
| Android | `.github/workflows/build-android-apk.yml` | **Versioned GitHub Release**, newest marked Latest |
| iOS validation | `.github/workflows/validate-ios.yml` | Unsigned simulator build, **not** an app-store download |

## Security notes

- Download from the **official private repository**, not from forwarded APK mirrors.
- Never share Maya staff passwords or database tokens.
- A custom purchased domain can be added later to the **same** Vercel and Supabase projects without erasing server data.
- For keep-alive and external website monitoring, see [Security, Deployment and Monitoring](docs/SECURITY_DEPLOYMENT_MONITORING.md).

**Do not install or distribute APKs from Universal MGT; it is an entirely separate application.**
