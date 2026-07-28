import { z } from 'zod';

export const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
export const VIDEO_LIMIT_BYTES = 50 * 1024 * 1024;

const supportedFiles = {
  'image/jpeg': {
    type: 'image',
    extensions: ['jpg', 'jpeg'],
    signature: (bytes: Uint8Array) =>
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/png': {
    type: 'image',
    extensions: ['png'],
    signature: (bytes: Uint8Array) =>
      bytesToHex(bytes.slice(0, 8)) === '89504e470d0a1a0a',
  },
  'image/webp': {
    type: 'image',
    extensions: ['webp'],
    signature: (bytes: Uint8Array) =>
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP',
  },
  'video/mp4': {
    type: 'video',
    extensions: ['mp4'],
    signature: (bytes: Uint8Array) =>
      new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp',
  },
  'video/webm': {
    type: 'video',
    extensions: ['webm'],
    signature: (bytes: Uint8Array) =>
      bytesToHex(bytes.slice(0, 4)) === '1a45dfa3',
  },
} as const;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export const creativeMetadataSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do criativo.').max(160),
  durationSeconds: z.coerce.number().positive().max(86400),
});

export function inspectCreativeFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
  bytes: Uint8Array,
) {
  const definition = supportedFiles[file.type as keyof typeof supportedFiles];
  if (!definition) {
    return { success: false as const, error: 'Formato de arquivo não aceito.' };
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(definition.extensions as readonly string[]).includes(extension)) {
    return {
      success: false as const,
      error: 'A extensão não corresponde ao tipo MIME informado.',
    };
  }
  const limit =
    definition.type === 'image' ? IMAGE_LIMIT_BYTES : VIDEO_LIMIT_BYTES;
  if (file.size <= 0 || file.size > limit) {
    return {
      success: false as const,
      error:
        definition.type === 'image'
          ? 'A imagem deve ter no máximo 10 MB.'
          : 'O vídeo deve ter no máximo 50 MB.',
    };
  }
  if (!definition.signature(bytes)) {
    return {
      success: false as const,
      error: 'A assinatura interna do arquivo é inválida.',
    };
  }
  return {
    success: true as const,
    creativeType: definition.type,
    extension,
  };
}
