// MAX-011: shared plain-language labels for the GEO playback controls —
// kept in one place so the geofence form and the read-only detail page
// never drift into showing two different words for the same value.

export const PLAYBACK_MODE_LABEL: Record<string, string> = {
  immediate: 'Imediatamente',
  after_current: 'Depois do anúncio atual',
  max_wait: 'Esperar no máximo',
};

export function formatCooldownMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}
