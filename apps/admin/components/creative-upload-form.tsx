import { SubmitButton } from './submit-button';

export function CreativeUploadForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="creative-upload-form">
      <label>
        Nome da peça
        <input
          name="name"
          required
          maxLength={160}
          placeholder="Ex.: Oferta de agosto"
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
        <small>Imagem até 10 MB ou vídeo MP4 até 50 MB.</small>
      </label>
      <div className="form-actions full-field">
        <SubmitButton pendingLabel="Preparando → enviando → processando…">
          Enviar arquivo
        </SubmitButton>
      </div>
    </form>
  );
}
