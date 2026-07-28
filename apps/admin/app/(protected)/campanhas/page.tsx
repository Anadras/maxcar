'use client';

import { useMemo, useState } from 'react';
import { campaigns } from '@/lib/mock-data';
import {
  Button,
  Modal,
  PageHeader,
  SectionCard,
  StatusBadge,
  Toast,
} from '@/components/ui';

export default function CampaignsPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'TODAS' | 'GRADE' | 'GEO'>('TODAS');
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      campaigns.filter(
        (campaign) =>
          (type === 'TODAS' || campaign.type === type) &&
          campaign.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, type],
  );
  return (
    <div className="page">
      <PageHeader
        eyebrow="CONTEÚDO E PUBLICIDADE"
        title="Campanhas"
        description="Gerencie a programação regular e as ativações por proximidade."
        action={
          <Button onClick={() => setModal(true)}>＋ Nova campanha</Button>
        }
      />
      <div className="mini-stats">
        <article>
          <span>ATIVAS AGORA</span>
          <strong>18</strong>
          <small>11 grade · 7 GEO</small>
        </article>
        <article>
          <span>AGENDADAS</span>
          <strong>4</strong>
          <small>Próximos 30 dias</small>
        </article>
        <article>
          <span>REPRODUÇÕES</span>
          <strong>12.847</strong>
          <small>Hoje</small>
        </article>
      </div>
      <SectionCard>
        <div className="table-toolbar">
          <label className="search-box">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar campanha..."
              aria-label="Buscar campanha"
            />
          </label>
          <div className="filter-pills">
            {(['TODAS', 'GRADE', 'GEO'] as const).map((item) => (
              <button
                key={item}
                className={type === item ? 'active' : ''}
                onClick={() => setType(item)}
              >
                {item === 'TODAS' ? 'Todas' : item}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campanha</th>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Período</th>
                <th>Reproduções</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <strong>{campaign.name}</strong>
                    <small>{campaign.id}</small>
                  </td>
                  <td>{campaign.client}</td>
                  <td>
                    <StatusBadge value={campaign.type} />
                  </td>
                  <td>
                    <StatusBadge value={campaign.status} />
                  </td>
                  <td>{campaign.period}</td>
                  <td>{campaign.plays.toLocaleString('pt-BR')}</td>
                  <td>
                    <button
                      className="row-action"
                      onClick={() => setModal(true)}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{rows.length} campanhas exibidas</span>
        </div>
      </SectionCard>
      <Modal title="Nova campanha" open={modal} onClose={() => setModal(false)}>
        <form
          className="demo-form"
          onSubmit={(event) => {
            event.preventDefault();
            setModal(false);
            setToast('Campanha demonstrativa criada com sucesso.');
          }}
        >
          <label className="full-field">
            Nome da campanha
            <input placeholder="Ex.: Oferta especial de agosto" required />
          </label>
          <label>
            Tipo
            <select>
              <option>GRADE</option>
              <option>GEO</option>
            </select>
          </label>
          <label>
            Cliente
            <select>
              <option>Pizzaria Central</option>
              <option>Academia Prime</option>
              <option>Midiamax</option>
            </select>
          </label>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button type="submit">Criar campanha</Button>
          </div>
        </form>
      </Modal>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
