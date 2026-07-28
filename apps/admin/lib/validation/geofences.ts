import { z } from 'zod';

const optionalInteger = (maximum: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? null : value),
    z.coerce.number().int().min(0).max(maximum).nullable(),
  );

export const geofenceSchema = z.object({
  campaignId: z.uuid('Selecione uma campanha GEO.'),
  establishmentId: z.uuid('Selecione um estabelecimento.'),
  radiusMeters: z.coerce.number().int().min(50).max(100000),
  priorityOverride: optionalInteger(100),
  cooldownOverrideSeconds: optionalInteger(86400),
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
    establishmentId: formData.get('establishmentId'),
    radiusMeters: formData.get('radiusMeters'),
    priorityOverride: formData.get('priorityOverride'),
    cooldownOverrideSeconds: formData.get('cooldownOverrideSeconds'),
    active: formData.get('active') === 'on',
  });
}
