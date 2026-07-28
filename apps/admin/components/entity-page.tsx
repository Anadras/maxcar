'use client';

import { useMemo, useState } from 'react';
import { Button, DataTable, Modal, PageHeader, SectionCard, Toast } from './ui';

export function EntityPage({
  eyebrow,
  title,
  description,
  buttonLabel,
  columns,
  rows,
  filterOptions = ['Todos', 'Ativos', 'Atenção'],
}: {
  eyebrow: string;
  title: string;
  description: string;
  buttonLabel: string;
  columns: string[];
  rows: string[][];
  filterOptions?: string[];
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(filterOptions[0]);
  const [modal, setModal] = useState<'new' | 'edit' | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !search || row.some((cell) => cell.toLowerCase().includes(search));
      const status = row[row.length - 1].toLowerCase();
      const matchesFilter =
        filter === filterOptions[0] ||
        (filter.toLowerCase().includes('ativ') && status.includes('ativ')) ||
        status.includes(filter.toLowerCase().replace('s', ''));
      return matchesSearch && matchesFilter;
    });
  }, [filter, filterOptions, query, rows]);

  return (
    <div className="page">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={
          <Button onClick={() => setModal('new')}>＋ {buttonLabel}</Button>
        }
      />
      <SectionCard>
        <div className="table-toolbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Buscar em ${title.toLowerCase()}...`}
              aria-label={`Buscar em ${title}`}
            />
          </label>
          <div className="filter-pills" aria-label="Filtros">
            {filterOptions.map((option) => (
              <button
                key={option}
                className={filter === option ? 'active' : ''}
                onClick={() => setFilter(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            className="filter-button"
            onClick={() =>
              setToast(
                'Filtros avançados estarão disponíveis na integração com o backend.',
              )
            }
          >
            ⚙ Filtros
          </button>
        </div>
        {filteredRows.length > 0 ? (
          <DataTable
            columns={[...columns, 'Ações']}
            rows={filteredRows.map((row) => [...row, 'Editar'])}
            onRowClick={(row) => {
              setSelected(row);
              setModal('edit');
            }}
          />
        ) : (
          <div className="empty-state">
            <span>⌕</span>
            <strong>Nenhum resultado encontrado</strong>
            <p>Tente ajustar a busca ou o filtro selecionado.</p>
          </div>
        )}
        <div className="table-footer">
          <span>
            Exibindo {filteredRows.length} de {rows.length} registros
          </span>
          <div>
            <button disabled>‹</button>
            <button className="active">1</button>
            <button disabled>›</button>
          </div>
        </div>
      </SectionCard>
      <Modal
        title={modal === 'edit' ? `Editar ${selected?.[0] ?? ''}` : buttonLabel}
        open={modal !== null}
        onClose={() => setModal(null)}
      >
        <form
          className="demo-form"
          onSubmit={(event) => {
            event.preventDefault();
            setModal(null);
            setToast('Alteração demonstrativa salva com sucesso.');
          }}
        >
          <label>
            Nome
            <input
              defaultValue={modal === 'edit' ? selected?.[0] : ''}
              placeholder="Digite um nome"
              required
            />
          </label>
          <label>
            Status
            <select defaultValue="Ativo">
              <option>Ativo</option>
              <option>Pausado</option>
              <option>Atenção</option>
            </select>
          </label>
          <label className="full-field">
            Observações
            <textarea placeholder="Informações adicionais para esta demonstração" />
          </label>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button type="submit">Salvar demonstração</Button>
          </div>
        </form>
      </Modal>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
