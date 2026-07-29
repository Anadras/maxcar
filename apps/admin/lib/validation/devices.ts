import { z } from 'zod';

export const deviceSchema = z.object({
  deviceCode: z
    .string()
    .trim()
    .min(2, 'Informe o código operacional.')
    .max(40)
    .transform((value) => value.toUpperCase()),
  vehicleId: z.union([z.literal(''), z.uuid()]).optional(),
  status: z.enum([
    'provisioning',
    'online',
    'offline',
    'maintenance',
    'retired',
  ]),
  appVersion: z.string().trim().max(40).optional(),
});

export const heartbeatSimulationSchema = z.object({
  deviceId: z.uuid(),
  batteryLevel: z.coerce.number().int().min(0).max(100),
  networkConnected: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true'),
  gpsAvailable: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export function parseDeviceForm(formData: FormData) {
  return deviceSchema.safeParse(Object.fromEntries(formData));
}

export function parseHeartbeatSimulation(formData: FormData) {
  return heartbeatSimulationSchema.safeParse(Object.fromEntries(formData));
}
