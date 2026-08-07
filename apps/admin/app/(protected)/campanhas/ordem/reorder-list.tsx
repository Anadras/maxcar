'use client';

import { useState } from 'react';
import { StatusBadge, Toast } from '@/components/ui';
import { CAMPAIGN_STATUS_LABELS } from '@/lib/campaigns';
import { reorderCampaigns } from './actions';

export interface OrderRow {
  campaignId: string;
  name: string;
  advertiserName: string | null;
  status: string;
}

export function ReorderList({ initialRows }: { initialRows: OrderRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [savedRows, setSavedRows] = useState(initialRows);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const dirty = rows.some((row, index) => row.campaignId !== savedRows[index]?.campaignId);

  function moveTo(from: number, to: number) {
    if (from === to) return;
    setRows((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await reorderCampaigns(rows.map((row) => row.campaignId));
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSavedRows(rows);
    setToast('Ordem salva.');
  }

  function handleCancel() {
    setRows(savedRows);
    setError(null);
  }

  if (rows.length === 0) {
    return (
      <p className="section-empty">
        Nenhuma campanha REGULAR ativa para ordenar. Publique uma campanha
        REGULAR para que ela entre nesta fila.
      </p>
    );
  }

  return (
    <div className="reorder-panel">
      <p className="reorder-hint">
        As campanhas REGULAR são reproduzidas nesta sequência. Campanhas GEO
        seguem suas próprias regras de prioridade e interrupção e não
        aparecem aqui.
      </p>
      <ul className="reorder-list">
        {rows.map((row, index) => (
          <li
            key={row.campaignId}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null) moveTo(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={dragIndex === index ? 'reorder-item dragging' : 'reorder-item'}
          >
            <span className="reorder-handle" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="reorder-position">{index + 1}</span>
            <span className="reorder-name">
              <strong>{row.name}</strong>
              <small>{row.advertiserName ?? 'Acesso restrito'}</small>
            </span>
            <StatusBadge value={CAMPAIGN_STATUS_LABELS[row.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? row.status} />
            <span className="reorder-controls">
              <button
                type="button"
                className="icon-button"
                disabled={index === 0}
                onClick={() => moveTo(index, index - 1)}
                aria-label={`Mover ${row.name} para cima`}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={index === rows.length - 1}
                onClick={() => moveTo(index, index + 1)}
                aria-label={`Mover ${row.name} para baixo`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="form-message form-message-error">{error}</p>}
      <div className="reorder-actions">
        {dirty && <span className="reorder-dirty-hint">Alterações não salvas</span>}
        <button
          type="button"
          className="button button-ghost"
          disabled={!dirty || saving}
          onClick={handleCancel}
        >
          Cancelar alterações
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? 'Salvando…' : 'Salvar ordem'}
        </button>
      </div>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
