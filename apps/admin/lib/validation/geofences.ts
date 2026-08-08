import { z } from 'zod';

const optionalInteger = (maximum: number, minimum = 0) =>
  z.preprocess(
    (value) => (value === '' || value === null ? null : value),
    z.coerce.number().int().min(minimum).max(maximum).nullable(),
  );

const optionalPlaybackMode = z.preprocess(
  (value) => (value === '' || value === null ? null : value),
  z.enum(['immediate', 'after_current', 'max_wait']).nullable(),
);

// A campaign linking to an existing geofence (place) — overrides only,
// no location/radius here anymore (that lives on the geofence itself,
// see geofenceLocationSchema below).
export const geofenceSchema = z.object({
  campaignId: z.uuid('Selecione uma campanha GEO.'),
  geofenceId: z.uuid('Selecione uma geofence.'),
  priorityOverride: optionalInteger(100),
  cooldownOverrideSeconds: optionalInteger(86400),
  playbackModeOverride: optionalPlaybackMode,
  maxWaitSecondsOverride: optionalInteger(30, 1),
  active: z.boolean(),
});

export const simulationSchema = z.object({
  geofenceId: z.uuid(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export function parseGeofenceForm(formData: FormData) {
  return geofenceSchema.safeParse({
    campaignId: formData.get('campaignId'),
    geofenceId: formData.get('geofenceId'),
    priorityOverride: formData.get('priorityOverride'),
    cooldownOverrideSeconds: formData.get('cooldownOverrideSeconds'),
    playbackModeOverride: formData.get('playbackModeOverride'),
    maxWaitSecondsOverride: formData.get('maxWaitSecondsOverride'),
    active: formData.get('active') === 'on',
  });
}

// A geofence itself (place) — name, point, radius, owned by one
// establishment. Mirrors establishmentSchema's shape for latitude/
// longitude (see lib/validation/establishments.ts).
export const geofenceLocationSchema = z.object({
  establishmentId: z.uuid('Selecione um estabelecimento.'),
  name: z.string().trim().min(1, 'Informe um nome para a geofence.'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(50).max(100000),
  active: z.boolean(),
});

export function parseGeofenceLocationForm(formData: FormData) {
  return geofenceLocationSchema.safeParse({
    establishmentId: formData.get('establishmentId'),
    name: formData.get('name'),
    latitude: formData.get('latitude'),
    longitude: formData.get('longitude'),
    radiusMeters: formData.get('radiusMeters'),
    active: formData.get('active') === 'on',
  });
}
