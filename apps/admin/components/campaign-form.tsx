import type { Database } from '@maxcar/shared/database-types';
import Link from 'next/link';
import { ACTIVE_DAY_LABELS } from '@/lib/campaigns';
import { formatOperationalDateTime } from '@/lib/validation/campaigns';
import { SubmitButton } from './submit-button';

type Campaign = Database['public']['Views']['campaign_admin_view']['Row'];
type Advertiser = Database['public']['Tables']['advertisers']['Row'];

export function CampaignForm({
  campaign,
  advertisers,
  action,
  preselectedAdvertiser,
}: {
  campaign?: Campaign;
  advertisers: Advertiser[];
  action: (formData: FormData) => void | Promise<void>;
  preselectedAdvertiser?: string;
}) {
  const activeDays = campaign?.active_days ?? [0, 1, 2, 3, 4, 5, 6];
  return (
    <form action={action} className="campaign-form">
      <section className="form-section">
        <header>
          <span>01</span>
          <div>
            <h2>Informações básicas</h2>
            <p>Cliente, identidade e ciclo da campanha.</p>
          </div>
        </header>
        <div className="record-form">
          <label>
            Cliente
            <select
              name="advertiserId"
              defaultValue={
                campaign?.advertiser_id ?? preselectedAdvertiser ?? ''
              }
              required
            >
              <option value="" disabled>
                Selecione
              </option>
              {advertisers.map((advertiser) => (
                <option key={advertiser.id} value={advertiser.id}>
                  {advertiser.trade_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nome da campanha
            <input
              name="name"
              defaultValue={campaign?.name ?? ''}
              required
              maxLength={160}
            />
          </label>
          <label>
            Tipo
            <select
              name="campaignType"
              defaultValue={campaign?.campaign_type ?? 'regular'}
            >
              <option value="regular">REGULAR — grade normal</option>
              <option value="geo">GEO — ativação por proximidade</option>
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={campaign?.status ?? 'draft'}>
              <option value="draft">Rascunho</option>
              <option value="scheduled">Agendada</option>
              {campaign && <option value="active">Ativa</option>}
              <option value="paused">Pausada</option>
              <option value="completed">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
        </div>
      </section>
      <section className="form-section">
        <header>
          <span>02</span>
          <div>
            <h2>Programação</h2>
            <p>Período absoluto e janela diária operacional.</p>
          </div>
        </header>
        <div className="record-form">
          <label>
            Início
            <input
              name="startsAt"
              type="datetime-local"
              defaultValue={formatOperationalDateTime(
                campaign?.starts_at ?? null,
              )}
              required
            />
          </label>
          <label>
            Fim
            <input
              name="endsAt"
              type="datetime-local"
              defaultValue={formatOperationalDateTime(
                campaign?.ends_at ?? null,
              )}
              required
            />
          </label>
          <label>
            Fuso operacional
            <select name="utcOffset" defaultValue="-04:00">
              <option value="-04:00">Campo Grande · UTC−04:00</option>
              <option value="-03:00">Brasília · UTC−03:00</option>
            </select>
          </label>
          <div />
          <label>
            Horário diário inicial
            <input
              name="dailyStartTime"
              type="time"
              defaultValue={campaign?.daily_start_time?.slice(0, 5) ?? ''}
            />
          </label>
          <label>
            Horário diário final
            <input
              name="dailyEndTime"
              type="time"
              defaultValue={campaign?.daily_end_time?.slice(0, 5) ?? ''}
            />
          </label>
          <fieldset className="active-days full-field">
            <legend>Dias ativos</legend>
            {ACTIVE_DAY_LABELS.map((label, day) => (
              <label key={label}>
                <input
                  type="checkbox"
                  name="activeDays"
                  value={day}
                  defaultChecked={activeDays.includes(day)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </section>
      <section className="form-section">
        <header>
          <span>03</span>
          <div>
            <h2>Entrega</h2>
            <p>Prioridade, cooldown e limite diário.</p>
          </div>
        </header>
        <div className="record-form">
          <label>
            Prioridade
            <select name="priority" defaultValue={campaign?.priority ?? 50}>
              <option value="20">Baixa · 20</option>
              <option value="50">Normal · 50</option>
              <option value="70">Alta · 70</option>
              <option value="90">Premium · 90</option>
            </select>
          </label>
          <label>
            Cooldown em segundos
            <input
              name="cooldownSeconds"
              type="number"
              min="0"
              max="86400"
              defaultValue={campaign?.cooldown_seconds ?? 0}
              required
            />
          </label>
          <label>
            Limite diário opcional
            <input
              name="maxDailyImpressions"
              type="number"
              min="1"
              defaultValue={campaign?.max_daily_impressions ?? ''}
            />
          </label>
          <div className="eligibility-card">
            <span>i</span>
            <div>
              <strong>Ativação protegida</strong>
              <p>
                Campanhas ativas exigem período e criativo. GEO também exige
                geofence.
              </p>
            </div>
          </div>
        </div>
      </section>
      <div className="form-actions campaign-form-actions">
        <Link
          className="button button-ghost"
          href={campaign?.id ? `/campanhas/${campaign.id}` : '/campanhas'}
        >
          Cancelar
        </Link>
        <SubmitButton>Salvar campanha</SubmitButton>
      </div>
    </form>
  );
}
