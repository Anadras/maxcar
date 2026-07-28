import { z } from 'zod';

const optionalPositiveInteger = z.preprocess(
  (value) => (value === '' || value === null ? null : value),
  z.coerce.number().int().positive().nullable(),
);

export const campaignSchema = z
  .object({
    advertiserId: z.uuid('Selecione um cliente.'),
    name: z.string().trim().min(2, 'Informe o nome da campanha.').max(160),
    campaignType: z.enum(['regular', 'geo']),
    status: z.enum([
      'draft',
      'scheduled',
      'active',
      'paused',
      'completed',
      'cancelled',
    ]),
    startsAt: z.string().min(1, 'Informe o início da campanha.'),
    endsAt: z.string().min(1, 'Informe o fim da campanha.'),
    utcOffset: z
      .string()
      .regex(/^[+-](0\d|1[0-4]):[0-5]\d$/, 'Fuso operacional inválido.'),
    dailyStartTime: z.string().optional(),
    dailyEndTime: z.string().optional(),
    priority: z.coerce.number().int().min(0).max(100),
    cooldownSeconds: z.coerce.number().int().min(0).max(86400),
    maxDailyImpressions: optionalPositiveInteger,
    activeDays: z
      .array(z.coerce.number().int().min(0).max(6))
      .min(1, 'Selecione pelo menos um dia.'),
  })
  .superRefine((value, context) => {
    const startsAt = parseOperationalDateTime(value.startsAt, value.utcOffset);
    const endsAt = parseOperationalDateTime(value.endsAt, value.utcOffset);
    if (!startsAt || !endsAt || endsAt < startsAt) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'A data final deve ser posterior à data inicial.',
      });
    }
    if (Boolean(value.dailyStartTime) !== Boolean(value.dailyEndTime)) {
      context.addIssue({
        code: 'custom',
        path: ['dailyEndTime'],
        message: 'Informe os dois horários diários ou deixe ambos vazios.',
      });
    }
    if (
      value.dailyStartTime &&
      value.dailyEndTime &&
      value.dailyEndTime < value.dailyStartTime
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dailyEndTime'],
        message:
          'Janelas atravessando meia-noite ainda não podem ser cadastradas.',
      });
    }
  });

export function parseOperationalDateTime(value: string, offset: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatOperationalDateTime(
  value: string | null,
  offset = '-04:00',
) {
  if (!value) return '';
  const offsetSign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  const totalMinutes = offsetSign * (hours * 60 + minutes);
  const adjusted = new Date(new Date(value).getTime() + totalMinutes * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

export function parseCampaignForm(formData: FormData) {
  return campaignSchema.safeParse({
    advertiserId: formData.get('advertiserId'),
    name: formData.get('name'),
    campaignType: formData.get('campaignType'),
    status: formData.get('status'),
    startsAt: formData.get('startsAt'),
    endsAt: formData.get('endsAt'),
    utcOffset: formData.get('utcOffset'),
    dailyStartTime: formData.get('dailyStartTime'),
    dailyEndTime: formData.get('dailyEndTime'),
    priority: formData.get('priority'),
    cooldownSeconds: formData.get('cooldownSeconds'),
    maxDailyImpressions: formData.get('maxDailyImpressions'),
    activeDays: formData.getAll('activeDays'),
  });
}
