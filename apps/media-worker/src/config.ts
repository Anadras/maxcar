import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return parsed;
}

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  workerId: string;
  bucket: string;
  pollIntervalMs: number;
  emptyQueueBackoffMs: number;
  jobTimeoutMs: number;
  maxOutputBytes: number;
  healthPort: number;
  // How long a job can sit in 'processing' with no report before
  // reclaim_stale_media_processing_jobs treats it as abandoned. Deliberately
  // well above jobTimeoutMs (which only bounds a single ffmpeg/ffprobe
  // call, not the whole download->transcode->upload round trip) so a
  // merely-slow job is never reclaimed out from under a worker that's
  // still actively working it.
  staleJobTimeoutSeconds: number;
}

// Loaded lazily (not at import time) so unit tests that never touch env
// vars can import other modules from this package without needing a
// fake Supabase URL/key in scope.
export function loadConfig(): WorkerConfig {
  return {
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    workerId:
      process.env.MEDIA_WORKER_ID ??
      `${hostname()}-${randomUUID().slice(0, 8)}`,
    bucket: process.env.MEDIA_WORKER_BUCKET ?? 'campaign-media',
    pollIntervalMs: intEnv('MEDIA_WORKER_POLL_INTERVAL_MS', 5000),
    emptyQueueBackoffMs: intEnv('MEDIA_WORKER_EMPTY_QUEUE_BACKOFF_MS', 5000),
    jobTimeoutMs: intEnv('MEDIA_WORKER_JOB_TIMEOUT_MS', 5 * 60 * 1000),
    // Comfortably under the campaign-media bucket's 50 MB file_size_limit
    // (see 20260728090700_campaign_media_and_geofence_operations.sql) —
    // leaves headroom rather than racing the exact ceiling.
    maxOutputBytes: intEnv('MEDIA_WORKER_MAX_OUTPUT_BYTES', 45 * 1024 * 1024),
    healthPort: intEnv('MEDIA_WORKER_HEALTH_PORT', 8080),
    staleJobTimeoutSeconds: intEnv('MEDIA_WORKER_STALE_JOB_TIMEOUT_SECONDS', 900),
  };
}
