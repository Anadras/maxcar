// MAX-016: audit_events.action is a stable, machine-oriented identifier
// (see audit_events_action_check) — never shown as the primary label.
// Extend this map whenever a migration adds a new action to that check
// constraint; humanizeAuditAction() falls back to the raw value so a
// forgotten entry is visible (if ugly) rather than silently blank.
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  archive: 'Arquivamento',
  restore: 'Restauração',
  deactivate: 'Desativação',
  reactivate: 'Reativação',
  unlink: 'Desvínculo',
  delete: 'Exclusão',
  set_maintenance_pin: 'PIN de manutenção alterado',
  set_maintenance_timeout: 'Tempo de manutenção alterado',
  generate_maintenance_temp_code: 'Código temporário de manutenção gerado',
  publish_apk_release: 'Release publicada',
  deactivate_apk_release: 'Release desativada',
  reactivate_apk_release: 'Release reativada',
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  advertiser: 'Cliente',
  establishment: 'Unidade',
  campaign: 'Campanha',
  driver: 'Motorista',
  vehicle: 'Veículo',
  device: 'Tablet',
  apk_release: 'Release de app',
};

export function humanizeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function humanizeAuditEntity(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType;
}
