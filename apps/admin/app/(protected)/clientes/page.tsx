import Link from 'next/link';
import { Fragment } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { listAdvertisers } from '@/lib/data/advertisers';

const STATUS_LABEL = {
  active: 'Ativo',
  inactive: 'Inativo',
  suspended: 'Suspenso',
} as const;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const clients = await listAdvertisers(params.q, params.status);
  // Visually separate active clients from inactive/suspended ones (often
  // pilot test data, e.g. "Recovery Test") rather than interleaving them
  // alphabetically — no archiving, just ordering + a dimmed row style.
  const activeClients = clients.filter((client) => client.status === 'active');
  const otherClients = clients.filter((client) => client.status !== 'active');
  const orderedClients = params.status ? clients : [...activeClients, ...otherClients];
  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="RELACIONAMENTO COMERCIAL"
        title="Clientes"
        description="Abra um cliente para cuidar de suas unidades, campanhas e mídias em um só lugar."
        action={
          <Link className="button button-primary" href="/clientes/novo">
            ＋ Novo cliente
          </Link>
        }
      />
      <SectionCard>
        <form className="table-toolbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Buscar por razão social ou nome fantasia…"
              aria-label="Buscar clientes"
            />
          </label>
          <select
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Filtrar por status"
          >
            <option value="">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo (inclui dados de teste)</option>
            <option value="suspended">Suspenso</option>
          </select>
          <button className="button button-secondary" type="submit">
            Buscar
          </button>
        </form>
        {clients.length === 0 ? (
          <EmptyState
            title="Nenhum cliente encontrado"
            description={
              params.q
                ? 'Tente outro termo de busca.'
                : 'Cadastre o primeiro anunciante da operação.'
            }
            action={
              params.q
                ? undefined
                : { href: '/clientes/novo', label: 'Criar cliente' }
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Unidades</th>
                  <th>Campanhas ativas</th>
                  <th>Total de campanhas</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {orderedClients.map((client, index) => (
                  <Fragment key={client.id}>
                    {!params.status &&
                      index === activeClients.length &&
                      otherClients.length > 0 && (
                        <tr className="table-group-row" key="inactive-divider">
                          <td colSpan={6}>
                            Inativos e suspensos ({otherClients.length})
                          </td>
                        </tr>
                      )}
                    <tr
                      key={client.id}
                      className={client.status !== 'active' ? 'row-muted' : undefined}
                    >
                      <td>
                        <strong>{client.trade_name}</strong>
                      </td>
                      <td>{client.establishment_count}</td>
                      <td>{client.active_campaign_count}</td>
                      <td>{client.campaign_count}</td>
                      <td>
                        <StatusBadge value={STATUS_LABEL[client.status]} />
                      </td>
                      <td>
                        <Link href={`/clientes/${client.id}`}>Abrir</Link>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
