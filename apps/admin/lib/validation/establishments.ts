import { z } from 'zod';

export const establishmentSchema = z.object({
  advertiserId: z.uuid('Selecione um cliente.'),
  name: z.string().trim().min(2, 'Informe o nome.').max(160),
  addressLine: z.string().trim().min(2, 'Informe o logradouro.').max(200),
  number: z.string().trim().max(30).optional(),
  complement: z.string().trim().max(100).optional(),
  neighborhood: z.string().trim().max(100).optional(),
  city: z.string().trim().min(2, 'Informe a cidade.').max(120),
  state: z
    .string()
    .trim()
    .length(2, 'Use a sigla do estado com 2 letras.')
    .transform((value) => value.toUpperCase()),
  postalCode: z.string().trim().max(20).optional(),
  latitude: z.coerce.number().min(-90, 'Latitude mínima: -90.').max(90),
  longitude: z.coerce.number().min(-180, 'Longitude mínima: -180.').max(180),
  active: z.boolean(),
});

export type EstablishmentInput = z.infer<typeof establishmentSchema>;

export function parseEstablishmentForm(formData: FormData) {
  return establishmentSchema.safeParse({
    advertiserId: formData.get('advertiserId'),
    name: formData.get('name'),
    addressLine: formData.get('addressLine'),
    number: formData.get('number'),
    complement: formData.get('complement'),
    neighborhood: formData.get('neighborhood'),
    city: formData.get('city'),
    state: formData.get('state'),
    postalCode: formData.get('postalCode'),
    latitude: formData.get('latitude'),
    longitude: formData.get('longitude'),
    active: formData.get('active') === 'on',
  });
}
