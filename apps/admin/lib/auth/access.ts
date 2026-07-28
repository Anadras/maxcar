import type { AppRole } from '@maxcar/shared/database-types';

export const STAFF_ROLES: AppRole[] = [
  'super_admin',
  'admin',
  'commercial',
  'operations',
];

export const ROLE_LABELS: Record<AppRole, string> = {
  pending: 'Aguardando aprovação',
  super_admin: 'Superadministrador',
  admin: 'Administrador',
  commercial: 'Comercial',
  operations: 'Operações',
  advertiser: 'Anunciante',
  driver: 'Motorista',
};

export function destinationForProfile(
  role: AppRole,
  active: boolean,
): '/' | '/pending' | '/acesso-indisponivel' {
  if (!active || role === 'advertiser' || role === 'driver') {
    return '/acesso-indisponivel';
  }
  if (role === 'pending') return '/pending';
  return '/';
}

export function canManageUsers(role: AppRole) {
  return role === 'super_admin' || role === 'admin';
}

export function canWriteCommercialData(role: AppRole) {
  return role === 'super_admin' || role === 'admin' || role === 'commercial';
}
