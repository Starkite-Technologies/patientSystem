import {canEditVisits, type BoardData} from '../model';

// UI affordances mirror separate server capabilities; they never grant access.
export function visitPermissions(data: BoardData, hospitalScoped: boolean) {
  return hospitalScoped
    ? {register: Boolean(data.capabilities?.includes('encounter.register')), update: Boolean(data.capabilities?.includes('encounter.update_legacy'))}
    : {register: canEditVisits(data.role), update: canEditVisits(data.role)};
}
