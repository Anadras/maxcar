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

// What `-profile:v main` (see ffmpeg.ts's transcodeVideo) actually reports
// back via ffprobe. ffmpeg can silently fall back to a different profile
// than requested for some inputs (e.g. a source with 4:2:2/4:4:4 chroma
// that libx264 can't express as Main) — checking this here catches that
// class of drift between "what we told ffmpeg to produce" and "what it
// actually produced" before it ever reaches the tablet.
const ACCEPTED_H264_PROFILES = new Set(['Main', 'Constrained Baseline', 'Baseline']);

const MIN_FPS = 1;
const MAX_FPS = 60;

function parseFrameRate(rFrameRate: string | undefined): number | null {
  if (!rFrameRate) return null;
  const [numerator, denominator] = rFrameRate.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

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
  if (video.profile && !ACCEPTED_H264_PROFILES.has(video.profile)) {
    return {
      ok: false,
      reason: `Output H.264 profile is ${video.profile}, expected Main or (Constrained) Baseline.`,
    };
  }
  if (!video.width || !video.height || video.width <= 0 || video.height <= 0) {
    return { ok: false, reason: 'Output video has no measurable resolution.' };
  }
  const fps = parseFrameRate(video.r_frame_rate);
  if (fps === null || fps < MIN_FPS || fps > MAX_FPS) {
    return {
      ok: false,
      reason: `Output frame rate is ${video.r_frame_rate ?? 'unknown'}, expected between ${MIN_FPS} and ${MAX_FPS} fps.`,
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
