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
| Local dev | Supabase CLI stack in Docker — the same services, running on your machine |
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
[Expo Go](https://expo.dev/go) app on a phone.

```bash
npm install
cp .env.example .env      # then fill in your Supabase values
npm start                 # scan the QR code with Expo Go
```

Your phone and computer need to be on the same Wi-Fi network. If they aren't,
run `npx expo start --tunnel` instead (requires `@expo/ngrok`).

A phone is the primary target — it's what gets demoed on stream, and it's the
only way to exercise the camera and biometric features later phases need. The
**Android emulator also works** and is the better choice for debugging (`adb
logcat`, screenshots, no Wi-Fi dependency). It needs the Android SDK on your
path first, which is not set by default:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
npm run android
```

There is no iOS Simulator here — the primary dev machine is Linux.

### Environment variables

See [`.env.example`](.env.example). All client-side values are prefixed
`EXPO_PUBLIC_` so Expo inlines them into the bundle. They are safe to expose
**only** because Row-Level Security governs data access — the Supabase
`secret` / `service_role` key must never appear in this app.

---

## Local Supabase — the standard development environment

From Phase 3 onward, development runs against a **local Supabase stack in
Docker**: real Postgres, real Auth, real Storage, real Row-Level Security. The
hosted project is production.

This matters more than saving free-tier quota. The storage security model *is*
a policy on `storage.objects`, so any setup that fakes storage cannot exercise
the thing being built. See [`docs/17`](docs/17-storage-architecture-review.md)
§12 for why a development-only storage provider was proposed and declined.

> **Status, 2026-08-07: decided and documented, not yet run.** Docker is
> installed and the decision is final, but `supabase start` has not been
> executed once on this machine, so the steps below are a specification rather
> than a transcript. Three things are expected to need attention on first run:
> whether the containers publish on `0.0.0.0` (so the phone can reach them),
> whether `ufw` blocks 54321–54324, and whether Expo Go accepts cleartext HTTP.
> This note goes away when the setup has been verified end to end — saying it
> works before it has is exactly the claim this project has committed not to
> make.

**One-time setup** (Docker Engine, Ubuntu):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER   # then log out and back in
```

**Every session:**

```bash
npx supabase start        # first run pulls ~4-6GB — do this off-stream
npx supabase db reset     # apply every migration from scratch
npx supabase status       # prints the API URL and anon key
```

`supabase stop` when you're done — the stack shares RAM with Metro and OBS.

### Switching between local and hosted

Expo loads `.env.local` at **higher precedence** than `.env`, and both are
gitignored. So there is no script and no flag:

| File | Points at |
|---|---|
| `.env` | The hosted project |
| `.env.local` | The local stack |

**Creating `.env.local` switches to local. Renaming it switches back.** The
hosted project therefore stays one file-rename away if the stack misbehaves
mid-stream.

> **Use your LAN IP, not `127.0.0.1`.** The app runs in Expo Go on a physical
> phone, which cannot reach your machine's loopback address. Take the port from
> `supabase status` but substitute the address `expo start` prints:
>
> ```
> EXPO_PUBLIC_SUPABASE_URL=http://192.168.x.x:54321
> ```
>
> That address is DHCP-assigned and **will change** — a one-line edit when it
> does, or reserve it on the router.

### What runs where

| | |
|---|---|
| **In Docker** | Postgres · Auth (GoTrue) · PostgREST · Realtime · Storage · imgproxy · pg-meta · API gateway · Studio · SMTP catcher |
| **On the host** | Expo/Metro (8081), Node, Jest, the Supabase CLI |
| **In the cloud** | Only the hosted project, reached by `db push` when a PR is ready |

Ports: **54321** API · **54322** Postgres · **54323** Studio · **54324** mail.
Roughly 4–6GB of disk for images and 1.5–2.5GB of RAM. `[analytics]` and
`[edge_runtime]` are disabled in `supabase/config.toml` — the first is the
stack's largest RAM consumer and this project has no Edge Functions.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Start the Expo dev server |
| `npm run android` / `npm run ios` | Open on a connected device or emulator |
| `npm test` | Run the Jest suite (what CI runs) |
| `npm run test:rls` | Run the Row-Level Security suite against a real database |
| `npm run typecheck` | Type-check without emitting |

`npm test` deliberately excludes `*.rls.test.ts`: those tests need a real
Postgres with real policies, and CI has no credentials. Run them yourself after
any change to a migration — they create two throwaway accounts on first run and
clean up after themselves, so no setup is needed.

**The RLS suite follows whichever environment the app is using.** `jest.setup.js`
loads `.env.local` ahead of `.env` for exactly this reason: `dotenv` reads `.env`
alone, so without it the app would run against the local stack while the RLS
tests silently created accounts on the *hosted* project. With the local stack
running, `npm run test:rls` touches nothing in the cloud.

### Database migrations

Schema lives in `supabase/migrations/`. Develop against the local stack, then
push to the hosted project when the PR is ready:

```bash
npx supabase db reset                                 # local: rebuild from every migration
```

```bash
cd <repo root>                                        # .temp/ is written relative to cwd
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push                                  # hosted: apply what's new
```

`db reset` is the inner loop — it drops and rebuilds the local database from
the full migration history, which is the only way to find out that a migration
does not apply cleanly from scratch.

Run `link` from the repository root — the CLI writes its link state (including
a cached database password) relative to the current directory, so running it
from elsewhere silently links the wrong place.

**Every new table needs both policies and grants.** RLS only narrows what SQL
privileges already allow, and tables created by CLI migrations do not inherit
Supabase's default privileges — see
`supabase/migrations/20260801101500_grant_family_privileges.sql`.

**A person is not an account.** `family_users` is who can sign in;
`family_members` is who is *in* the family, and most of them never will sign in
— a grandparent, a child, an ancestor. Records from Phase 3 onward attach to
`family_members`, not to accounts.

**Migrations that add a table existing rows need entries in must backfill in
the same migration**, and "when X happens, also create Y" belongs in a trigger
rather than in each calling function. Both rules exist because PR-7 broke them
and left every pre-existing family with no people — see
`supabase/migrations/20260803120000_backfill_people_and_provision_on_access.sql`.

**Scope a foreign key to the tenant where you can.** `family_relationships`
references `family_members (id, family_id)` rather than `id` alone, so a
relationship spanning two families is not merely refused by a policy — it
cannot be represented. Prefer that over a check whenever the parent table
carries the tenant column.

**Writes with preconditions belong in a `SECURITY DEFINER` function, not a
policy.** Creating a family and redeeming an invitation both have rules a
`WITH CHECK` expression cannot state, so neither `families` nor
`family_members` has an INSERT policy at all — the functions are the only way
in, and they derive the acting user from `auth.uid()` rather than trusting the
client. Any function written this way must set `search_path = ''` and fully
qualify every object it touches, or a caller can shadow a table and have it
read with elevated rights.

**`family_users` is write-closed.** It has no INSERT, UPDATE or DELETE policy,
and `update`/`delete` are revoked from `authenticated` underneath. A policy can
gate *who* writes but cannot pin *which row* or *what value*, and cannot hold a
row lock — so an Admin gated only by "may manage members" could set their own
row to `owner`. Three `SECURITY DEFINER` functions are its only writers:
`set_family_role()`, `remove_family_access()` and `leave_family()`. Every one
takes `select … from public.families where id = … for update` as its **first**
statement, because the last-owner guarantee cannot be provided by a trigger —
under `READ COMMITTED` a trigger sees the same blind snapshot the transaction
does.

**An authorisation rule is rarely a single rank comparison.** Three separate
corrections to `docs/15-permission-matrix.md` came from assuming otherwise.
`role_rank()` compares *actors* — "may I act on this person", "may I invite at
this level" — and must never appear in a permission check. Removal is the
clearest case: an Owner may remove anyone, an Admin may remove strictly below
themselves, and no single `>` or `>=` expresses both.

**Every policy calls an intent-named helper — `can_edit_people(family)` — never
a role name.** That is why the role model widened from two values to four in
PR-9a while nine of eleven policies went untouched. Every helper body is an
allow-list (`role in ('owner','admin')`, never `role <> 'guest'`); a deny-list
means each role a later phase invents silently inherits every permission
written before it existed. `role_rank()` compares *actors* and must never
appear in a permission check.

**A log is written by triggers and read by nobody's UPDATE.** `family_activity`
has no INSERT, UPDATE or DELETE policy and only a `select` grant; four
`SECURITY DEFINER` triggers are its only writers. It stores references — an
action, an actor, a subject id — and never prose, so a feed row physically
cannot carry a record's title into a screen that should not show it
(`docs/15-permission-matrix.md` §9.5). Its whole SELECT policy is one
`can_see_record` call.

**`now()` is transaction time.** Every row a transaction writes shares it, so
two events written by one function cannot be ordered. Anything that logs uses
`clock_timestamp()`.

**Every record table from Phase 3 carries the same spine** — `family_id`,
`member_id` with a composite FK, `visibility`, `created_by`, `created_at`,
`updated_at`, `deleted_at` — and its SELECT policy is exactly
`can_see_record(family_id, visibility, member_id, created_by) and deleted_at is
null`. `created_by` is the one column that genuinely cannot be added later:
there is no way to backfill who created an existing row. Full contract:
`docs/15-permission-matrix.md` §8.

---

## Project Structure

```
app/                 Routes (Expo Router — the file tree IS the navigation)
  _layout.tsx        Providers + root stack
  index.tsx          Entry: decides which stack you belong in
  (auth)/            Signed-out screens; the layout holds the guard
    login.tsx
    signup.tsx
  (app)/             Signed-in screens
    (tabs)/          The five-slot tab bar
      index.tsx      Dashboard
      family/        Nested stack: list, add a person, person detail,
                     edit details, add a relationship
      documents.tsx
      memories.tsx
      more.tsx       The eight domains without a tab, plus the account
src/
  components/        Reusable UI, no business logic
  lib/               Cross-cutting infrastructure
    env.ts           Environment resolution and validation
    supabase.ts      Shared Supabase client
    secureStore.ts   Chunked keychain adapter for session storage
  navigation/
    domains.ts       The IA domain registry the navigation renders from
  providers/
    AuthProvider.tsx   Single source of truth for the session
    FamilyProvider.tsx Current family and the caller's role
  services/          Business logic, independent of UI
    auth.ts          Sign up / in / out, validation, error wording
    family.ts        Family creation, lookup, and the caller's role
    invitation.ts    Invite codes and redemption
    member.ts        The people in a family, with or without accounts
    relationship.ts  How those people are connected
    connection.ts    Supabase connectivity check
  theme.ts           Design tokens from docs/10-ui-ux-design.md
supabase/
  migrations/        Schema, RLS policies, and grants — applied with the CLI
landing/             Marketing one-pager (static, separate from the app)
docs/                Planning corpus (vision → execution plan)
```

There is no `App.tsx`. The entry point is `expo-router/entry`, set as `main` in
`package.json`; Expo Router builds the navigator from `app/`.

Business logic lives in `src/services` and stays UI-free so it can be unit
tested directly — see the testing split in [`CLAUDE.md`](CLAUDE.md). Screens
call services; they never touch the Supabase client's auth methods themselves.

The `(auth)` / `(app)` split is a **rendering** boundary, not a security one.
Real protection of family data is Row-Level Security in Postgres, which arrives
with the first table in PR-5.

`src/navigation/domains.ts` is the single declaration of the twelve information
architecture domains. The tab bar and the More list both render from it, and
`domains.test.ts` asserts every domain stays reachable exactly once — so
navigation cannot silently lose a section. Adding a new domain means appending
to one array, not editing screens.

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
