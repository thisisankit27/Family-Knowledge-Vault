# Family Knowledge Vault

A digital home that preserves everything a family knows, owns, celebrates, and wants to pass on.

Built in public, one pull request per live stream. The full product vision lives in
[`docs/01-vision.md`](docs/01-vision.md); the day-to-day build plan is
[`docs/14-pr-execution-plan.md`](docs/14-pr-execution-plan.md).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Mobile app | React Native via Expo SDK 54 (TypeScript) — iOS + Android from one codebase |
| Backend | Supabase — Postgres, Auth, Storage, Row-Level Security |
| Database | PostgreSQL (via Supabase) |
| Tests | Jest (`jest-expo` preset) |
| CI | GitHub Actions — typecheck + tests |

> **Why Expo SDK 54 and not the newest?** The Expo Go app published on the
> Play Store trails the SDK release train — it was still on 54.x while SDK 57
> was current, so an SDK 57 project simply refuses to open in it. Since this
> project is demoed live on a real phone every stream, the SDK is pinned to
> whatever Expo Go can actually run. Revisit when the store app catches up, or
> if the project moves to a custom dev build.

---

## Getting Started

**Prerequisites:** Node 22+, a free Supabase project, and the
[Expo Go](https://expo.dev/go) app on a phone (this repo targets devices, not
simulators — the primary dev machine is Linux, so no iOS Simulator).

```bash
npm install
cp .env.example .env      # then fill in your Supabase values
npm start                 # scan the QR code with Expo Go
```

Your phone and computer need to be on the same Wi-Fi network. If they aren't,
run `npx expo start --tunnel` instead (requires `@expo/ngrok`).

### Environment variables

See [`.env.example`](.env.example). All client-side values are prefixed
`EXPO_PUBLIC_` so Expo inlines them into the bundle. They are safe to expose
**only** because Row-Level Security governs data access — the Supabase
`secret` / `service_role` key must never appear in this app.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Start the Expo dev server |
| `npm run android` / `npm run ios` | Open on a connected device or emulator |
| `npm test` | Run the Jest suite |
| `npm run typecheck` | Type-check without emitting |

---

## Project Structure

```
App.tsx              App shell (expands into navigation in PR-4)
src/
  lib/               Cross-cutting infrastructure
    env.ts           Environment resolution and validation
    supabase.ts      Shared Supabase client
  services/          Business logic, independent of UI
    connection.ts    Supabase connectivity check
  theme.ts           Design tokens from docs/10-ui-ux-design.md
landing/             Marketing one-pager (static, separate from the app)
docs/                Planning corpus (vision → execution plan)
```

Business logic lives in `src/services` and stays UI-free so it can be unit
tested directly — see the testing split in [`CLAUDE.md`](CLAUDE.md).

---

## Landing Page

**Live at [family.vibethroughcode.com](https://family.vibethroughcode.com/)**

`landing/` is a static marketing one-pager — plain HTML and CSS, no build step,
no dependencies, and no external network requests (system fonts only). It is
deliberately kept out of the app codebase so it can never affect the Expo
bundle, the type check, or CI.

Preview it locally with any static server:

```bash
cd landing && python3 -m http.server 4321
```

**Deployment (Vercel):** [`vercel.json`](vercel.json) sets `outputDirectory` to
`landing` and disables the build and install steps — without that, Vercel would
find the root `package.json` and try to build the React Native app. Every push
to `master` redeploys automatically.

Keep the Vercel project's **Root Directory as `./`**, not `landing` — Vercel
reads `vercel.json` from the Root Directory, so pointing it deeper would
silently discard this configuration. The "Other" framework preset is correct.
The page needs no environment variables.

Its palette is copied from `src/theme.ts` on purpose, so the site and the
product read as one thing.
