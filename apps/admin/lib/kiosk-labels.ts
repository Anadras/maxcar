// MAX-019/MAX-020: shared plain-language labels for device_heartbeats'
// kiosk_level/kiosk_reason — kept in one place so the device detail page
// and /ao-vivo never drift into showing two different words for the same
// value (KioskLevelBadge's own tone map lives in components/ui.tsx,
// tone and label being separate concerns, same split PLAYER_STATE_TONE/
// PLAYER_STATE_LABEL already use).
export const KIOSK_LEVEL_LABEL: Record<string, string> = {
  none: '🔴 Nenhum (tela normal)',
  immersive: '🟡 Imersivo (tela cheia)',
  lock_task: '🟢 Fixação de tela (Lock Task)',
  // Pré-MAX-019: nunca mais emitido por um build atualizado, mas linhas
  // antigas continuam existindo — ver docs/architecture/ANDROID_KIOSK.md.
  device_owner: '🟡 Device Owner (detalhe indisponível — build antigo)',
  device_owner_locked: '🟢 Quiosque fixado',
  device_owner_unlocked: '🔴 Quiosque destravado',
  maintenance_mode: '🟡 Em manutenção',
  no_content_mode: '🟡 Sem conteúdo pronto',
};

// Só acompanha kiosk_level = device_owner_unlocked — as outras camadas já
// são autoexplicativas. lock_task_not_engaged é o único valor que merece
// atenção operacional; kiosk_disabled_remotely é o interruptor de frota
// (app_remote_config.kiosk_enabled) desligado de propósito.
export const KIOSK_REASON_LABEL: Record<string, string> = {
  kiosk_disabled_remotely: 'Interruptor de kiosk da frota está desligado',
  lock_task_not_engaged:
    'Nenhuma causa conhecida — deveria estar fixado e não está',
};
