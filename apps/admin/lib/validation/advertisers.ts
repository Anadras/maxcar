import { z } from 'zod';

const optionalEmail = z
  .union([z.literal(''), z.email('Informe um e-mail válido.')])
  .optional();

export const advertiserSchema = z.object({
  legalName: z.string().trim().min(2, 'Informe a razão social.').max(160),
  tradeName: z.string().trim().min(2, 'Informe o nome fantasia.').max(160),
  documentNumber: z.string().trim().max(30).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: optionalEmail,
  contactPhone: z.string().trim().max(30).optional(),
  status: z.enum(['active', 'inactive', 'suspended']),
});

export type AdvertiserInput = z.infer<typeof advertiserSchema>;

export function parseAdvertiserForm(formData: FormData) {
  return advertiserSchema.safeParse({
    legalName: formData.get('legalName'),
    tradeName: formData.get('tradeName'),
    documentNumber: formData.get('documentNumber'),
    contactName: formData.get('contactName'),
    contactEmail: formData.get('contactEmail'),
    contactPhone: formData.get('contactPhone'),
    status: formData.get('status'),
  });
}
