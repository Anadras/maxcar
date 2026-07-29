import { z } from 'zod';

export const driverSchema = z.object({
  fullName: z.string().trim().min(3, 'Informe o nome completo.').max(160),
  documentNumber: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z
    .union([z.literal(''), z.email('Informe um e-mail válido.')])
    .optional(),
  status: z.enum(['pending', 'active', 'inactive', 'suspended']),
});

export function parseDriverForm(formData: FormData) {
  return driverSchema.safeParse(Object.fromEntries(formData));
}
