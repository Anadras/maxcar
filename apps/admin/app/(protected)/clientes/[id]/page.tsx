import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_TYPE_LABELS } from '@/lib/campaigns';
import { getAdvertiser } from '@/lib/data/advertisers';
import { listCampaigns } from '@/lib/data/campaigns';
import { listEstablishmentsByAdvertiser } from '@/lib/data/establishments';

const STATUS_LABEL = {
  active: 'Ativo',
  inactive: 'Inativo',
  suspended: 'Suspenso',
} as const;

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [client, establishments, campaigns, auth] = await Promise.all([
    getAdvertiser(id),
    listEstablishmentsByAdvertiser(id),
    listCampaigns({ advertiserId: id }),
    getAuthContext(),
  ]);
  if (!client) notFound();
  const canWrite = !!auth && canWriteCommercialData(auth.profile.role);

  return (
    <div className="page record-page">
      <FlashMessage success={query.success} error={query.error} />
      <Breadcrumbs
        items={[
          { label: 'Clientes', href: '/clientes' },
          { label: client.trade_name },
        ]}
      />
      <PageHeader
        eyebrow="CLIENTE"
        title={client.trade_name}
        description={client.legal_name}
        action={
          canWrite ? (
            <div className="header-actions">
              <Link
                className="button button-secondary"
                href={`/estabelecimentos/novo?advertiser=${id}`}
              >
                ＋ Novo estabelecimento
              </Link>
              <Link
                className="button button-secondary"
                href={`/campanhas/nova?advertiser=${id}`}
              >
                ＋ Nova campanha
              </Link>
              <Link
                className="button button-primary"
                href={`/clientes/${id}/editar`}
              >
                Editar
              </Link>
            </div>
          ) : undefined
        }
      />
      <SectionCard title="Dados do anunciante">
        <dl className="detail-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge value={STATUS_LABEL[client.status]} />
            </dd>
          </div>
          <div>
            <dt>Documento</dt>
            <dd>{client.document_number ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Contato</dt>
            <dd>{client.contact_name ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{client.contact_email ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{client.contact_phone ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt>Criado em</dt>
            <dd>
              {new Intl.DateTimeFormat('pt-BR').format(
                new Date(client.created_at),
              )}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        title="Estabelecimentos"
        subtitle={`${establishments.length} unidade(s) cadastrada(s)`}
        action={
          canWrite && establishments.length > 0 ? (
            <Link
              className="button button-ghost"
              href={`/estabelecimentos/novo?advertiser=${id}`}
            >
              ＋ Novo
            </Link>
          ) : undefined
        }
      >
        {establishments.length === 0 ? (
          <EmptyState
            title="Nenhum estabelecimento ainda"
            description="Cadastre o primeiro ponto de ativação deste cliente para poder criar campanhas GEO."
            action={
              canWrite
                ? {
                    href: `/estabelecimentos/novo?advertiser=${id}`,
                    label: 'Novo estabelecimento',
                  }
                : undefined
            }
          />
        ) : (
          <ul className="link-list">
            {establishments.map((item) => (
              <li key={item.id}>
                <Link href={`/estabelecimentos/${item.id}`}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.city}/{item.state}
                  </span>
                  <StatusBadge value={item.active ? 'Ativo' : 'Inativo'} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Campanhas"
        subtitle={`${campaigns.length} campanha(s)`}
        action={
          canWrite && campaigns.length > 0 ? (
            <Link
              className="button button-ghost"
              href={`/campanhas/nova?advertiser=${id}`}
            >
              ＋ Nova
            </Link>
          ) : undefined
        }
      >
        {campaigns.length === 0 ? (
          <EmptyState
            title="Nenhuma campanha ainda"
            description="Crie a primeira campanha deste cliente — REGULAR para a grade normal ou GEO para ativação por proximidade."
            action={
              canWrite
                ? {
                    href: `/campanhas/nova?advertiser=${id}`,
                    label: 'Nova campanha',
                  }
                : undefined
            }
          />
        ) : (
          <ul className="link-list">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link href={`/campanhas/${campaign.id}`}>
                  <strong>{campaign.name}</strong>
                  <span>
                    {campaign.campaign_type
                      ? CAMPAIGN_TYPE_LABELS[campaign.campaign_type]
                      : '—'}
                  </span>
                  <StatusBadge
                    value={
                      campaign.status
                        ? CAMPAIGN_STATUS_LABELS[campaign.status]
                        : '—'
                    }
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
