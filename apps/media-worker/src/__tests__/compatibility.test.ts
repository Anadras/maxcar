import { describe, expect, it } from 'vitest';
import {
  inferMediaKind,
  evaluateVideoOutput,
  evaluateImageOutput,
} from '../compatibility.js';
import type { FfprobeResult } from '../ffprobe-types.js';

describe('inferMediaKind', () => {
  it('classifies mp4/webm as video', () => {
    expect(inferMediaKind('advertisers/a/campaigns/b/x.mp4')).toBe('video');
    expect(inferMediaKind('advertisers/a/campaigns/b/x.webm')).toBe('video');
  });

  it('classifies jpg/png/webp as image', () => {
    expect(inferMediaKind('x.jpg')).toBe('image');
    expect(inferMediaKind('x.jpeg')).toBe('image');
    expect(inferMediaKind('x.png')).toBe('image');
    expect(inferMediaKind('x.webp')).toBe('image');
  });

  it('rejects an unsupported extension rather than guessing', () => {
    expect(() => inferMediaKind('x.mov')).toThrow(/Unsupported file extension/);
  });
});

function videoProbe(
  overrides: Partial<FfprobeResult['streams'][number]> = {},
): FfprobeResult {
  return {
    format: { duration: '12.5' },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        pix_fmt: 'yuv420p',
        ...overrides,
      },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  };
}

describe('evaluateVideoOutput', () => {
  it('accepts a well-formed h264/yuv420p/aac output', () => {
    expect(evaluateVideoOutput(videoProbe())).toEqual({ ok: true });
  });

  it('accepts a silent video with no audio stream at all', () => {
    const probe = videoProbe();
    probe.streams = probe.streams.filter((s) => s.codec_type !== 'audio');
    expect(evaluateVideoOutput(probe).ok).toBe(true);
  });

  it('rejects a non-h264 video codec', () => {
    const result = evaluateVideoOutput(videoProbe({ codec_name: 'vp9' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/h264/);
  });

  it('rejects a non-yuv420p pixel format', () => {
    const result = evaluateVideoOutput(videoProbe({ pix_fmt: 'yuv444p' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/yuv420p/);
  });

  it('rejects zero video streams', () => {
    const probe = videoProbe();
    probe.streams = probe.streams.filter((s) => s.codec_type !== 'video');
    expect(evaluateVideoOutput(probe).ok).toBe(false);
  });

  it('rejects a non-aac audio codec', () => {
    const probe = videoProbe();
    probe.streams[1].codec_name = 'mp3';
    const result = evaluateVideoOutput(probe);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/aac/);
  });

  it('rejects a missing/zero duration', () => {
    const probe = videoProbe();
    probe.format.duration = undefined;
    expect(evaluateVideoOutput(probe).ok).toBe(false);
  });
});

describe('evaluateImageOutput', () => {
  it('accepts a well-formed single-frame image', () => {
    const probe: FfprobeResult = {
      format: {},
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
    };
    expect(evaluateImageOutput(probe)).toEqual({ ok: true });
  });

  it('rejects an image with no measurable dimensions', () => {
    const probe: FfprobeResult = {
      format: {},
      streams: [{ codec_type: 'video', width: 0, height: 0 }],
    };
    expect(evaluateImageOutput(probe).ok).toBe(false);
  });
});
