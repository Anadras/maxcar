import { loadConfig } from './config.js';
import { SupabasePipelineClient } from './pipeline-client.js';
import { realFfmpegOps } from './real-ffmpeg-ops.js';
import { processClaimedJob } from './job.js';
import { startHealthServer, type HealthState } from './health.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SupabasePipelineClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    config.bucket,
  );
  const ffmpeg = realFfmpegOps(config.jobTimeoutMs);

  const health: HealthState = {
    ready: true,
    lastClaimAttemptAt: null,
    lastError: null,
  };
  const healthServer = startHealthServer(config.healthPort, health);

  let shuttingDown = false;
  let currentJobPromise: Promise<void> | null = null;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    health.ready = false;
    console.warn(
      `[${config.workerId}] received ${signal}, finishing current job (if any) then exiting`,
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.warn(
    `[${config.workerId}] media worker started, bucket=${config.bucket}`,
  );

  while (!shuttingDown) {
    health.lastClaimAttemptAt = new Date();
    try {
      const reclaimed = await client.reclaimStaleJobs(config.staleJobTimeoutSeconds);
      if (reclaimed > 0) {
        console.warn(`[${config.workerId}] reclaimed ${reclaimed} stale job(s)`);
      }
    } catch (err) {
      // Never fatal — a reclaim failure just means a stale job (if any)
      // waits one more poll cycle; it does not block this worker from
      // claiming fresh work.
      console.error(
        `[${config.workerId}] stale job reclaim failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    let job;
    try {
      job = await client.claimNextJob(config.workerId);
      health.lastError = null;
    } catch (err) {
      health.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[${config.workerId}] claim failed:`, health.lastError);
      await sleep(config.emptyQueueBackoffMs);
      continue;
    }

    if (!job) {
      await sleep(config.emptyQueueBackoffMs);
      continue;
    }

    console.warn(
      `[${config.workerId}] claimed job ${job.jobId} for creative ${job.creativeId}`,
    );
    currentJobPromise = processClaimedJob(
      job,
      client,
      ffmpeg,
      config.maxOutputBytes,
    )
      .then(() => {
        console.warn(`[${config.workerId}] finished job ${job.jobId}`);
      })
      .catch((err) => {
        // processClaimedJob already reports a terminal result for every
        // failure it can anticipate; reaching here means even the
        // failure report itself didn't make it (e.g. the DB was
        // unreachable) — the job stays stuck in 'processing' until an
        // operator or a future stale-job sweep reclaims it. Logged
        // loudly rather than silently swallowed.
        health.lastError = err instanceof Error ? err.message : String(err);
        console.error(
          `[${config.workerId}] job ${job.jobId} could not even report failure:`,
          health.lastError,
        );
      });
    await currentJobPromise;
    currentJobPromise = null;
  }

  healthServer.close();
  console.warn(`[${config.workerId}] shut down cleanly`);
}

main().catch((err) => {
  console.error('media worker crashed:', err);
  process.exit(1);
});
