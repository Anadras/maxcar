import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { STATE_PATH, type E2EState } from './state';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function cleanupSql(email: string) {
  return `
update public.campaigns set status = 'cancelled' where name like 'E2E - %' and status = 'active';
delete from public.device_heartbeats where device_id in (select id from public.devices where device_code like 'TB-E2E%');
delete from public.devices where device_code like 'TB-E2E%';
delete from public.vehicles where internal_code like 'CAR-E2E%';
delete from public.drivers where full_name like 'E2E - %';
delete from public.campaign_geofences where campaign_id in (select id from public.campaigns where name like 'E2E - %');
delete from public.campaign_creatives where campaign_id in (select id from public.campaigns where name like 'E2E - %');
delete from public.campaigns where name like 'E2E - %';
delete from public.establishments where name like 'E2E - %';
delete from public.advertisers where trade_name like 'E2E - %';
alter table public.profiles disable trigger profiles_protect_last_super_admin;
delete from auth.users where email = '${email}';
alter table public.profiles enable trigger profiles_protect_last_super_admin;
`;
}

export default async function globalTeardown() {
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const paths = execFileSync('psql', [
      LOCAL_DB_URL,
      '-tA',
      '-c',
      `select storage_path from public.campaign_creatives
       where campaign_id in (select id from public.campaigns where name like 'E2E - %');`,
    ])
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (paths.length > 0) {
      await admin.storage.from('campaign-media').remove(paths);
    }
  } catch (error) {
    console.error('e2e global-teardown storage cleanup failed', error);
  }

  const email = existsSync(STATE_PATH)
    ? (JSON.parse(readFileSync(STATE_PATH, 'utf8')) as E2EState).email
    : 'no-such-e2e-user@maxcar.test';
  try {
    execFileSync('psql', [LOCAL_DB_URL, '-c', cleanupSql(email)]);
  } catch (error) {
    console.error('e2e global-teardown db cleanup failed', error);
  } finally {
    rmSync(STATE_PATH, { force: true });
  }
}
