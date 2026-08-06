import type { FfprobeResult } from './ffprobe-types.js';

// Matches the tablet's proven-compatible decode path (the regular02
// black-screen incident earlier in the pilot was traced to a decoder
// stall on a non-baseline stream, not a genuinely corrupt file) — h264
// main/baseline profile, yuv420p, single video stream, optional AAC
// audio. Bump the suffix if the target profile ever changes so old rows'
// compatibility_profile stays a truthful historical record.
export const VIDEO_COMPATIBILITY_PROFILE = 'maxcar-tablet-h264-v1';
export const IMAGE_COMPATIBILITY_PROFILE = 'maxcar-tablet-jpeg-v1';

export type MediaKind = 'video' | 'image';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function inferMediaKind(storagePath: string): MediaKind {
  const ext = storagePath.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  throw new Error(`Unsupported file extension for media processing: .${ext}`);
}

export interface CompatibilityResult {
  ok: boolean;
  reason?: string;
}

// Applied to the OUTPUT of our own transcode step, not the original
// upload — the original can be anything ffmpeg accepts as input; only
// what we hand back to the tablet has to satisfy this contract.
export function evaluateVideoOutput(probe: FfprobeResult): CompatibilityResult {
  const videoStreams = probe.streams.filter((s) => s.codec_type === 'video');
  if (videoStreams.length !== 1) {
    return {
      ok: false,
      reason: `Expected exactly one video stream, found ${videoStreams.length}.`,
    };
  }
  const video = videoStreams[0];
  if (video.codec_name !== 'h264') {
    return {
      ok: false,
      reason: `Output video codec is ${video.codec_name ?? 'unknown'}, expected h264.`,
    };
  }
  if (video.pix_fmt !== 'yuv420p') {
    return {
      ok: false,
      reason: `Output pixel format is ${video.pix_fmt ?? 'unknown'}, expected yuv420p.`,
    };
  }
  const audioStreams = probe.streams.filter((s) => s.codec_type === 'audio');
  if (audioStreams.length > 1) {
    return {
      ok: false,
      reason: `Expected at most one audio stream, found ${audioStreams.length}.`,
    };
  }
  if (audioStreams.length === 1 && audioStreams[0].codec_name !== 'aac') {
    return {
      ok: false,
      reason: `Output audio codec is ${audioStreams[0].codec_name ?? 'unknown'}, expected aac.`,
    };
  }
  const durationSeconds = Number.parseFloat(probe.format.duration ?? '');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, reason: 'Output has no measurable duration.' };
  }
  return { ok: true };
}

export function evaluateImageOutput(probe: FfprobeResult): CompatibilityResult {
  const imageStreams = probe.streams.filter((s) => s.codec_type === 'video');
  if (imageStreams.length !== 1) {
    return {
      ok: false,
      reason: `Expected exactly one image frame stream, found ${imageStreams.length}.`,
    };
  }
  const { width, height } = imageStreams[0];
  if (!width || !height || width <= 0 || height <= 0) {
    return { ok: false, reason: 'Output image has no measurable dimensions.' };
  }
  return { ok: true };
}
