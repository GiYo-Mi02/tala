import { requireOptionalNativeModule } from 'expo-modules-core';

export type LocalSyncState = 'LOCAL_DRAFT' | 'QUEUED' | 'SYNCING' | 'SYNCED' | 'SYNC_FAILED' | 'SYNC_BLOCKED';
export type ServerState =
  'DRAFT' | 'UPLOADING' | 'PENDING_VERIFICATION' | 'IN_REVIEW' | 'NEEDS_CORRECTION' | 'VERIFIED' | 'REJECTED' | 'FINALIZED' | 'EXPIRED';
export type EncoderAccount = { id: string; email: string; endpoint: string; signInRequired: boolean };
export type SyncJob = {
  clientSubmissionId: string; templateId: string; capturedAt: string; pageCount: number;
  state: Exclude<LocalSyncState, 'LOCAL_DRAFT'>; uploaded: number[]; fieldsUploaded: boolean; retryAt: number;
  serverId?: string; serverState?: ServerState; revision: number; acknowledgedAt?: string; syncedAt?: number;
  lastAttempt?: number; retries: number; issueCode?: string; issueText?: string;
  decision?: { outcome: string; notes: string | null; at: string };
};
export type SyncOverview = { account?: EncoderAccount; connected: boolean; jobs: SyncJob[] };

type NativeSync = {
  initialize(): Promise<string>;
  overview(): Promise<string>;
  login(endpoint: string, email: string, password: string): Promise<string>;
  logout(): Promise<string>;
  enqueue(snapshot: string, owner: string, endpoint: string): Promise<string>;
  retry(id: string): Promise<string>;
  refreshStatus(id: string): Promise<string>;
};
const native = requireOptionalNativeModule<NativeSync>('TalaSync');

function service() {
  if (!native) throw new Error('Synchronization is unavailable in this installed version.');
  return native;
}

async function decode<T>(response: Promise<string>): Promise<T> {
  const body: { data: T } | { error: { code: string; message: string } } = JSON.parse(await response);
  if ('error' in body) throw new Error(body.error.message);
  return body.data;
}

export const syncAvailable = !!native;
export const sync = {
  initialize: () => decode<object>(service().initialize()),
  overview: () => decode<SyncOverview>(service().overview()),
  login: (endpoint: string, email: string, password: string) => decode<SyncOverview>(service().login(endpoint, email, password)),
  logout: () => decode<SyncOverview>(service().logout()),
  enqueue: (snapshot: string, account: EncoderAccount) =>
    decode<SyncOverview>(service().enqueue(snapshot, account.id, account.endpoint)),
  retry: (id: string) => decode<SyncOverview>(service().retry(id)),
  refreshStatus: (id: string) => decode<SyncOverview>(service().refreshStatus(id)),
};
