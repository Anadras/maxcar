import { z } from 'zod';

export function normalizeLicensePlate(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

const plateSchema = z
  .string()
  .transform(normalizeLicensePlate)
  .refine(
    (value) => value === '' || /^[A-Z]{3}(?:\d{4}|\d[A-Z]\d{2})$/.test(value),
    'Informe uma placa brasileira válida.',
  );

export const vehicleSchema = z.object({
  internalCode: z
    .string()
    .trim()
    .min(2, 'Informe o código interno.')
    .max(40)
    .transform((value) => value.toUpperCase()),
  licensePlate: plateSchema.optional(),
  make: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  year: z
    .union([z.literal(''), z.coerce.number().int().min(1980).max(2100)])
    .optional(),
  driverId: z.union([z.literal(''), z.uuid()]).optional(),
  status: z.enum(['active', 'offline', 'maintenance', 'unassigned', 'retired']),
});

export function parseVehicleForm(formData: FormData) {
  return vehicleSchema.safeParse(Object.fromEntries(formData));
}
