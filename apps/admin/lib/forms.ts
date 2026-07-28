export function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function messageUrl(
  path: string,
  kind: 'success' | 'error',
  message: string,
) {
  const params = new URLSearchParams({ [kind]: message });
  return `${path}?${params.toString()}`;
}

export function friendlyDatabaseError(error: {
  message: string;
  code?: string;
}) {
  if (error.code === '23505')
    return 'Já existe um registro com este documento.';
  if (error.code === '42501') return 'Você não tem permissão para esta ação.';
  return error.message || 'Não foi possível concluir a operação.';
}
