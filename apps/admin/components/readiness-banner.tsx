import type { CampaignReadinessIssue } from '@maxcar/business-rules';
import { CAMPAIGN_READINESS_ISSUE_LABELS } from '@/lib/campaigns';

export function ReadinessBanner({
  ready,
  issues,
}: {
  ready: boolean;
  issues: CampaignReadinessIssue[];
}) {
  return (
    <div className={`readiness-banner ${ready ? 'ready' : 'not-ready'}`}>
      <span>{ready ? '✓' : '!'}</span>
      <div>
        <strong>
          {ready
            ? 'Campanha pronta para publicar'
            : 'Falta concluir a campanha'}
        </strong>
        <p>
          {ready
            ? 'Revise e coloque no ar quando quiser.'
            : issues
                .map((issue) => CAMPAIGN_READINESS_ISSUE_LABELS[issue])
                .join(' ')}
        </p>
      </div>
    </div>
  );
}
