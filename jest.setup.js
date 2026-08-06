/**
 * Makes the test suites read the same environment the app does.
 *
 * Expo loads `.env.local` at higher precedence than `.env`, so creating that
 * file is what switches the app between the local Supabase stack and the hosted
 * project. `dotenv` has no such notion — `config()` reads `.env` alone — so
 * without this shim the app would run against the local stack while the RLS
 * suite silently created throwaway accounts on the *hosted* project.
 *
 * Order matters and the direction is counter-intuitive: `dotenv` never
 * overwrites a variable that is already set, so whichever file is loaded
 * **first** wins. `.env.local` therefore comes first, and `.env` only fills in
 * what it did not define.
 *
 * The RLS test files each call `loadEnv()` themselves. Those calls become
 * harmless no-ops once these values are in `process.env`, which is why none of
 * them needed changing.
 */

const { config: loadEnv } = require('dotenv');

// `quiet` suppresses dotenv v17's per-load banner, which would otherwise print
// twice for each of the thirteen CI suites.
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });
