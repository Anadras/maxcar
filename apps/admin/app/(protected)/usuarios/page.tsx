import { redirect } from 'next/navigation';
import { inviteUser, updateManagedUser } from './actions';
import { FlashMessage } from '@/components/flash-message';
import { PageHeader, SectionCard, StatusBadge } from '@/components/ui';
import { canManageUsers, ROLE_LABELS } from '@/lib/auth/access';
import { getAuthContext } from '@/lib/auth/context';
import { listManagedUsers } from '@/lib/data/users';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth || !canManageUsers(auth.profile.role)) redirect('/');
  const [params, result] = await Promise.all([
    searchParams,
    listManagedUsers(),
  ]);

  return (
    <div className="page">
      <FlashMessage success={params.success} error={params.error} />
      <PageHeader
        eyebrow="CONTROLE DE ACESSO"
        title="Usuários"
        description="Convites, papéis e status governados pelo perfil persistido."
      />
      {!result.configured && (
        <div className="config-notice" role="status">
          A listagem de e-mails e os convites exigem
          <code>SUPABASE_SERVICE_ROLE_KEY</code> somente no servidor. Perfis e
          permissões continuam disponíveis via RLS.
        </div>
      )}
      <SectionCard
        title="Convidar usuário"
        subtitle="Toda nova conta começa como pending."
      >
        <form action={inviteUser} className="inline-form">
          <label>
            Nome
            <input name="fullName" required maxLength={120} />
          </label>
          <label>
            E-mail
            <input name="email" type="email" required />
          </label>
          <button
            className="button button-primary"
            type="submit"
            disabled={!result.configured}
          >
            Enviar convite
          </button>
        </form>
      </SectionCard>
      <SectionCard title="Acessos cadastrados">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {result.users.map((user) => {
                const isProtected =
                  user.id === auth.userId ||
                  (user.role === 'super_admin' &&
                    auth.profile.role !== 'super_admin');
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.full_name ?? 'Sem nome'}</strong>
                    </td>
                    <td>{user.email ?? 'Chave de serviço não configurada'}</td>
                    <td>{ROLE_LABELS[user.role]}</td>
                    <td>
                      <StatusBadge value={user.active ? 'Ativo' : 'Inativo'} />
                    </td>
                    <td>
                      {new Intl.DateTimeFormat('pt-BR').format(
                        new Date(user.created_at),
                      )}
                    </td>
                    <td>
                      {isProtected ? (
                        <span className="muted-text">Protegido</span>
                      ) : (
                        <details className="user-editor">
                          <summary>Gerenciar</summary>
                          <form action={updateManagedUser.bind(null, user.id)}>
                            <label>
                              Perfil
                              <select name="role" defaultValue={user.role}>
                                <option value="pending">
                                  Aguardando aprovação
                                </option>
                                {auth.profile.role === 'super_admin' && (
                                  <option value="super_admin">
                                    Superadministrador
                                  </option>
                                )}
                                <option value="admin">Administrador</option>
                                <option value="commercial">Comercial</option>
                                <option value="operations">Operações</option>
                                <option value="advertiser">Anunciante</option>
                                <option value="driver">Motorista</option>
                              </select>
                            </label>
                            <label>
                              ID do anunciante
                              <input
                                name="advertiserId"
                                defaultValue={user.advertiser_id ?? ''}
                              />
                            </label>
                            <label>
                              ID do motorista
                              <input
                                name="driverId"
                                defaultValue={user.driver_id ?? ''}
                              />
                            </label>
                            <label className="checkbox-field">
                              <input
                                name="active"
                                type="checkbox"
                                defaultChecked={user.active}
                              />{' '}
                              Ativo
                            </label>
                            <button
                              className="button button-primary"
                              type="submit"
                            >
                              Salvar
                            </button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
