import Link from 'next/link';

export function CampaignTabs({ active }: { active: 'campanhas' | 'ordem' }) {
  return (
    <div className="page-tabs">
      <Link href="/campanhas" className={active === 'campanhas' ? 'active' : undefined}>
        Campanhas
      </Link>
      <Link href="/campanhas/ordem" className={active === 'ordem' ? 'active' : undefined}>
        Ordem de exibição
      </Link>
    </div>
  );
}
