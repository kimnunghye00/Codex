import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupCoordinator } from '../src/lib/backupCoordinator.ts';
import { readLocalStateBackup, validLocalStateBackup } from '../src/lib/localStateBackup.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function setup() {
  let uid = 'alice';
  let local: Record<string, string> = { schedule: 'new' };
  const saves: Array<{ uid: string; value: Record<string, string> }> = [];
  const errors: unknown[] = [];
  const delays: number[] = [];
  let successes = 0;
  let writer: (uid: string) => Promise<void> = async () => {};
  let readError: Error | null = null;
  const coordinator = createBackupCoordinator({
    currentUid: () => uid,
    read: () => { if (readError) throw readError; return { ...local }; },
    save: async (target, value) => { saves.push({ uid: target, value }); await writer(target); },
    onSuccess: () => { successes++; },
    onError: (error) => { errors.push(error); },
    schedule: (delay) => { delays.push(delay); },
  });
  return { coordinator, saves, errors, delays, successes: () => successes,
    setUid: (value: string) => { uid = value; }, setLocal: (value: Record<string, string>) => { local = value; },
    setWriter: (value: typeof writer) => { writer = value; }, setReadError: (value: Error | null) => { readError = value; } };
}

test('backup starts from confirmed cloud state and saves existing local differences exactly once', async () => {
  const s = setup();
  s.coordinator.activate('alice', { schedule: 'old' });
  await s.coordinator.flush();
  await s.coordinator.flush();
  s.coordinator.markDirty();
  await s.coordinator.flush();
  assert.deepEqual(s.saves, [{ uid: 'alice', value: { schedule: 'new' } }]);
  assert.equal(s.coordinator.pending(), false);
  assert.equal(s.successes(), 1);
});

test('backup does not upload unchanged or empty confirmed state', async () => {
  const s = setup();
  s.setLocal({});
  s.coordinator.activate('alice', {});
  await s.coordinator.flush();
  assert.equal(s.saves.length, 0);
  assert.equal(s.coordinator.pending(), false);
});

test('changes during a save stay dirty and flush later without parallel writes for one account', async () => {
  const s = setup();
  const firstSave = deferred();
  s.setWriter(() => firstSave.promise);
  s.coordinator.activate('alice', {});
  const first = s.coordinator.flush();
  await Promise.resolve();
  s.setLocal({ schedule: 'changed during save' });
  s.coordinator.markDirty();
  assert.equal(s.coordinator.flush(), first);
  assert.equal(s.saves.length, 1);
  firstSave.resolve();
  await first;
  assert.equal(s.coordinator.pending(), true);
  assert.deepEqual(s.delays, [500]);
  s.setWriter(async () => {});
  await s.coordinator.flush();
  assert.equal(s.saves[1].value.schedule, 'changed during save');
  assert.equal(s.coordinator.pending(), false);
});

test('a stalled old account does not block new backups or modify new-account status when it settles', async () => {
  for (const fail of [false, true]) {
    const s = setup();
    const old = deferred();
    s.setWriter((uid) => uid === 'alice' ? old.promise : Promise.resolve());
    s.coordinator.activate('alice', {});
    const pending = s.coordinator.flush();
    await Promise.resolve();
    s.setUid('bob');
    s.coordinator.clear();
    s.coordinator.activate('bob', {});
    s.setLocal({ schedule: 'bob only' });
    await s.coordinator.flush();
    assert.equal(s.successes(), 1);
    if (fail) old.reject(new Error('old account denied')); else old.resolve();
    await pending;
    assert.equal(s.successes(), 1);
    assert.equal(s.errors.length, 0);
    assert.equal(s.coordinator.pending(), false);
    assert.deepEqual(s.saves.map((save) => save.uid), ['alice', 'bob']);
  }
});

test('signout before a queued backup starts prevents the write entirely', async () => {
  const s = setup();
  s.coordinator.activate('alice', {});
  const pending = s.coordinator.flush();
  s.setUid('');
  s.coordinator.clear();
  await pending;
  assert.equal(s.saves.length, 0);
  assert.equal(s.successes(), 0);
});

test('write failures keep pending changes and use bounded backoff, followed by successful recovery', async () => {
  const s = setup();
  s.setWriter(async () => { throw new Error('offline'); });
  s.coordinator.activate('alice', {});
  for (let i = 0; i < 9; i++) await s.coordinator.flush();
  assert.equal(s.coordinator.pending(), true);
  assert.deepEqual(s.delays, [2000, 4000, 8000, 16000, 32000, 64000, 120000, 120000, 120000]);
  s.setWriter(async () => {});
  await s.coordinator.flush();
  assert.equal(s.coordinator.pending(), false);
  assert.equal(s.successes(), 1);
});

test('storage read failures are handled and do not deadlock the next backup', async () => {
  const s = setup();
  s.coordinator.activate('alice', {});
  s.setReadError(new Error('storage blocked'));
  await s.coordinator.flush();
  assert.equal(s.errors.length, 1);
  assert.equal(s.saves.length, 0);
  assert.equal(s.coordinator.pending(), true);
  s.setReadError(null);
  await s.coordinator.flush();
  assert.equal(s.saves.length, 1);
});

test('restoration only accepts supported string values for the exact account', () => {
  const source = {
    'route-scheduled-chat:alice': '[]',
    'route-scheduled-chat:bob': 'private',
    'route-local-schedules:alice': 42,
    'route.localData.ownerUid': 'bob',
    'route.memories.deleted.v1': '{}',
    'arbitrary-setting': 'bad',
  };
  const expected = { 'route-scheduled-chat:alice': '[]', 'route.memories.deleted.v1': '{}' };
  assert.deepEqual(validLocalStateBackup('alice', source), expected);
  assert.deepEqual(validLocalStateBackup('alice', Object.create(source)), {});
  for (const broken of [null, [], 'text', 42]) assert.deepEqual(validLocalStateBackup('alice', broken), {});
  assert.deepEqual(readLocalStateBackup('alice', { getItem: (key) => expected[key as keyof typeof expected] ?? null }), expected);
});
