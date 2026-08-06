import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ClaimedJob, PipelineClient } from './pipeline-client.js';
import {
  inferMediaKind,
  evaluateVideoOutput,
  evaluateImageOutput,
  VIDEO_COMPATIBILITY_PROFILE,
  IMAGE_COMPATIBILITY_PROFILE,
} from './compatibility.js';
import { sanitizeError } from './errors.js';
import type { FfprobeResult } from './ffprobe-types.js';

export interface FfmpegOps {
  probe(filePath: string): Promise<FfprobeResult>;
  transcodeVideo(inputPath: string, outputPath: string): Promise<void>;
  transcodeImage(inputPath: string, outputPath: string): Promise<void>;
}

function originalExtension(storagePath: string): string {
  return storagePath.split('.').pop()?.toLowerCase() ?? 'bin';
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function durationMsFromProbe(probe: FfprobeResult): number | undefined {
  const seconds = Number.parseFloat(probe.format.duration ?? '');
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

// One claimed job, start to finish: download -> probe -> transcode ->
// probe output -> validate -> upload -> report. Every exit path reports
// a terminal result exactly once and always cleans up its temp
// directory, including on an unexpected throw.
export async function processClaimedJob(
  job: ClaimedJob,
  client: PipelineClient,
  ffmpeg: FfmpegOps,
  maxOutputBytes: number,
): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'maxcar-media-'));
  try {
    const kind = inferMediaKind(job.originalStoragePath);
    const originalPath = join(
      workDir,
      `original.${originalExtension(job.originalStoragePath)}`,
    );
    const outputPath = join(
      workDir,
      kind === 'video' ? 'output.mp4' : 'output.jpg',
    );

    const originalBytes = await client.downloadOriginal(
      job.originalStoragePath,
    );
    await writeFile(originalPath, originalBytes);

    const inputProbe = await ffmpeg.probe(originalPath);
    await client.reportProgress(job.jobId, 'probing', inputProbe);

    await client.reportProgress(job.jobId, 'transcoding');
    if (kind === 'video') {
      await ffmpeg.transcodeVideo(originalPath, outputPath);
    } else {
      await ffmpeg.transcodeImage(originalPath, outputPath);
    }

    const outputProbe = await ffmpeg.probe(outputPath);
    await client.reportProgress(job.jobId, 'validating_output', outputProbe);

    const evaluation =
      kind === 'video'
        ? evaluateVideoOutput(outputProbe)
        : evaluateImageOutput(outputProbe);
    if (!evaluation.ok) {
      await client.reportResult(job.jobId, 'incompatible', {
        error: evaluation.reason,
      });
      return;
    }

    const outputStats = await stat(outputPath);
    if (outputStats.size > maxOutputBytes) {
      await client.reportResult(job.jobId, 'incompatible', {
        error: `Processed output is ${outputStats.size} bytes, over the ${maxOutputBytes}-byte limit.`,
      });
      return;
    }

    const outputBytes = await readFile(outputPath);
    const outputSha256 = sha256Hex(outputBytes);
    const processedStoragePath =
      `media-processed/${job.creativeId}/${job.mediaVersion}-${outputSha256.slice(0, 16)}.` +
      (kind === 'video' ? 'mp4' : 'jpg');

    await client.uploadProcessed(
      processedStoragePath,
      outputBytes,
      kind === 'video' ? 'video/mp4' : 'image/jpeg',
    );

    await client.reportResult(job.jobId, 'ready', {
      processedStoragePath,
      processedSha256: outputSha256,
      processedSizeBytes: outputStats.size,
      processedDurationMs:
        kind === 'video' ? durationMsFromProbe(outputProbe) : undefined,
      processedMediaProbe: outputProbe,
      compatibilityProfile:
        kind === 'video'
          ? VIDEO_COMPATIBILITY_PROFILE
          : IMAGE_COMPATIBILITY_PROFILE,
    });
  } catch (err) {
    // Transient by default (infra flake, a hung/killed ffmpeg, a network
    // blip) — report_media_processing_result re-queues this with backoff
    // while job.attempts < max_attempts, and only becomes a terminal
    // failure once genuinely exhausted. A file that's structurally
    // invalid gets caught above as 'incompatible' instead, which never
    // auto-retries.
    await client.reportResult(job.jobId, 'failed', {
      error: sanitizeError(err),
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
