import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { processClaimedJob, type FfmpegOps } from '../job.js';
import type {
  ClaimedJob,
  PipelineClient,
  TerminalStatus,
  TerminalResultDetails,
} from '../pipeline-client.js';
import type { FfprobeResult } from '../ffprobe-types.js';

function makeJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: 'job-1',
    creativeId: 'creative-1',
    mediaVersion: 1,
    attempts: 1,
    originalStoragePath: 'advertisers/a/campaigns/b/original.mp4',
    ...overrides,
  };
}

function goodVideoProbe(): FfprobeResult {
  return {
    format: { duration: '10.0' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  };
}

class FakeClient implements PipelineClient {
  progressCalls: Array<{ jobId: string; status: string }> = [];
  resultCalls: Array<{
    jobId: string;
    status: TerminalStatus;
    details: TerminalResultDetails;
  }> = [];
  uploaded: Array<{ path: string; bytes: Buffer; contentType: string }> = [];
  downloadBytes = Buffer.from('fake-original-bytes');

  async claimNextJob(): Promise<ClaimedJob | null> {
    throw new Error('not used in these tests');
  }
  async reportProgress(jobId: string, status: string): Promise<void> {
    this.progressCalls.push({ jobId, status });
  }
  async reportResult(
    jobId: string,
    status: TerminalStatus,
    details: TerminalResultDetails,
  ): Promise<void> {
    this.resultCalls.push({ jobId, status, details });
  }
  async downloadOriginal(): Promise<Buffer> {
    return this.downloadBytes;
  }
  async uploadProcessed(
    path: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    this.uploaded.push({ path, bytes, contentType });
  }
}

describe('processClaimedJob', () => {
  it('reports ready and uploads the processed derivative on a clean run', async () => {
    const client = new FakeClient();
    const ffmpeg: FfmpegOps = {
      probe: vi.fn().mockResolvedValue(goodVideoProbe()),
      transcodeVideo: vi.fn().mockImplementation(async (_input, output) => {
        await writeFile(output, Buffer.from('processed-video-bytes'));
      }),
      transcodeImage: vi.fn(),
    };

    await processClaimedJob(makeJob(), client, ffmpeg, 45 * 1024 * 1024);

    expect(client.progressCalls.map((c) => c.status)).toEqual([
      'probing',
      'transcoding',
      'validating_output',
    ]);
    expect(client.resultCalls).toHaveLength(1);
    expect(client.resultCalls[0].status).toBe('ready');
    expect(client.resultCalls[0].details.processedStoragePath).toMatch(
      /^media-processed\/creative-1\/1-[0-9a-f]{16}\.mp4$/,
    );
    expect(client.uploaded).toHaveLength(1);
    expect(client.uploaded[0].contentType).toBe('video/mp4');
  });

  it('reports incompatible (not failed) when the transcoded output fails validation', async () => {
    const client = new FakeClient();
    const badProbe: FfprobeResult = {
      format: { duration: '10.0' },
      streams: [
        { codec_type: 'video', codec_name: 'mpeg4', pix_fmt: 'yuv420p' },
      ],
    };
    const ffmpeg: FfmpegOps = {
      probe: vi.fn().mockResolvedValue(badProbe),
      transcodeVideo: vi.fn().mockImplementation(async (_input, output) => {
        await writeFile(output, Buffer.from('bad-output'));
      }),
      transcodeImage: vi.fn(),
    };

    await processClaimedJob(makeJob(), client, ffmpeg, 45 * 1024 * 1024);

    expect(client.resultCalls).toHaveLength(1);
    expect(client.resultCalls[0].status).toBe('incompatible');
    expect(client.resultCalls[0].details.error).toMatch(/h264/);
    expect(client.uploaded).toHaveLength(0);
  });

  it('reports incompatible when the output exceeds the configured size limit', async () => {
    const client = new FakeClient();
    const ffmpeg: FfmpegOps = {
      probe: vi.fn().mockResolvedValue(goodVideoProbe()),
      transcodeVideo: vi.fn().mockImplementation(async (_input, output) => {
        await writeFile(output, Buffer.alloc(100));
      }),
      transcodeImage: vi.fn(),
    };

    await processClaimedJob(makeJob(), client, ffmpeg, 50);

    expect(client.resultCalls[0].status).toBe('incompatible');
    expect(client.resultCalls[0].details.error).toMatch(
      /over the 50-byte limit/,
    );
  });

  it('reports failed (transient) when ffmpeg itself throws', async () => {
    const client = new FakeClient();
    const ffmpeg: FfmpegOps = {
      probe: vi.fn().mockResolvedValue(goodVideoProbe()),
      transcodeVideo: vi
        .fn()
        .mockRejectedValue(new Error('ffmpeg killed by signal SIGKILL')),
      transcodeImage: vi.fn(),
    };

    await processClaimedJob(makeJob(), client, ffmpeg, 45 * 1024 * 1024);

    expect(client.resultCalls).toHaveLength(1);
    expect(client.resultCalls[0].status).toBe('failed');
    expect(client.resultCalls[0].details.error).toMatch(/ffmpeg killed/);
    expect(client.uploaded).toHaveLength(0);
  });

  it('reports failed when the download itself throws, never leaving the job unreported', async () => {
    const client = new FakeClient();
    client.downloadOriginal = vi
      .fn()
      .mockRejectedValue(new Error('Storage download failed: not found'));
    const ffmpeg: FfmpegOps = {
      probe: vi.fn(),
      transcodeVideo: vi.fn(),
      transcodeImage: vi.fn(),
    };

    await processClaimedJob(makeJob(), client, ffmpeg, 45 * 1024 * 1024);

    expect(client.resultCalls).toHaveLength(1);
    expect(client.resultCalls[0].status).toBe('failed');
    expect(ffmpeg.probe).not.toHaveBeenCalled();
  });

  it('routes an image job through transcodeImage, never transcodeVideo', async () => {
    const client = new FakeClient();
    const imageProbe: FfprobeResult = {
      format: {},
      streams: [{ codec_type: 'video', width: 800, height: 600 }],
    };
    const ffmpeg: FfmpegOps = {
      probe: vi.fn().mockResolvedValue(imageProbe),
      transcodeVideo: vi.fn(),
      transcodeImage: vi.fn().mockImplementation(async (_input, output) => {
        await writeFile(output, Buffer.from('processed-image-bytes'));
      }),
    };

    await processClaimedJob(
      makeJob({
        originalStoragePath: 'advertisers/a/campaigns/b/original.jpg',
      }),
      client,
      ffmpeg,
      45 * 1024 * 1024,
    );

    expect(ffmpeg.transcodeImage).toHaveBeenCalledOnce();
    expect(ffmpeg.transcodeVideo).not.toHaveBeenCalled();
    expect(client.resultCalls[0].status).toBe('ready');
    expect(client.uploaded[0].contentType).toBe('image/jpeg');
  });
});
