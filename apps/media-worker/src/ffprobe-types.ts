// Minimal shape of `ffprobe -print_format json -show_format -show_streams`
// output — only the fields this worker actually reads.
export interface FfprobeStream {
  codec_type: 'video' | 'audio' | 'subtitle' | 'data' | string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
}

export interface FfprobeFormat {
  duration?: string;
  size?: string;
  format_name?: string;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}
