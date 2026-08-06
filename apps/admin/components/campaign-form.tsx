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
  preselectedType,
}: {
  campaign?: Campaign;
  advertisers: Advertiser[];
  action: (formData: FormData) => void | Promise<void>;
  preselectedAdvertiser?: string;
  preselectedType?: 'regular' | 'geo';
}) {
  const activeDays = campaign?.active_days ?? [0, 1, 2, 3, 4, 5, 6];
  return (
    <form action={action} className="campaign-form">
      <section className="form-section">
        <header>
          <span>01</span>
          <div>
            <h2>O que será divulgado</h2>
            <p>Escolha o cliente, dê um nome e defina onde ela aparece.</p>
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
              defaultValue={
                campaign?.campaign_type ?? preselectedType ?? 'regular'
              }
            >
              <option value="regular">Normal — toca na programação</option>
              <option value="geo">
                Por proximidade — toca perto de um local
              </option>
            </select>
          </label>
          {campaign ? (
            <label>
              Situação
              <select name="status" defaultValue={campaign.status ?? 'draft'}>
                <option value="draft">Em preparação</option>
                <option value="scheduled">Programada</option>
                <option value="active">No ar</option>
                <option value="paused">Pausada</option>
                <option value="completed">Encerrada</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </label>
          ) : (
            <input type="hidden" name="status" value="draft" />
          )}
        </div>
      </section>
      <section className="form-section">
        <header>
          <span>02</span>
          <div>
            <h2>Quando a campanha fica disponível</h2>
            <p>O sistema começa e encerra a campanha automaticamente.</p>
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
          <input type="hidden" name="utcOffset" value="-04:00" />
          <details className="advanced-fields full-field">
            <summary>Definir dias e horários específicos (opcional)</summary>
            <div className="record-form">
              <label>
                Horário inicial
                <input
                  name="dailyStartTime"
                  type="time"
                  defaultValue={campaign?.daily_start_time?.slice(0, 5) ?? ''}
                />
              </label>
              <label>
                Horário final
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
          </details>
        </div>
      </section>
      <section className="form-section">
        <header>
          <span>03</span>
          <div>
            <h2>Regras de exibição</h2>
            <p>Os valores recomendados já estão preenchidos.</p>
          </div>
        </header>
        <div className="record-form">
          <details className="advanced-fields full-field">
            <summary>Ajustar frequência e prioridade (opcional)</summary>
            <div className="record-form">
              <label>
                Prioridade
                <select name="priority" defaultValue={campaign?.priority ?? 50}>
                  <option value="20">Baixa</option>
                  <option value="50">Normal</option>
                  <option value="70">Alta</option>
                  <option value="90">Premium</option>
                </select>
              </label>
              <label>
                Intervalo antes de repetir (segundos)
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
                Modo de exibição padrão (campanhas por proximidade)
                <select
                  name="playbackMode"
                  defaultValue={campaign?.playback_mode ?? 'immediate'}
                >
                  <option value="immediate">
                    Imediatamente — interrompe o anúncio atual
                  </option>
                  <option value="after_current">
                    Depois do anúncio atual
                  </option>
                  <option value="max_wait">Esperar um tempo máximo</option>
                </select>
                <small>
                  Só se aplica a campanhas por proximidade; pode ser ajustado
                  por geofence na aba de geofences.
                </small>
              </label>
              <label>
                Tempo máximo de espera (segundos, se &ldquo;Esperar um tempo
                máximo&rdquo;)
                <input
                  name="maxWaitSeconds"
                  type="number"
                  min="1"
                  max="30"
                  defaultValue={campaign?.max_wait_seconds ?? 5}
                  required
                />
              </label>
              <label>
                Limite diário (opcional)
                <input
                  name="maxDailyImpressions"
                  type="number"
                  min="1"
                  defaultValue={campaign?.max_daily_impressions ?? ''}
                />
              </label>
            </div>
          </details>
          <div className="eligibility-card">
            <span>i</span>
            <div>
              <strong>Você poderá revisar antes de publicar</strong>
              <p>
                Depois de salvar, envie a imagem ou o vídeo. Se for por
                proximidade, escolha também o estabelecimento e o raio.
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
        <SubmitButton>Salvar e continuar</SubmitButton>
      </div>
    </form>
  );
}
