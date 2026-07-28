import { SubmitButton } from './submit-button';

export function CreativeUploadForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="creative-upload-form">
      <label>
        Nome do criativo
        <input name="name" required maxLength={160} />
      </label>
      <label>
        Duração de exibição em segundos
        <input
          name="durationSeconds"
          type="number"
          min="0.1"
          max="86400"
          step="0.1"
          required
        />
      </label>
      <label className="full-field file-field">
        Arquivo
        <input
          name="file"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,image/jpeg,image/png,image/webp,video/mp4,video/webm"
          required
        />
        <small>
          Imagem até 10 MB; vídeo até 50 MB. MP4/H.264 é o formato preferencial
          para o futuro Android.
        </small>
      </label>
      <div className="upload-pipeline full-field">
        <span>1. Preparando</span>
        <b>→</b>
        <span>2. Enviando</span>
        <b>→</b>
        <span>3. Processando</span>
        <b>→</b>
        <span>4. Concluído</span>
      </div>
      <div className="form-actions full-field">
        <SubmitButton pendingLabel="Preparando → enviando → processando…">
          Enviar criativo
        </SubmitButton>
      </div>
    </form>
  );
}
