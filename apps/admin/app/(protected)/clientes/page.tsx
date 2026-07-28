import Link from 'next/link';
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
  searchParams: Promise<{ q?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const clients = await listAdvertisers(params.q);
  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="RELACIONAMENTO COMERCIAL"
        title="Clientes"
        description="Anunciantes e parceiros persistidos na rede MAXCAR."
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
                  <th>Razão social</th>
                  <th>Documento</th>
                  <th>Contato</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <strong>{client.trade_name}</strong>
                    </td>
                    <td>{client.legal_name}</td>
                    <td>{client.document_number ?? '—'}</td>
                    <td>
                      {client.contact_email ?? client.contact_phone ?? '—'}
                    </td>
                    <td>
                      <StatusBadge value={STATUS_LABEL[client.status]} />
                    </td>
                    <td>
                      <Link href={`/clientes/${client.id}`}>Abrir</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
