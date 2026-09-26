# Maya Steel Works Management System

## Complete Project Handover and Development Context

**Repository:** `lumuxav/maya-steel-works`  
**Production branch:** `main`  
**Production URL:** `https://maya-steel-works-mgt.vercel.app`  
**Vercel project:** `maya-steel-works-eboa`  
**Android package:** `com.mayasteelworks.management`  
**Document date:** 26 Sep 2026

> This document captures the business rules, architecture, implementation decisions, solved problems and mobile-app work reached during the development conversation. Before modifying production code, always inspect the latest `main` branch because the repository may have advanced after this handover.

---

## 1. Executive overview

Maya Steel Works Management System is a business-management platform built specifically for the day-to-day operations of Maya Steel Works. It brings stock, deliveries, production, sales, customer-owned material work, credit/debt, debt repayments, expenses, banking, cash control, reporting, alerts, user management and system administration into one responsive application.

Current architecture:

```text
GitHub
   |
   v
Vercel / Next.js application
   |
   +--> Supabase Auth
   +--> Supabase PostgreSQL
   +--> Supabase Storage / Realtime where used

Android / iOS native shells
   |
   v
Capacitor 8 -> live production web system
```

The system is intentionally scoped to **Maya Branch only**.

---

## 2. Project identity and source of truth

- GitHub repository: `lumuxav/maya-steel-works`
- Production branch: `main`
- Production website: `https://maya-steel-works-mgt.vercel.app`
- Correct Vercel project: `maya-steel-works-eboa`
- Android package ID: `com.mayasteelworks.management`
- Android app name: `Maya Steel Works`

A preview branch named `chatgpt-refinement` was used during development. At several stages it was synchronized with `main`, but future work must not assume that branch is current. Treat `main` as the production source of truth unless a new development branch is deliberately created.

The project should continue using the existing GitHub -> Vercel -> Supabase architecture unless there is a clear technical or business reason to change it.

---

## 3. Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19 |
| Styling | Tailwind CSS 4 + application CSS |
| Authentication | Supabase Auth |
| Database | Supabase/PostgreSQL |
| Hosting | Vercel |
| Source control | GitHub |
| PWA | Manifest + service worker |
| Android | Capacitor 8 + GitHub Actions |
| iOS | Capacitor 8 + Xcode build validation |

---

## 4. Maya Branch only

This installation represents Maya Branch only. It must not combine or imply knowledge of stock, sales, money, banking, production or other activity from branches that are not being recorded by this system.

Rules:

- Inventory shown here is Maya Branch inventory.
- Sales reports are Maya Branch sales.
- Cash and banking reflect Maya Branch money only.
- Production records are Maya Branch production.
- Customer-material work, corrections and alerts remain Maya Branch-scoped.
- Multi-branch functionality should only be introduced later if the business explicitly requests it and reliable shared data becomes available.

---

## 5. User roles

### Employee

Employees handle normal day-to-day operations such as permitted inventory activity, sales, customer-material work and production workflows.

Employees should not receive owner-level financial visibility or technical system-administration powers.

### Admin - business owner

In Maya, **Admin means the owner/manager of the business**, not the technical administrator.

Admin should be able to see and manage business information such as:

- daily activity
- sales and credit
- customer debts and repayments
- cash received
- expenses
- banking
- production
- stock/business discrepancies
- management alerts
- business reports
- profit/business information where implemented

The Admin owns/controls the business bank accounts and purchasing decisions.

### Super Admin - system administrator

The Super Admin manages the software/system itself.

Responsibilities include:

- create users
- change roles
- reset passwords
- disable/reactivate users
- permanently remove/archive users safely
- monitor system access
- monitor integrity issues
- troubleshoot system problems
- manage technical/system-level controls

The Admin and Super Admin roles must remain conceptually separate.

---

## 6. Authentication and account security

Authentication is handled by Supabase Auth, with Maya user profiles storing role, branch and active/inactive status.

Expected environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Security rules:

- `SUPABASE_SERVICE_ROLE_KEY` is server-side only.
- Never expose it in client/browser JavaScript.
- Never prefix it with `NEXT_PUBLIC_`.
- Never commit `.env.local` or secret credentials.
- Public and secret values must belong to the intended Supabase project.

### Immediate deactivation

Originally, disabling a user only prevented their next login. An already-open session could continue operating, which was considered dangerous.

The system was hardened so disabling should also remove active access:

- Maya profile is marked inactive.
- Supabase Auth access is revoked/banned where implemented.
- Open sessions re-check account status.
- Access is re-checked when the app/window regains focus.
- Realtime/polling fallback is used so a user does not need to log out voluntarily before access is revoked.

### Delete / archive behavior

Hard deletion of Supabase Auth users caused database errors because historical records can depend on a user's ID.

Therefore the system uses an audit-safe approach:

- Disable remains reversible.
- Delete means permanently remove the account from normal Maya operation.
- Login access is revoked.
- Deleted users disappear from normal Users & Access views.
- Historical IDs may remain internally so old sales, banking, corrections and other records still identify who performed them.

Do not blindly hard-delete user IDs referenced by business history.

---

## 7. Inventory and deliveries

Inventory has two broad categories:

### Raw materials

Examples include plain sheets, pipes, kibaati and other metal stock.

### Finished goods

Products generated or prepared for sale.

### Receive New Delivery

A delivery may contain several items from one supplier/truck. Typical fields include:

- supplier
- category
- gauge
- size/dimensions
- length
- unit
- quantity
- optional weight

The UI supports dimensional and simple item patterns.

Employee receiving staff primarily record quantities. Cost-price handling is intended to remain under management/Admin control where appropriate.

---

## 8. Production

Production records conversion of Maya-owned raw materials into finished goods.

It may track:

- raw material used
- raw units consumed
- expected yield
- actual yield
- finished product
- scrap/waste
- employee/staff member
- production history

Expected-vs-actual production differences should surface as management exceptions in Activity & Alerts.

---

## 9. Sales, credit and debt

The Sales area supports:

- finished goods
- raw materials
- make-and-sell workflows where applicable

Typical sale fields include:

- item
- quantity
- unit price
- customer
- payment status

Payment states include:

- Paid
- Partial
- Credit

Normal sales of Maya-owned stock must deduct stock appropriately.

### Debt tracking

When a sale is Partial or Credit, the customer's balance must remain traceable.

A later payment is **not a new sale**. It is a debt/customer-account repayment against an earlier transaction or balance.

Debt/payment records should capture:

- customer
- amount
- linked sale where applicable
- receiving staff member
- date/time
- notes

---

## 10. Customer-owned material work

Customers sometimes bring their own metal/material to Maya Steel Works for processing.

Examples:

- ribbing/forming
- cutting kibaati/plain strips
- louver-related work
- plate/piece processing
- other metal-processing services

### Core inventory rule

**Customer-owned material must never reduce Maya-owned inventory.**

Typical fields include:

- service performed
- measurements/job details
- plates/pieces worked
- charge per plate/piece
- customer name
- payment status

Calculation:

```text
Service total = plates/pieces worked x charge per plate/piece
```

The revenue contributes to business cash/revenue, but Maya stock remains unchanged because the material belongs to the customer.

---

## 11. Cash Book, expenses and banking

The cash story is:

```text
Opening cash carried forward
+ Cash received today
- Expenses
- Confirmed banking
= Cash still on hand / closing cash
```

### Cash carry-forward

Sometimes banking has already been completed for the day, then additional cash arrives late. That cash cannot be banked until the next business day.

Example:

```text
Day 1 closing cash: 20,000 UGX
Day 2 opening cash carried forward: 20,000 UGX
```

Unbanked closing cash must carry into the following day.

### Cash-source breakdown

Admin requested visibility into where today's money came from.

The Cash Book was enhanced to break daily cash received into sources such as:

- stock sales
- customer-material/service jobs
- debt repayments
- other recorded cash where applicable

Debt repayment details should show:

- customer
- amount
- related debt/sale
- staff member who received it
- time

### Expenses

Expenses reduce cash-on-hand and should appear in Cash Book and management activity.

Typical fields:

- description
- category
- amount
- recorded by
- timestamp

### Banking

Banking separates money physically held at Maya from money already deposited.

Records may be:

- Pending
- Confirmed

Banking differences/variances may generate management alerts.

### Full historical archive

The cash archive originally had an artificial recent-history limit and focused mainly on transaction days.

It was changed to show a continuous day-by-day history from the period the Maya system became active up to today so carried-forward cash remains understandable even on quiet days.

Obviously incorrect old transaction dates should not define when the system started operating.

---

## 12. Stocktake, lifecycle and alerts

### Stocktake

Physical stock can be compared to system stock.

Example:

```text
System quantity: 20
Physical quantity: 19
Difference: -1
```

Differences are management exceptions.

### Inventory lifecycle

Lifecycle events include:

- Received
- Sold
- Used in production
- Produced
- Stocktake adjustment

A Light-theme readability issue was corrected so status colors remain accents while descriptions, supporting text and timestamps use high-contrast theme text.

### Activity & Alerts

Management activity includes important events such as:

- credit sales
- debt repayments
- pending/flagged banking
- production variances
- stocktake differences
- expenses
- other business exceptions

Debt repayments were explicitly added so Admin can see that cash arriving today may have come from an older debt.

---

## 13. Dashboard, settings and themes

The interface was redesigned away from a generic AI-looking dashboard toward a cleaner professional mobile/business application style.

Design goals:

- professional cards
- generous whitespace
- navy/blue profile sections
- mobile bottom navigation
- desktop sidebar navigation
- readable typography
- minimal unnecessary decoration

### Themes

Users can select:

- Light
- Dark
- Navy

Theme choice belongs under Settings, not directly on the main dashboard.

### Profile

Settings supports:

- profile photo
- change photo
- remove photo
- name/role display

Profile editing is intentionally managed from Settings. The dashboard profile card should not behave like a large accidental edit button while users scroll.

### Preferences

Functional Settings preferences include:

**Notifications**

- browser notification permission
- banking alerts
- stock alerts
- production alerts
- test notification

**Display & Data**

- compact layout
- reduced motion
- number/date formatting preferences

**Help**

Built-in guidance for workflows such as sales, customer-owned material, cash carry-forward, Admin vs Super Admin and transaction errors.

---

## 14. Super Admin system controls

A dedicated System Control area was created for technical/system oversight.

It includes concepts such as:

- active users
- disabled users
- system actions today
- business/system flags
- integrity issues
- Users & Access

### Users & Access

Super Admin controls include:

- create user
- choose Employee/Admin/Super Admin role
- reset password
- disable
- reactivate
- delete/archive safely

Super Admin should not be able to accidentally remove their own critical Super Admin access through normal controls.

---

## 15. Deployment, branches and Vercel

Production flow:

```text
GitHub main commit
       |
       v
Vercel build/deploy
       |
       v
https://maya-steel-works-mgt.vercel.app
```

The confirmed Vercel project is `maya-steel-works-eboa`.

During development, preview and production URLs sometimes showed different versions because they tracked different branches. Future troubleshooting should always identify which URL and branch are being tested before concluding that a feature is missing.

---

## 16. PWA and Android application

### PWA

The web system was made installable as a Progressive Web App with:

- manifest
- standalone behavior
- service worker registration
- safe offline fallback
- app metadata/icons

Sensitive authenticated business pages/data should not be aggressively cached offline.

### Android wrapper

```text
Framework: Capacitor 8
Package ID: com.mayasteelworks.management
App name: Maya Steel Works
Production server: https://maya-steel-works-mgt.vercel.app
```

Because the Android shell loads the live production system, most business and UI changes can be deployed through Vercel without rebuilding the APK.

Native-shell changes still require a new APK build.

### APK build

GitHub Actions builds a directly installable Android APK.

Android may ask the user to allow installation from the browser or Files app because this is direct sideloading rather than Play Store installation.

The current pipeline has successfully produced APK artifacts. For long-term/professional distribution, a release keystore/signing strategy should eventually replace reliance on debug signing.

---

## 17. Cross-device mobile hardening

The first Pixel 7 APK exposed mobile-shell issues:

- content extended into the camera/status area
- UI felt slightly zoomed out
- native Android system bars looked visually disconnected from Maya

The system was hardened using safe-area and dynamic viewport techniques rather than Pixel-specific dimensions.

Current mobile logic includes:

- safe-area insets
- dynamic viewport width/height
- compact / phone / tablet / large width classification
- portrait/landscape tracking
- software keyboard state
- bottom navigation behavior while keyboard is open
- touch-target improvements

### System bars and theme

The native top/bottom areas were changed to visually follow Maya's selected theme:

- Light -> light app background
- Dark -> dark app background
- Navy -> navy app background

### iPhone input auto-zoom

Mobile form controls use iPhone-friendly text sizing, generally at least 16px on narrow screens, to avoid unwanted Safari auto-zoom when focusing inputs.

---

## 18. iPhone and iPad status

The same Capacitor codebase is used for iOS.

A GitHub Actions workflow creates the iOS project and performs an unsigned simulator build.

The first iOS validation failed only because the workflow targeted a non-existent `App.xcworkspace`. Capacitor had generated `App.xcodeproj`.

After correcting the path, the iPhone/iPad simulator build passed successfully.

Current status:

- native compile validation passes
- iPhone/iPad shell is structurally valid
- signed `.ipa` is not yet published
- Apple signing/certificates/provisioning still need to be configured

Possible later distribution routes include TestFlight, App Store and other Apple-supported internal/enterprise methods where applicable.

---

## 19. Desktop status

Desktop/laptop users currently use the responsive production web application:

`https://maya-steel-works-mgt.vercel.app`

The desktop interface uses a sidebar and full business functionality.

There is currently no official:

- `Maya-Steel-Works.exe`
- `Maya-Steel-Works.dmg`

Do not claim those installers exist until they are actually packaged. If required later, a desktop wrapper such as Tauri or Electron can be considered.

---

## 20. GitHub Actions and downloads

### Android workflow

`/.github/workflows/build-android-apk.yml`

The workflow:

1. checks out the repository
2. installs Node and Java
3. prepares Android SDK
4. installs Capacitor Android tooling
5. creates Android project
6. generates app assets
7. synchronizes Capacitor
8. builds the APK
9. uploads the artifact
10. publishes/updates the latest Android release where configured

### iOS workflow

`/.github/workflows/validate-ios.yml`

The workflow creates and synchronizes the iOS project and runs an unsigned simulator build.

### Download center

`DOWNLOADS.md` was added so future users do not need to hunt through old Actions runs.

The intended Android release tag is:

`maya-latest`

Expected APK filename:

`Maya-Steel-Works.apk`

Expected stable direct URL:

`https://github.com/lumuxav/maya-steel-works/releases/download/maya-latest/Maya-Steel-Works.apk`

Always verify the latest GitHub Actions run/release before assuming an installer is current.

---

## 21. Custom domain migration plan

Buying a domain should not require rebuilding Maya or migrating the database.

Recommended architecture remains:

```text
Custom domain
     |
     v
Vercel
     |
     v
Next.js Maya application
     |
     v
Supabase
```

Suggested structure:

```text
mayasteelworks.com              -> company/public site if desired
app.mayasteelworks.com          -> Maya Management System
mayasteelworks.com/download     -> app download page
```

When a domain is purchased:

1. Add the domain/subdomain to Vercel.
2. Configure registrar DNS records.
3. Update Supabase Site URL / redirect / trusted URL settings as required.
4. Update `capacitor.config.json` server URL and allowed navigation.
5. Rebuild Android APK against the branded domain.
6. Use the same domain later for signed iOS builds.
7. Keep the Vercel domain available during migration if helpful.

---

## 22. Important files

| File | Purpose |
| --- | --- |
| `capacitor.config.json` | Android/iOS wrapper and production server URL |
| `app/mobile-native.css` | Mobile responsiveness, safe areas and keyboard behavior |
| `app/components/SystemChrome.js` | Theme/system-bar synchronization |
| `app/components/MobileViewport.js` | Viewport, orientation and keyboard state tracking |
| `.github/workflows/build-android-apk.yml` | Android APK pipeline |
| `.github/workflows/validate-ios.yml` | iOS build validation |
| `DOWNLOADS.md` | Application download center |
| `README.md` | Main technical/business repository documentation |
| `docs/MAYA_SYSTEM_HANDOVER.md` | Editable source for this handover document |
| `docs/Maya-Steel-Works-System-Handover.pdf` | Generated downloadable handover PDF |

---

## 23. Historical problems solved

### Sale insert constraints

Sales/customer-material work encountered schema errors such as null `selling_price` or `item_id`. The application logic was adjusted to match database requirements.

### Invalid API key

Super Admin endpoints returned `Invalid API key` until Vercel/Supabase environment variables were corrected.

### Duplicate user key

Earlier user creation produced `duplicate key value violates unique constraint "users_pkey"`. Auth/profile creation was made more defensive.

### Delete-user database error

Supabase returned `Database error deleting user` because business records depended on user IDs. The design moved to audit-safe account revocation/archive behavior.

### Disabled session still operating

Deactivation originally blocked only future login. Session re-check/forced logout behavior was added.

### Preview vs production mismatch

Features appeared missing because preview and `main` were on different commits. Branch awareness became a required troubleshooting step.

### Lifecycle contrast

Pale green text was difficult to read in Light theme. Lifecycle descriptions/timestamps now use stronger theme text while status remains colored.

### Cash-source ambiguity

Debt repayments increased cash, but Admin could not identify the source. Cash-source breakdown and debt-payment alerts were added.

### Cash archive limitation

Recent-history slicing and transaction-only days made the long-term cash story incomplete. It was replaced with a continuous archive from the active-system period.

### Android safe-area/system-bar issues

Initial APK builds drew too close to the camera/status area and had grey system bars. Safe-area and theme-aware system-bar handling were introduced.

### iOS validation path

The first iOS CI run targeted `App.xcworkspace`; Capacitor generated `App.xcodeproj`. The workflow was corrected and validation passed.

---

## 24. Data integrity rules

These rules must not be broken by future work:

1. Maya Branch data only unless multi-branch is deliberately introduced.
2. Normal sale of Maya-owned stock must deduct inventory.
3. Customer-owned material processing must not deduct Maya inventory.
4. Debt repayment is not a new sale.
5. Debt repayment must increase cash for the day received.
6. Cash Book must identify where received money came from.
7. Expenses reduce cash-on-hand.
8. Confirmed banking reduces cash physically held at Maya.
9. Unbanked closing cash carries into the following day.
10. Historical user identities must be preserved when needed for audit references.
11. Disabled users must lose existing access, not only future login.
12. Admin is the business owner/manager.
13. Super Admin is the technical/system administrator.
14. Supabase service-role/secret credentials must stay server-side.
15. Native mobile wrappers should continue using the central production system for business logic/data unless the architecture is deliberately changed.

---

## 25. Production test checklist

### Authentication

- [ ] Employee login
- [ ] Admin login
- [ ] Super Admin login
- [ ] Disabled login rejected
- [ ] Already-open disabled session loses access

### Users

- [ ] Create employee
- [ ] Change role
- [ ] Reset password
- [ ] Disable/reactivate
- [ ] Delete/archive a test account

### Inventory

- [ ] Receive raw stock
- [ ] Confirm quantity changes
- [ ] Lifecycle history
- [ ] Stocktake difference

### Sales

- [ ] Paid sale
- [ ] Partial sale
- [ ] Credit sale
- [ ] Finished goods
- [ ] Raw materials

### Customer Material

- [ ] Record customer-owned material job
- [ ] Confirm Maya stock does not change
- [ ] Confirm service revenue/cash appears

### Debt

- [ ] Record repayment
- [ ] Customer balance changes
- [ ] Today cash increases
- [ ] Admin alert appears
- [ ] Cash source breakdown identifies debt repayment

### Cash Book

- [ ] Opening carry-forward
- [ ] Cash received
- [ ] Expenses
- [ ] Banking
- [ ] Closing cash
- [ ] Next-day carry-forward
- [ ] Full historical archive

### Mobile

- [ ] Small Android phone
- [ ] Large Android phone
- [ ] Tablet
- [ ] Portrait
- [ ] Landscape
- [ ] Keyboard/forms
- [ ] Gesture navigation
- [ ] Punch-hole/notch
- [ ] Light/Dark/Navy themes

### iOS

- [ ] Simulator build
- [ ] Safe areas
- [ ] Input focus/zoom
- [ ] iPhone widths
- [ ] iPad widths

---

## 26. Current status and next-stage roadmap

| Area | Status |
| --- | --- |
| Web production | Working on Vercel |
| Android APK | Build pipeline passing; direct install supported |
| iPhone/iPad | Unsigned simulator compile validation passing |
| Signed iOS distribution | Not configured yet |
| Desktop web | Working responsively |
| Native Windows `.exe` | Not built yet |
| Native macOS `.dmg` | Not built yet |
| Custom domain | Planned/optional |
| Android stable release | Release automation introduced; verify latest release |

Recommended next priorities:

1. Verify `maya-latest` Android GitHub Release publishes successfully.
2. Create a proper release-signed Android APK/AAB with a securely stored keystore for reliable future updates.
3. Connect a custom domain if desired and update Vercel, Supabase and Capacitor URLs.
4. Configure Apple Developer signing and TestFlight/App Store distribution if native iPhone installation is needed.
5. Package native Windows/macOS shells only if the responsive web/PWA desktop experience is not enough.
6. Continue real Maya Branch operational testing.

---

## 27. Future ChatGPT context prompt

If a future ChatGPT session cannot directly read this repository document, paste the following:

```text
I am continuing the Maya Steel Works Management System.
GitHub repo: lumuxav/maya-steel-works.
Production branch: main.
Production site: https://maya-steel-works-mgt.vercel.app.
Stack: Next.js 16 + React 19 + Supabase + Vercel + Capacitor 8.
Maya is a single-branch system for Maya Branch only.
Admin = business owner. Super Admin = technical/system administrator.
Customer-owned material jobs record service revenue but never deduct Maya stock.
Debt repayments increase today's cash but remain identifiable as debt repayment, not new sales.
Unbanked cash carries forward to the next day.
Disabled users must immediately lose active access.
Historical user IDs should be preserved when needed for audit records.
Themes: Light, Dark, Navy.
Android APK builds through GitHub Actions.
iOS simulator validation passes; Apple signing is still pending.
Desktop works as the responsive web app; native EXE/DMG are not yet packaged.
Before changing anything, inspect the latest main branch and preserve these business rules.
```

---

## Final handover note

This handover is intended to remain in the repository as long-term project context. It explains both **what Maya does** and **why important design decisions were made**.

If this document and the current code ever disagree, first inspect the latest `main` branch and production behavior, then update this handover so repository documentation remains current.
