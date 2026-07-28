'use client';

import type { Database } from '@maxcar/shared/database-types';
import { createBrowserClient } from '@supabase/ssr';
import { getPublicSupabaseConfig } from './env';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  if (!client) {
    const { url, key } = getPublicSupabaseConfig();
    client = createBrowserClient<Database>(url, key);
  }
  return client;
}
