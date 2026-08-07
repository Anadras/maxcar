import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_LABELS,
  humanizeAuditAction,
  humanizeAuditEntity,
} from './audit-labels';

describe('humanizeAuditAction', () => {
  it('translates every apk_release action into human language, never the raw snake_case', () => {
    expect(humanizeAuditAction('publish_apk_release')).toBe('Release publicada');
    expect(humanizeAuditAction('deactivate_apk_release')).toBe('Release desativada');
    expect(humanizeAuditAction('reactivate_apk_release')).toBe('Release reativada');
  });

  it('translates the maintenance temp code action', () => {
    expect(humanizeAuditAction('generate_maintenance_temp_code')).toBe(
      'Código temporário de manutenção gerado',
    );
  });

  it('falls back to the raw action for anything not yet mapped, rather than throwing or hiding it', () => {
    expect(humanizeAuditAction('some_future_action')).toBe('some_future_action');
  });

  it('has no label with a literal underscore left in it', () => {
    for (const label of Object.values(AUDIT_ACTION_LABELS)) {
      expect(label).not.toMatch(/_/);
    }
  });
});

describe('humanizeAuditEntity', () => {
  it('never shows "Piloto" for a driver — that word is reserved for the pilot phase', () => {
    expect(humanizeAuditEntity('driver')).toBe('Motorista');
  });

  it('labels an apk_release entity', () => {
    expect(humanizeAuditEntity('apk_release')).toBe('Release de app');
  });
});
