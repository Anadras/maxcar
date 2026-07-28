import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { getAdvertiser } from '@/lib/data/advertisers';

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
  const [client, auth] = await Promise.all([
    getAdvertiser(id),
    getAuthContext(),
  ]);
  if (!client) notFound();
  return (
    <div className="page record-page">
      <FlashMessage success={query.success} error={query.error} />
      <PageHeader
        eyebrow="CLIENTE"
        title={client.trade_name}
        description={client.legal_name}
        action={
          auth && canWriteCommercialData(auth.profile.role) ? (
            <div className="header-actions">
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
    </div>
  );
}
