import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FfprobeResult } from './ffprobe-types.js';

const execFileAsync = promisify(execFile);

// Every call below passes a fixed argv array to execFile — never a shell
// string — so nothing derived from the (untrusted) uploaded file's
// content or name can be interpreted as a shell command. File paths are
// always ones this worker itself generated in its own temp directory,
// never a client-supplied string.
async function run(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

export async function probe(
  filePath: string,
  timeoutMs: number,
): Promise<FfprobeResult> {
  const stdout = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    timeoutMs,
  );
  return JSON.parse(stdout) as FfprobeResult;
}

export interface TranscodeVideoOptions {
  maxWidth: number;
  maxHeight: number;
  crf: number;
  maxBitrateKbps: number;
  audioBitrateKbps: number;
}

export const DEFAULT_VIDEO_OPTIONS: TranscodeVideoOptions = {
  maxWidth: 1920,
  maxHeight: 1080,
  crf: 23,
  maxBitrateKbps: 6000,
  audioBitrateKbps: 128,
};

export async function transcodeVideo(
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
  options: TranscodeVideoOptions = DEFAULT_VIDEO_OPTIONS,
): Promise<void> {
  // scale=... 'if(gt(iw,W),W,iw)' never upscales a smaller source; -2
  // keeps the paired dimension divisible by 2 (required for yuv420p).
  const scaleFilter =
    `scale=w='if(gt(iw,${options.maxWidth}),${options.maxWidth},iw)':` +
    `h='if(gt(ih,${options.maxHeight}),${options.maxHeight},ih)':force_original_aspect_ratio=decrease,` +
    `scale=trunc(iw/2)*2:trunc(ih/2)*2`;

  await run(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      scaleFilter,
      '-c:v',
      'libx264',
      '-profile:v',
      'main',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      String(options.crf),
      '-maxrate',
      `${options.maxBitrateKbps}k`,
      '-bufsize',
      `${options.maxBitrateKbps * 2}k`,
      '-c:a',
      'aac',
      '-b:a',
      `${options.audioBitrateKbps}k`,
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    timeoutMs,
  );
}

export interface TranscodeImageOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

export const DEFAULT_IMAGE_OPTIONS: TranscodeImageOptions = {
  maxWidth: 3840,
  maxHeight: 3840,
  quality: 4,
};

export async function transcodeImage(
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
  options: TranscodeImageOptions = DEFAULT_IMAGE_OPTIONS,
): Promise<void> {
  const scaleFilter =
    `scale=w='if(gt(iw,${options.maxWidth}),${options.maxWidth},iw)':` +
    `h='if(gt(ih,${options.maxHeight}),${options.maxHeight},ih)':force_original_aspect_ratio=decrease`;

  await run(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      scaleFilter,
      '-q:v',
      String(options.quality),
      '-frames:v',
      '1',
      outputPath,
    ],
    timeoutMs,
  );
}
