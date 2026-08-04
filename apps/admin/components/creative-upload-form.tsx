'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { inspectCreativeFile } from '@/lib/validation/creatives';

interface PreparedUpload {
  ok: true;
  creativeId: string;
  storagePath: string;
}

interface UploadFailure {
  ok: false;
  error: string;
}

interface PreparationInput {
  creativeId: string;
  name: string;
  durationSeconds: number;
  creativeType: 'image' | 'video';
  extension: 'jpg' | 'jpeg' | 'png' | 'webp' | 'mp4' | 'webm';
  mimeType:
    'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm';
  fileSizeBytes: number;
  checksum: string;
}

export function CreativeUploadForm({
  prepareAction,
  finalizeAction,
  cancelAction,
}: {
  prepareAction: (
    input: PreparationInput,
  ) => Promise<PreparedUpload | UploadFailure>;
  finalizeAction: (creativeId: string) => Promise<{ ok: true } | UploadFailure>;
  cancelAction: (creativeId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(formData: FormData) {
    setBusy(true);
    setError(undefined);
    setStatus('Validando o arquivo…');
    let prepared: PreparedUpload | undefined;
    let uploaded = false;
    try {
      const file = formData.get('file');
      if (!(file instanceof File)) throw new Error('Selecione um arquivo.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const inspection = inspectCreativeFile(file, bytes);
      if (!inspection.success) throw new Error(inspection.error);
      const checksum = await sha256(bytes);
      const creativeId = crypto.randomUUID();
      const preparation = await prepareAction({
        creativeId,
        name: String(formData.get('name') ?? ''),
        durationSeconds: Number(formData.get('durationSeconds')),
        creativeType: inspection.creativeType,
        extension: inspection.extension as PreparationInput['extension'],
        mimeType: file.type as PreparationInput['mimeType'],
        fileSizeBytes: file.size,
        checksum,
      });
      if (!preparation.ok) throw new Error(preparation.error);
      prepared = preparation;

      setStatus('Enviando para o MAXCAR…');
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from('campaign-media')
        .upload(prepared.storagePath, file, {
          cacheControl: '31536000',
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) throw new Error('Não foi possível enviar o arquivo.');
      uploaded = true;

      setStatus('Finalizando…');
      const finalized = await finalizeAction(prepared.creativeId);
      if (!finalized.ok) throw new Error(finalized.error);
      setStatus('Arquivo enviado com sucesso.');
      router.refresh();
    } catch (caught) {
      if (prepared && !uploaded) await cancelAction(prepared.creativeId);
      setStatus(undefined);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível enviar o arquivo.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="creative-upload-form">
      <label>
        Nome da peça
        <input
          name="name"
          required
          maxLength={160}
          placeholder="Ex.: Oferta de agosto"
          disabled={busy}
        />
      </label>
      <label>
        Tempo na tela
        <input
          name="durationSeconds"
          type="number"
          min="0.1"
          max="86400"
          step="0.1"
          defaultValue="15"
          required
          disabled={busy}
        />
        <small>Use 15 segundos se não houver uma duração específica.</small>
      </label>
      <label className="full-field file-field">
        Arquivo
        <input
          name="file"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,image/jpeg,image/png,image/webp,video/mp4,video/webm"
          required
          disabled={busy}
        />
        <small>Imagem até 10 MB ou vídeo MP4 até 50 MB.</small>
      </label>
      <div className="form-actions full-field">
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar arquivo'}
        </button>
      </div>
      {status && (
        <p className="upload-status" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
