import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { STATE_PATH } from './state';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = `e2e-${randomUUID()}@maxcar.test`;
  const password = `${randomUUID()}Aa1!`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`e2e global-setup createUser: ${error.message}`);
  const userId = data.user.id;

  execFileSync('psql', [
    LOCAL_DB_URL,
    '-c',
    `update public.profiles set role = 'super_admin', active = true where id = '${userId}';`,
  ]);

  writeFileSync(
    STATE_PATH,
    JSON.stringify({ userId, email, password }, null, 2),
  );
}
