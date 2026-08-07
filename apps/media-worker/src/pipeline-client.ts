import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FfprobeResult } from './ffprobe-types.js';

export interface ClaimedJob {
  jobId: string;
  creativeId: string;
  mediaVersion: number;
  attempts: number;
  originalStoragePath: string;
}

export type IntermediateStatus =
  'probing' | 'transcoding' | 'validating_output';
export type TerminalStatus = 'ready' | 'incompatible' | 'failed';

export interface TerminalResultDetails {
  processedStoragePath?: string;
  processedSha256?: string;
  processedSizeBytes?: number;
  processedDurationMs?: number;
  processedMediaProbe?: FfprobeResult;
  compatibilityProfile?: string;
  error?: string;
}

// Narrow interface between job orchestration and the outside world (DB +
// object storage) — the same pattern as the Android app's
// MaintenanceTempCodeVerifier: keeps processJob's unit tests trivial
// (a fake implementing this interface) without a live Supabase project.
export interface PipelineClient {
  claimNextJob(workerId: string): Promise<ClaimedJob | null>;
  reclaimStaleJobs(staleAfterSeconds: number): Promise<number>;
  reportProgress(
    jobId: string,
    status: IntermediateStatus,
    probe?: FfprobeResult,
  ): Promise<void>;
  reportResult(
    jobId: string,
    status: TerminalStatus,
    details: TerminalResultDetails,
  ): Promise<void>;
  downloadOriginal(storagePath: string): Promise<Buffer>;
  uploadProcessed(
    storagePath: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void>;
}

export class SupabasePipelineClient implements PipelineClient {
  private readonly client: SupabaseClient;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async claimNextJob(workerId: string): Promise<ClaimedJob | null> {
    const { data, error } = await this.client.rpc(
      'claim_next_media_processing_job',
      {
        p_worker_id: workerId,
      },
    );
    if (error)
      throw new Error(
        `claim_next_media_processing_job failed: ${error.message}`,
      );
    const row = data?.[0];
    if (!row) return null;
    return {
      jobId: row.job_id,
      creativeId: row.creative_id,
      mediaVersion: row.media_version,
      attempts: row.attempts,
      originalStoragePath: row.original_storage_path,
    };
  }

  // MAX-017: before every claim attempt, sweep any job this (or another)
  // worker abandoned mid-processing — a crash, an OOM kill, a lost DB
  // connection — so it doesn't sit in 'processing' forever with no path
  // back to the queue. See reclaim_stale_media_processing_jobs.
  async reclaimStaleJobs(staleAfterSeconds: number): Promise<number> {
    const { data, error } = await this.client.rpc(
      'reclaim_stale_media_processing_jobs',
      { p_stale_after_seconds: staleAfterSeconds },
    );
    if (error)
      throw new Error(
        `reclaim_stale_media_processing_jobs failed: ${error.message}`,
      );
    return data ?? 0;
  }

  async reportProgress(
    jobId: string,
    status: IntermediateStatus,
    probe?: FfprobeResult,
  ): Promise<void> {
    const { error } = await this.client.rpc(
      'report_media_processing_progress',
      {
        p_job_id: jobId,
        p_status: status,
        p_media_probe: probe ?? null,
      },
    );
    if (error)
      throw new Error(
        `report_media_processing_progress failed: ${error.message}`,
      );
  }

  async reportResult(
    jobId: string,
    status: TerminalStatus,
    details: TerminalResultDetails,
  ): Promise<void> {
    const { error } = await this.client.rpc('report_media_processing_result', {
      p_job_id: jobId,
      p_status: status,
      p_processed_storage_path: details.processedStoragePath ?? null,
      p_processed_sha256: details.processedSha256 ?? null,
      p_processed_size_bytes: details.processedSizeBytes ?? null,
      p_processed_duration_ms: details.processedDurationMs ?? null,
      p_processed_media_probe: details.processedMediaProbe ?? null,
      p_compatibility_profile: details.compatibilityProfile ?? null,
      p_error: details.error ?? null,
    });
    if (error)
      throw new Error(
        `report_media_processing_result failed: ${error.message}`,
      );
  }

  async downloadOriginal(storagePath: string): Promise<Buffer> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(storagePath);
    if (error) throw new Error(`Storage download failed: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async uploadProcessed(
    storagePath: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(storagePath, bytes, {
        contentType,
        upsert: true,
      });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }
}
