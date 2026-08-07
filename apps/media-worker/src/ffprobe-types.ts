// Minimal shape of `ffprobe -print_format json -show_format -show_streams`
// output — only the fields this worker actually reads.
export interface FfprobeStream {
  codec_type: 'video' | 'audio' | 'subtitle' | 'data' | string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  // ffprobe reports this as a fraction string, e.g. "30/1" or "30000/1001",
  // never a plain number.
  r_frame_rate?: string;
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
