'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from '@/components/ui';
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_TYPE_LABELS,
  formatCampaignPeriod,
} from '@/lib/campaigns';

export interface CampaignRow {
  id: string;
  name: string | null;
  advertiser_name: string | null;
  campaign_type: 'regular' | 'geo';
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
  starts_at: string | null;
  ends_at: string | null;
  creative_count: number | null;
  geofence_count: number | null;
  assigned_device_count: number;
  impression_count: number | null;
}

function preparationLabel(campaign: CampaignRow) {
  if ((campaign.creative_count ?? 0) < 1) return 'Falta enviar o arquivo';
  if (campaign.campaign_type === 'geo' && (campaign.geofence_count ?? 0) < 1) {
    return 'Falta definir o local';
  }
  return campaign.status === 'active' ? 'No ar' : 'Pronta para publicar';
}

export function CampaignTable({
  campaigns,
  canWrite,
}: {
  campaigns: CampaignRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const onClickAway = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campanha</th>
            <th>Cliente</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Período</th>
            <th>Preparação</th>
            <th>Dispositivos</th>
            <th>Reproduções</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr
              key={campaign.id}
              className="clickable-row"
              tabIndex={0}
              onClick={() => router.push(`/campanhas/${campaign.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  router.push(`/campanhas/${campaign.id}`);
                }
              }}
            >
              <td>
                <strong>{campaign.name}</strong>
              </td>
              <td>{campaign.advertiser_name ?? 'Acesso restrito'}</td>
              <td>
                <StatusBadge value={CAMPAIGN_TYPE_LABELS[campaign.campaign_type]} />
              </td>
              <td>
                <StatusBadge value={CAMPAIGN_STATUS_LABELS[campaign.status]} />
              </td>
              <td>{formatCampaignPeriod(campaign.starts_at, campaign.ends_at)}</td>
              <td>{preparationLabel(campaign)}</td>
              <td>
                {campaign.assigned_device_count > 0
                  ? `${campaign.assigned_device_count} selecionado(s)`
                  : 'Todos os ativos'}
              </td>
              <td>{(campaign.impression_count ?? 0).toLocaleString('pt-BR')}</td>
              <td
                className="row-menu-cell"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="row-menu" ref={openMenuId === campaign.id ? menuRef : undefined}>
                  <button
                    type="button"
                    className="row-menu-trigger"
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === campaign.id}
                    aria-label={`Ações para ${campaign.name ?? 'campanha'}`}
                    onClick={() =>
                      setOpenMenuId(openMenuId === campaign.id ? null : campaign.id)
                    }
                  >
                    ⋯
                  </button>
                  {openMenuId === campaign.id && (
                    <div className="row-menu-list" role="menu">
                      <Link href={`/campanhas/${campaign.id}`} role="menuitem">
                        Abrir detalhes
                      </Link>
                      {canWrite && (
                        <Link href={`/campanhas/${campaign.id}/editar`} role="menuitem">
                          Editar
                        </Link>
                      )}
                      <Link
                        href={`/relatorios?campaign=${campaign.id}`}
                        role="menuitem"
                      >
                        Ver reproduções
                      </Link>
                      <Link
                        href={`/campanhas/${campaign.id}#dispositivos`}
                        role="menuitem"
                      >
                        Ver dispositivos
                      </Link>
                      {campaign.campaign_type === 'geo' && (
                        <Link
                          href={`/campanhas/${campaign.id}#geofences`}
                          role="menuitem"
                        >
                          Ver geofences
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
