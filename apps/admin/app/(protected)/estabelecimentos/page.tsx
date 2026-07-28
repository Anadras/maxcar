import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canWriteCommercialData } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listEstablishments } from '@/lib/data/establishments';

export default async function EstablishmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [establishments, auth] = await Promise.all([
    listEstablishments(params.q),
    getAuthContext(),
  ]);
  const canWrite = Boolean(auth && canWriteCommercialData(auth.profile.role));
  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="PONTOS DE ATIVAÇÃO"
        title="Estabelecimentos"
        description="Unidades físicas persistidas com localização PostGIS."
        action={
          canWrite ? (
            <Link
              className="button button-primary"
              href="/estabelecimentos/novo"
            >
              ＋ Novo estabelecimento
            </Link>
          ) : undefined
        }
      />
      <SectionCard>
        <form className="table-toolbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Buscar por nome ou cidade…"
              aria-label="Buscar estabelecimentos"
            />
          </label>
          <button className="button button-secondary" type="submit">
            Buscar
          </button>
        </form>
        {establishments.length === 0 ? (
          <EmptyState
            title="Nenhum estabelecimento encontrado"
            description={
              params.q
                ? 'Tente outro termo de busca.'
                : 'Cadastre a primeira unidade geográfica.'
            }
            action={
              canWrite && !params.q
                ? {
                    href: '/estabelecimentos/novo',
                    label: 'Criar estabelecimento',
                  }
                : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cliente</th>
                  <th>Endereço</th>
                  <th>Cidade</th>
                  <th>Coordenadas</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {establishments.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{item.advertiser_name ?? 'Acesso restrito'}</td>
                    <td>
                      {[item.address_line, item.number]
                        .filter(Boolean)
                        .join(', ')}
                    </td>
                    <td>
                      {item.city}/{item.state}
                    </td>
                    <td>
                      {item.latitude?.toFixed(4)}, {item.longitude?.toFixed(4)}
                    </td>
                    <td>
                      <StatusBadge value={item.active ? 'Ativo' : 'Inativo'} />
                    </td>
                    <td>
                      <Link href={`/estabelecimentos/${item.id}`}>Abrir</Link>
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
