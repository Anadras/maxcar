import { defineConfig } from '@playwright/test';

const PORT = 3100;

// Fixed, publicly documented Supabase CLI local-dev demo credentials
// (identical for every `supabase start` instance on the default JWT
// secret). Never point E2E at Cloud/staging: this suite creates and
// deletes real rows, so it must only ever touch the disposable local
// database.
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = LOCAL_SUPABASE_ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_APP_ENV = 'e2e-local';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  expect: {
    // next dev compiles each route on first visit; give navigations room
    // beyond the default 5s so a cold compile doesn't read as a failure.
    timeout: 15_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    navigationTimeout: 20_000,
  },
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_APP_ENV: 'e2e-local',
    },
  },
});
