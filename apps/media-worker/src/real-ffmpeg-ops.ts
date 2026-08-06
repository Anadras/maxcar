import { probe, transcodeVideo, transcodeImage } from './ffmpeg.js';
import type { FfmpegOps } from './job.js';

export function realFfmpegOps(timeoutMs: number): FfmpegOps {
  return {
    probe: (filePath) => probe(filePath, timeoutMs),
    transcodeVideo: (input, output) => transcodeVideo(input, output, timeoutMs),
    transcodeImage: (input, output) => transcodeImage(input, output, timeoutMs),
  };
}
