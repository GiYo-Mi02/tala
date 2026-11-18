import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Modal, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sync, syncAvailable, type SyncJob, type SyncOverview } from '../modules/tala-sync';
import { makeSyncSnapshot, type AcceptedDraft } from './syncSnapshot';
import { Action, Card, styles } from './ui';

const blank: SyncOverview = { connected: false, jobs: [] };
type SyncContextValue = {
  overview: SyncOverview;
  jobsById: ReadonlyMap<string, SyncJob>;
  readError: string;
  update: (value: SyncOverview) => void;
  read: () => Promise<void>;
};
const Context = createContext<SyncContextValue | null>(null);
const userError = (error: unknown) => error instanceof Error ? error.message : 'Synchronization could not finish. Your draft is saved.';

function useSync() {
  const value = useContext(Context);
  if (!value) throw new Error('Synchronization controls require the sync provider.');
  return value;
}

export function SyncProvider({ children, open }: React.PropsWithChildren<{ open: boolean }>) {
  const [overview, setOverview] = useState(blank);
  const [readError, setReadError] = useState('');
  const revision = useRef(0);
  const reading = useRef(false);
  const update = useCallback((value: SyncOverview) => {
    revision.current++;
    setOverview(value);
    setReadError('');
  }, []);
  const read = useCallback(async () => {
    if (!syncAvailable || reading.current) return;
    const starting = revision.current;
    reading.current = true;
    try {
      const saved = await sync.overview();
      if (revision.current === starting) {
        setOverview(saved);
        setReadError('');
      }
    } catch (error) {
      if (revision.current === starting) setReadError(userError(error));
    } finally { reading.current = false; }
  }, []);

  useEffect(() => {
    if (!syncAvailable) return;
    const resume = async () => {
      try { await sync.initialize(); } catch (error) { setReadError(userError(error)); }
      await read();
    };
    void resume();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void resume(); });
    return () => listener.remove();
  }, [read]);

  const activeQueue = overview.jobs.some(job => job.state === 'QUEUED' || job.state === 'SYNCING');
  useEffect(() => {
    if (!syncAvailable || (!open && !activeQueue)) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void read(); }, 2500);
    return () => clearInterval(timer);
  }, [open, activeQueue, read]);

  const jobsById = new Map(overview.jobs.map(job => [job.clientSubmissionId, job]));
  return <Context.Provider value={{ overview, jobsById, update, read, readError }}>{children}</Context.Provider>;
}

function localLabel(job: SyncJob | undefined, connected: boolean) {
  if (!job) return 'Saved offline';
  switch (job.state) {
    case 'SYNCED': return 'Successfully synced';
    case 'SYNC_FAILED': return 'Upload failed';
    case 'SYNC_BLOCKED': return 'Needs attention';
    case 'QUEUED': return connected ? (job.retries ? 'Waiting to retry' : 'Queued for upload') : 'Waiting for connection';
    case 'SYNCING': return connected ? 'Uploading' : 'Waiting for connection';
  }
}

const reviewLabels = {
  DRAFT: 'Awaiting upload', UPLOADING: 'Intake in progress', PENDING_VERIFICATION: 'Pending verification',
  IN_REVIEW: 'In review', NEEDS_CORRECTION: 'Returned for correction', VERIFIED: 'Verified',
  REJECTED: 'Rejected', FINALIZED: 'Finalized', EXPIRED: 'Intake expired',
};

export function DraftSyncStatus({ id, ready }: { id: string; ready: boolean }) {
  const { overview, jobsById } = useSync();
  const job = jobsById.get(id);
  return <Text style={styles.small}>{job ? localLabel(job, overview.connected) : ready ? 'Ready to submit' : 'Saved offline'}</Text>;
}

export function DraftSyncControls({ draft, disabled, onOpen }: { draft: AcceptedDraft; disabled: boolean; onOpen: () => void }) {
  const { overview, jobsById, update, read } = useSync();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const job = jobsById.get(draft.id);
  const account = overview.account;
  if (!syncAvailable || (draft.state !== 'ready' && !job)) return null;

  async function submit() {
    if (running.current || disabled) return;
    if (!account || account.signInRequired) { onOpen(); return; }
    running.current = true;
    setSaving(true);
    setError('');
    try { update(await sync.enqueue(JSON.stringify(makeSyncSnapshot(draft)), account)); }
    catch (failure) { setError(userError(failure)); await read(); }
    finally { setSaving(false); running.current = false; }
  }

  return <Card>
    <Text style={styles.heading}>Synchronization</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{localLabel(job, overview.connected)}</Text>
    {job ? <>
      <Text style={styles.small}>Queued copies keep the pages and fields you confirmed at submission.</Text>
      <Action title="View submission status" secondary disabled={disabled} onPress={onOpen} />
    </> : <Action title={saving ? 'Saving to queue…' : !account || account.signInRequired ? 'Open sync sign-in' : 'Submit for synchronization'}
      secondary disabled={disabled || saving} onPress={() => void submit()} />}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </Card>;
}

export function SyncPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { overview, update, read, readError } = useSync();
  const [endpoint, setEndpoint] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operating = useRef(false);
  const account = overview.account;
  const address = endpoint || account?.endpoint || process.env.EXPO_PUBLIC_TALA_API_URL || '';
  const identity = email || account?.email || '';
  const signIn = !account || account.signInRequired;

  async function run(operation: () => Promise<SyncOverview>) {
    if (operating.current) return;
    operating.current = true;
    setBusy(true);
    setError('');
    try { update(await operation()); }
    catch (failure) { setError(userError(failure)); await read(); }
    finally { setBusy(false); operating.current = false; }
  }

  function logIn() {
    if (operating.current || !password) return;
    const provided = password;
    setPassword('');
    void run(() => sync.login(address, identity, provided));
  }

  function close() {
    setPassword('');
    setError('');
    onClose();
  }

  return <Modal visible={visible} onRequestClose={close} animationType="slide">
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Action title="Back to scanner" secondary onPress={close} />
        <Text style={styles.title}>Submission history</Text>
        {!syncAvailable ? <Text style={styles.body}>This installed version does not include synchronization.</Text> : <>
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {overview.connected ? 'Connection available' : 'Offline · saved submissions can wait on this phone'}
          </Text>
          {error || readError ? <Text accessibilityRole="alert" style={styles.error}>{error || readError}</Text> : null}
          {signIn ? <Card>
            <Text style={styles.heading}>{account ? 'Sign in again' : 'Encoder sign-in'}</Text>
            <Text style={styles.small}>Use the HTTPS API address supplied by your administrator. Capture and review are available while signed out.</Text>
            <TextInput style={styles.input} accessibilityLabel="HTTPS API address" autoCapitalize="none" autoCorrect={false}
              keyboardType="url" value={endpoint} onChangeText={setEndpoint} placeholder={address || 'https://server.example/api/v1'} />
            <TextInput style={styles.input} accessibilityLabel="Encoder email" autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" value={email} onChangeText={setEmail} placeholder={identity || 'Encoder email'} />
            <TextInput style={styles.input} accessibilityLabel="Password" secureTextEntry
              value={password} onChangeText={setPassword} placeholder="Password" onSubmitEditing={logIn} />
            <Action title={busy ? 'Signing in…' : 'Sign in'} disabled={busy || !address || !identity || !password} onPress={logIn} />
          </Card> : <Card>
            <Text style={styles.heading}>Encoder account</Text>
            <Text style={styles.body}>{account.email}</Text>
            <Text style={styles.small}>{account.endpoint}</Text>
            <Action title="Sign out" secondary disabled={busy} onPress={() => void run(() => sync.logout())} />
          </Card>}
          {overview.jobs.length === 0 && account ? <Text style={styles.body}>Reviewed drafts submitted with this account will appear here.</Text> : null}
          {overview.jobs.map(job => <Card key={job.clientSubmissionId}>
            <Text style={styles.heading}>{job.templateId.startsWith('sss-') ? 'SSS E-1 Personal Record' : 'Basic Education Enrollment Form'}</Text>
            <Text style={styles.small}>{new Date(job.capturedAt).toLocaleString()} · {job.pageCount} {job.pageCount === 1 ? 'page' : 'pages'}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.heading}>{localLabel(job, overview.connected)}</Text>
            <Text style={styles.small}>Pages received {job.uploaded.length}/{job.pageCount}{job.fieldsUploaded ? ' · Fields received' : ''}</Text>
            {job.serverId ? <Text selectable style={styles.small}>Server reference {job.serverId}</Text> : null}
            {job.syncedAt ? <Text style={styles.small}>Synced {new Date(job.syncedAt).toLocaleString()}</Text> : null}
            {job.serverState ? <Text style={styles.body}>Server status · {reviewLabels[job.serverState]}</Text> : null}
            {job.decision?.notes ? <Text style={styles.body}>{job.decision.notes}</Text> : null}
            {job.issueText ? <Text style={styles.warning}>{job.issueText}</Text> : null}
            {job.state === 'SYNC_FAILED' ? <Action title="Retry upload" secondary disabled={busy || signIn}
              onPress={() => void run(() => sync.retry(job.clientSubmissionId))} /> : null}
            {job.state === 'SYNCED' ? <Action title="Refresh verification status" secondary disabled={busy || signIn || !overview.connected}
              onPress={() => void run(() => sync.refreshStatus(job.clientSubmissionId))} /> : null}
          </Card>)}
        </>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
