import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, PhoneAuthCredential, signInWithCredential } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, doc, setDoc, getDoc, getDocFromServer, updateDoc, deleteDoc, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, ref, uploadBytes, getBytes, deleteObject, type FirebaseStorage } from 'firebase/storage';

// Use the actual application services against emulators. Only the singleton
// selection changes, so each invocation represents a different real client.
const client = vi.hoisted(() => ({ db: null as unknown as Firestore, storage: null as unknown as FirebaseStorage }));
vi.mock('../src/lib/firebase', () => ({ get db() { return client.db; } }));
vi.mock('../src/lib/firebaseStorage', () => ({ get storage() { return client.storage; } }));
import { syncUserProfile } from '../src/lib/coupleData';
import { createCoupleInvite, connectWithInviteCode, finalizeInviteAsOwner, completeJoinerConnection, getRealCoupleConnection, subscribeRealCoupleConnection } from '../src/lib/coupleConnection';
import { disconnectCouple } from '../src/lib/coupleDisconnect';
import { sendCoupleMessage, toggleCoupleMessageReaction, setCoupleMessageReactions, hideCoupleMessageForMe, deleteCoupleMessageForEveryone, clearCoupleChatForMe } from '../src/lib/chatRealtime';
import { uploadChatAttachment, uploadChatMedia } from '../src/lib/chatMedia';
import { addDatePlace, saveDateCourse, setPlaceLike, addPlaceOpinion } from '../src/lib/dateMap';
import { addDatePlanCandidate, createDatePlanDraft, readDatePlanCandidates, subscribeDatePlanCandidates, updateDatePlanCandidateMemo, updateDatePlanDraft } from '../src/lib/datePlanDrafts';
import { readDatePlanSchedule, saveDatePlanSchedule, subscribeDatePlanSchedule } from '../src/lib/datePlanSchedule';
import { publishCoupleActivity, subscribeCoupleActivities } from '../src/lib/coupleActivity';
import { approveDatePlan, proposeDatePlanChange, requestDatePlanApproval, subscribeDatePlanApproval, withdrawDatePlanReview } from '../src/lib/datePlanApproval';
import { addDatePlanCandidateComment, deleteDatePlanCandidateComment, removeDatePlanCandidateWithFeedback,
  setDatePlanCandidatePreference, subscribeDatePlanCandidateComments } from '../src/lib/datePlanOpinions';

const projectId = 'demo-danduli-security';
let env: RulesTestEnvironment;
const apps: FirebaseApp[] = [];
const localValues = new Map<string, string>();
const storageShim = { getItem: (k: string) => localValues.get(k) ?? null, setItem: (k: string, v: string) => { localValues.set(k, v); }, removeItem: (k: string) => { localValues.delete(k); } };
vi.stubGlobal('localStorage', storageShim);
vi.stubGlobal('window', { setTimeout, clearTimeout, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });

beforeAll(async () => {
  // Refuse to run against a production project even if CLI options are changed.
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Emulators required');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(process.env.DANDULI_BASELINE_RULES || 'firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); localValues.clear(); });
afterAll(async () => { await Promise.all(apps.map(deleteApp)); await env?.cleanup(); });

function as(uid: string) {
  const context = env.authenticatedContext(uid);
  client.db = context.firestore({ ignoreUndefinedProperties: true }) as unknown as Firestore;
  client.storage = context.storage() as unknown as FirebaseStorage;
  return { db: client.db, storage: client.storage };
}
const profile = (name: string) => ({ name, birthDate: '2000-01-01', gender: 'other' as const, completedAt: new Date().toISOString() });
async function signup(uid: string) { as(uid); await syncUserProfile(uid, profile(uid)); }
async function pair(owner = 'alice', joiner = 'bob') {
  await signup(owner); await signup(joiner);
  as(owner); const invite = await createCoupleInvite(owner, owner);
  as(joiner); await connectWithInviteCode(joiner, joiner, invite.code);
  as(owner); const result = await finalizeInviteAsOwner(owner, owner, invite.code);
  expect(result?.coupleId).toBeTruthy();
  as(joiner); expect((await completeJoinerConnection(joiner, invite.code))?.coupleId).toBe(result!.coupleId);
  return { coupleId: result!.coupleId, code: invite.code };
}
function message(id: number) { return { id, sender: 'me' as const, type: 'text' as const, text: '우리의 대화', timestamp: new Date().toISOString(), read: false }; }
async function seed(path: string, data: object) { await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore() as unknown as Firestore, path), data); }); }

async function phoneSignup(phone: string) {
  const app = initializeApp({ apiKey: 'demo-key', projectId, storageBucket: `${projectId}.appspot.com` }, phone);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber: phone, recaptchaToken: 'emulator-only' }),
  });
  expect(response.ok).toBe(true);
  const { sessionInfo } = await response.json();
  const codes = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/verificationCodes`)).json();
  const code = codes.verificationCodes.find((entry: { sessionInfo: string }) => entry.sessionInfo === sessionInfo).code;
  const result = await signInWithCredential(auth, PhoneAuthCredential.fromJSON({ verificationId: sessionInfo, verificationCode: code })!);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true }); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const storage = getStorage(app); connectStorageEmulator(storage, '127.0.0.1', 9199);
  return { uid: result.user.uid, db, storage };
}

test('phone signup → profiles → mutual invitation → bidirectional chat → photo → disconnect', async () => {
  const alice = await phoneSignup('+821011110001');
  const bob = await phoneSignup('+821011110002');
  Object.assign(client, alice); await syncUserProfile(alice.uid, profile('앨리스'));
  Object.assign(client, bob); await syncUserProfile(bob.uid, profile('밥'));
  Object.assign(client, alice); const invite = await createCoupleInvite(alice.uid, '앨리스');
  Object.assign(client, bob); await connectWithInviteCode(bob.uid, '밥', invite.code);
  Object.assign(client, alice); const connection = await finalizeInviteAsOwner(alice.uid, '앨리스', invite.code);
  const id = connection!.coupleId;
  Object.assign(client, bob); expect((await completeJoinerConnection(bob.uid, invite.code))?.partnerUid).toBe(alice.uid);
  Object.assign(client, alice); expect((await getRealCoupleConnection(alice.uid))?.partnerProfile?.name).toBe('밥');
  await sendCoupleMessage(id, alice.uid, message(1));
  expect((await getDocFromServer(doc(bob.db, 'couples', id, 'messages', '1'))).data()?.text).toBe('우리의 대화');
  Object.assign(client, bob); await sendCoupleMessage(id, bob.uid, message(2));
  expect((await getDocFromServer(doc(alice.db, 'couples', id, 'messages', '2'))).data()?.authorUid).toBe(bob.uid);
  // Tiny valid PNG, sent through the production attachment uploader and message service.
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  Object.assign(client, alice);
  const photo = await uploadChatAttachment(id, alice.uid, 3, new File([png], 'photo.png', { type: 'image/png' }), 'file');
  await sendCoupleMessage(id, alice.uid, { ...message(3), type: 'image', imageUrl: photo.url });
  expect(new Uint8Array(await getBytes(ref(bob.storage, photo.path)))).toEqual(png);
  expect((await getDocFromServer(doc(bob.db, 'couples', id, 'messages', '3'))).data()?.imageUrl).toBe(photo.url);
  const gifBytes = new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  const gif = await uploadChatMedia(id, alice.uid, 4, [new File([gifBytes], 'image.gif', { type: 'image/gif' })]);
  await sendCoupleMessage(id, alice.uid, { ...message(4), type: 'gif', imageUrl: gif.urls[0] });
  expect(new Uint8Array(await getBytes(ref(bob.storage, gif.paths[0])))).toEqual(gifBytes);
  // Keep the other device subscribed while membership is revoked.
  Object.assign(client, bob);
  const observed: Array<string | null> = [];
  const stop = subscribeRealCoupleConnection(bob.uid, value => observed.push(value?.coupleId ?? null));
  await vi.waitFor(() => expect(observed).toContain(id));
  Object.assign(client, alice); await disconnectCouple(alice.uid, id, bob.uid);
  await vi.waitFor(() => expect(observed.at(-1)).toBeNull()); stop();
  for (const user of [alice, bob]) {
    await assertFails(getDocFromServer(doc(user.db, 'couples', id, 'messages', '1')));
    await assertFails(getBytes(ref(user.storage, photo.path)));
    Object.assign(client, user); expect(await getRealCoupleConnection(user.uid)).toBeNull();
  }
  // A stale partner pointer must not trap the other person in the old couple.
  Object.assign(client, bob); expect((await createCoupleInvite(bob.uid, '밥')).code).toMatch(/^ROUTE-/);
});

test('unrelated and signed-out clients cannot read or write private couple data', async () => {
  const { coupleId } = await pair();
  as('alice'); await sendCoupleMessage(coupleId, 'alice', message(1));
  await signup('eve');
  const outsider = as('eve');
  for (const db of [outsider.db, env.unauthenticatedContext().firestore() as unknown as Firestore]) {
    await assertFails(getDocFromServer(doc(db, 'couples', coupleId)));
    await assertFails(getDocFromServer(doc(db, 'couples', coupleId, 'messages', '1')));
    await assertFails(getDocFromServer(doc(db, 'users', 'alice')));
    await assertFails(setDoc(doc(db, 'couples', coupleId, 'messages', '9'), { authorUid: 'eve', createdAt: serverTimestamp() }));
  }
  await assertFails(updateDoc(doc(outsider.db, 'users', 'eve'), { coupleId, partnerUid: 'alice' }));
});

test('forged couple creation and expired invitation request/finalization are denied', async () => {
  await signup('alice'); await signup('bob');
  as('alice');
  await assertFails(setDoc(doc(client.db, 'couples', 'forged'), { id: 'forged', memberUids: ['alice', 'bob'], createdBy: 'alice', testMode: false }));
  await seed('coupleInvites/ROUTE-AAAAAA', { code: 'ROUTE-AAAAAA', status: 'open', ownerUid: 'alice', ownerName: 'alice', expiresAt: Date.now() - 1000 });
  as('bob');
  await assertFails(updateDoc(doc(client.db, 'coupleInvites', 'ROUTE-AAAAAA'), { status: 'requested', joinerUid: 'bob', joinerName: 'bob' }));
  await seed('coupleInvites/ROUTE-BBBBBB', { code: 'ROUTE-BBBBBB', status: 'requested', ownerUid: 'alice', ownerName: 'alice', joinerUid: 'bob', joinerName: 'bob', expiresAt: Date.now() - 1000 });
  as('alice');
  await expect(finalizeInviteAsOwner('alice', 'alice', 'ROUTE-BBBBBB')).rejects.toThrow('invite-expired');
  await assertFails(updateDoc(doc(client.db, 'coupleInvites', 'ROUTE-BBBBBB'), { status: 'accepted', coupleId: 'forged' }));
});

test('messages enforce author identity, immutable body/time, and server-time deletion window', async () => {
  const { coupleId } = await pair();
  as('alice'); await sendCoupleMessage(coupleId, 'alice', message(1));
  const alice = client.db;
  as('bob'); const target = doc(client.db, 'couples', coupleId, 'messages', '1');
  await assertFails(updateDoc(target, { text: '변조' }));
  await assertFails(updateDoc(target, { authorUid: 'bob' }));
  await assertFails(deleteDoc(target));
  await assertFails(setDoc(doc(client.db, 'couples', coupleId, 'messages', '9'), { ...message(9), authorUid: 'alice', createdAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(target, { read: true }));
  await assertFails(updateDoc(doc(alice, target.path), { createdAt: serverTimestamp() }));
  await seed(`couples/${coupleId}/messages/2`, { ...message(2), authorUid: 'alice', createdAt: Timestamp.fromMillis(Date.now() - 601000) });
  as('alice');
  await assertFails(deleteDoc(doc(client.db, 'couples', coupleId, 'messages', '2')));
  await expect(deleteCoupleMessageForEveryone(coupleId, 2, 'alice')).rejects.toThrow('delete-window-expired');
  await assertSucceeds(hideCoupleMessageForMe(coupleId, 2, 'alice'));
  await assertSucceeds(deleteCoupleMessageForEveryone(coupleId, 1, 'alice'));
});

test('reactions and hide-for-me preserve the partner state, clear-all is private', async () => {
  const { coupleId } = await pair();
  as('alice'); await sendCoupleMessage(coupleId, 'alice', message(1));
  await toggleCoupleMessageReaction(coupleId, 1, 'alice', '❤️');
  as('bob'); await toggleCoupleMessageReaction(coupleId, 1, 'bob', '👍');
  await setCoupleMessageReactions(coupleId, 1, 'bob', [{ emoji: '😊', by: 'me' }]);
  const path = `couples/${coupleId}/messages/1`;
  expect((await getDoc(doc(client.db, path))).data()?.reactions).toContainEqual({ emoji: '❤️', uid: 'alice' });
  await assertFails(updateDoc(doc(client.db, path), { reactions: [{ emoji: '❌', uid: 'alice' }] }));
  await hideCoupleMessageForMe(coupleId, 1, 'bob');
  await assertFails(updateDoc(doc(client.db, path), { hiddenFor: ['alice'] }));
  await clearCoupleChatForMe(coupleId, 'bob');
  as('alice'); expect((await getDoc(doc(client.db, 'users', 'alice'))).data()?.chatClearBefore).toBeUndefined();
  expect((await getDocFromServer(doc(client.db, path))).exists()).toBe(true);
});

test('disconnect allows only revocation, not member replacement, resurrection or third-party access', async () => {
  const { coupleId } = await pair();
  await signup('eve');
  as('alice'); const couple = doc(client.db, 'couples', coupleId);
  await assertFails(updateDoc(couple, { memberUids: ['alice', 'eve'] }));
  await assertFails(updateDoc(couple, { memberUids: [], status: 'disconnected', disconnectedBy: 'alice', disconnectedAt: serverTimestamp() }));
  await disconnectCouple('alice', coupleId, 'bob');
  await assertFails(updateDoc(couple, { memberUids: ['alice', 'bob'] }));
  await assertFails(updateDoc(doc(client.db, 'users', 'alice'), { coupleId, partnerUid: 'bob' }));
  as('bob'); expect(await getRealCoupleConnection('bob')).toBeNull();
  const next = await pair('bob', 'eve');
  expect(next.coupleId).not.toBe(coupleId);
  as('eve'); await assertFails(getDocFromServer(doc(client.db, 'couples', coupleId)));
});

test('storage prevents cross-couple reads, forged ownership, replacement and unsupported uploads', async () => {
  const { coupleId } = await pair();
  as('alice'); const path = `couples/${coupleId}/chatMedia/alice/1/photo.png`;
  const bytes = new Uint8Array([1, 2, 3]);
  await uploadBytes(ref(client.storage, path), bytes, { contentType: 'image/png' });
  as('bob'); await assertSucceeds(getBytes(ref(client.storage, path)));
  await assertFails(uploadBytes(ref(client.storage, path), bytes, { contentType: 'image/png' }));
  await assertFails(deleteObject(ref(client.storage, path)));
  await assertFails(uploadBytes(ref(client.storage, `couples/${coupleId}/chatMedia/bob/2/bad.bin`), bytes, { contentType: 'invalid/type' }));
  as('eve'); await assertFails(getBytes(ref(client.storage, path)));
  await assertFails(uploadBytes(ref(client.storage, `couples/${coupleId}/chatMedia/eve/3/photo.png`), bytes, { contentType: 'image/png' }));
});

test('backup replacement removes deleted keys without erasing unrelated document metadata', async () => {
  const { saveBackupValue } = await import('../src/lib/persistentBackup');
  await signup('alice');
  const backup = doc(client.db, 'users', 'alice', 'backups', 'local-state-latest');
  await setDoc(backup, { sourceDeviceId: 'existing-device', value: { 'route-date-plans:alice': '[1]', 'route-local-schedules:alice': '[2]' } });
  await saveBackupValue('alice', 'local-state-latest', { 'route-local-schedules:alice': '[]' });
  const saved = (await getDocFromServer(backup)).data();
  expect(saved?.value).toEqual({ 'route-local-schedules:alice': '[]' });
  expect(saved?.sourceDeviceId).toBe('existing-device');
  await saveBackupValue('alice', 'local-state-latest', {});
  expect((await getDocFromServer(backup)).data()?.value).toEqual({});
  as('bob');
  await assertFails(saveBackupValue('alice', 'local-state-latest', { forged: 'true' }));
});

test('cancelled call transactions cannot publish stale offers/answers or end a replacement call', async () => {
  const { startCoupleCall, answerCoupleCall, finishCoupleCall } = await import('../src/lib/coupleCall');
  const { coupleId } = await pair();
  as('alice');
  await expect(startCoupleCall(coupleId, 'cancelled', 'alice', 'bob', 'voice', { type: 'offer', sdp: 'offer' }, () => false)).rejects.toThrow('call-cancelled');
  expect((await getDoc(doc(client.db, 'couples', coupleId))).data()?.activeCall).toBeUndefined();
  await startCoupleCall(coupleId, 'first', 'alice', 'bob', 'voice', { type: 'offer', sdp: 'offer' });
  as('bob');
  await expect(answerCoupleCall(coupleId, 'first', 'bob', { type: 'answer', sdp: 'answer' }, () => false)).rejects.toThrow('call-cancelled');
  expect((await getDoc(doc(client.db, 'couples', coupleId))).data()?.activeCall.status).toBe('ringing');
  await finishCoupleCall(coupleId, 'first', 'ended', 'hangup');
  as('alice');
  await startCoupleCall(coupleId, 'replacement', 'alice', 'bob', 'voice', { type: 'offer', sdp: 'new-offer' });
  await finishCoupleCall(coupleId, 'first', 'failed', 'late-completion');
  const active = (await getDoc(doc(client.db, 'couples', coupleId))).data()?.activeCall;
  expect(active.callId).toBe('replacement');
  expect(active.status).toBe('ringing');
});

test('callee can write a legitimate call record without permitting forged text attribution', async () => {
  const { startCoupleCall, answerCoupleCall, finishCoupleCall } = await import('../src/lib/coupleCall');
  const { coupleId } = await pair();
  as('alice'); await startCoupleCall(coupleId, 'call-test', 'alice', 'bob', 'voice', { type: 'offer', sdp: 'test-offer' });
  as('bob'); await answerCoupleCall(coupleId, 'call-test', 'bob', { type: 'answer', sdp: 'test-answer' });
  await finishCoupleCall(coupleId, 'call-test', 'ended', 'hangup');
  const call = (await getDoc(doc(client.db, 'couples', coupleId))).data()?.activeCall;
  const log = (await getDoc(doc(client.db, 'couples', coupleId, 'messages', String(call.callLogMessageId)))).data();
  expect(log?.type).toBe('call'); expect(log?.authorUid).toBe('alice');
  await assertFails(setDoc(doc(client.db, 'couples', coupleId, 'messages', 'fake-call'), {
    ...message(10), type: 'call', authorUid: 'alice', callId: 'another-call', createdAt: serverTimestamp(),
  }));
});

test('legacy forged membership cannot expose a nonconsenting user profile', async () => {
  await signup('victim'); await signup('eve');
  await seed('couples/legacy-forged', { memberUids: ['eve', 'victim'], createdBy: 'eve', testMode: false });
  await seed('users/eve', { coupleId: 'legacy-forged', partnerUid: 'victim' });
  as('eve'); await assertFails(getDocFromServer(doc(client.db, 'users', 'victim')));
});

test('disconnect clears disposable chat and memory views without writing deletion tombstones', async () => {
  const { transitionCoupleCache } = await import('../src/utils/coupleCacheIsolation');
  transitionCoupleCache('scope-test', 'old-couple');
  localStorage.setItem('route.messages.v2', '[{"id":1}]');
  localStorage.setItem('route.memories.v2', '[{"id":2}]');
  expect(transitionCoupleCache('scope-test', null)).toBe(true);
  expect(localStorage.getItem('route.messages.v2')).toBeNull();
  expect(localStorage.getItem('route.memories.v2')).toBeNull();
  expect(localStorage.getItem('route.memories.deleted.v1')).toBeNull();
  transitionCoupleCache('scope-test', 'new-couple');
  expect(localStorage.getItem('route.memories.v2')).toBeNull();
});

test('simultaneous pending invitations cannot create a second active couple', async () => {
  await signup('alice'); await signup('bob'); await signup('eve');
  as('alice'); const first = await createCoupleInvite('alice', 'alice');
  as('eve'); const second = await createCoupleInvite('eve', 'eve');
  as('bob'); await connectWithInviteCode('bob', 'bob', first.code);
  await connectWithInviteCode('bob', 'bob', second.code);
  as('alice'); await assertFails(finalizeInviteAsOwner('alice', 'alice', first.code));
  as('eve'); await finalizeInviteAsOwner('eve', 'eve', second.code);
  as('bob'); await completeJoinerConnection('bob', second.code);
});


test('an accepted invitation reserves the joiner before their device completes the handshake', async () => {
  await signup('alice'); await signup('bob'); await signup('eve');
  as('alice'); const first = await createCoupleInvite('alice', 'alice');
  as('eve'); const second = await createCoupleInvite('eve', 'eve');
  as('bob'); await connectWithInviteCode('bob', 'bob', first.code);
  as('alice'); await finalizeInviteAsOwner('alice', 'alice', first.code);
  await assertFails(deleteDoc(doc(client.db, 'coupleInvites', first.code)));
  as('bob');
  await assertFails(connectWithInviteCode('bob', 'bob', second.code));
  await assertFails(updateDoc(doc(client.db, 'users', 'bob'), { pendingInviteCode: second.code }));
  await completeJoinerConnection('bob', first.code);
});

test('date planning: members share places and courses but outsiders and identity spoofing are blocked', async () => {
  const { coupleId } = await pair();
  as('alice');
  const placeId = await addDatePlace(coupleId, 'alice', {
    name: '안목해변', address: '강릉시', latitude: 37.77, longitude: 128.94, category: '여행', memo: '함께 걷기',
  });
  const placePath = `couples/${coupleId}/datePlaces/${placeId}`;
  as('bob');
  expect((await getDocFromServer(doc(client.db, placePath))).data()?.name).toBe('안목해변');
  await assertSucceeds(updateDoc(doc(client.db, placePath), { memo: '저녁에 걷기', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(client.db, placePath), { createdBy: 'bob', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(client.db, placePath), { latitude: 0, longitude: 0, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(client.db, 'couples', coupleId, 'datePlaces', 'spoof'), {
    id: 'spoof', name: '위조', address: '', latitude: 37, longitude: 128, category: '기타',
    memo: '', createdBy: 'alice', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await setPlaceLike(coupleId, placeId, 'bob', true);
  await assertFails(setDoc(doc(client.db, placePath, 'likes', 'alice'), { uid: 'alice', liked: true }));
  await addPlaceOpinion(coupleId, placeId, 'bob', '좋아!');
  await assertFails(setDoc(doc(client.db, placePath, 'opinions', 'fake'), {
    id: 'fake', authorUid: 'alice', text: '상대방 사칭', createdAt: serverTimestamp(),
  }));
  const savedId = await saveDateCourse(coupleId, 'bob', {
    title: '강릉 데이트', date: '2026-09-20', placeIds: [placeId], timeSlots: ['10:00-11:00'],
  });
  const undatedId = await saveDateCourse(coupleId, 'bob', { title: '언젠가 갈 코스', date: '', placeIds: [placeId] });
  expect((await getDocFromServer(doc(client.db, 'couples', coupleId, 'dateCourses', undatedId))).data()?.date).toBe('');
  const savedCourse = doc(client.db, 'couples', coupleId, 'dateCourses', savedId);
  await assertFails(updateDoc(savedCourse, { date: '잘못된 날짜', updatedAt: serverTimestamp() }));
  expect((await getDocFromServer(savedCourse)).data()?.timeSlots).toEqual(['10:00-11:00']);
  await assertSucceeds(updateDoc(savedCourse, { timeSlots: ['11:00-12:00'], updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(savedCourse, { timeSlots: ['11:00-12:00', '14:00-15:00'], updatedAt: serverTimestamp() }));
  as('alice');
  const courseRef = doc(client.db, 'couples', coupleId, 'dateCourses', 'forged');
  await assertFails(setDoc(courseRef, {
    id: 'forged', title: '허위', date: '2026-09-20', placeIds: [placeId], createdBy: 'bob', updatedAt: serverTimestamp(),
  }));
  await signup('eve');
  const outsider = as('eve');
  for (const path of [placePath, `${placePath}/likes/bob`, `${placePath}/opinions/fake`]) {
    await assertFails(getDocFromServer(doc(outsider.db, path)));
  }
  await assertFails(setDoc(doc(outsider.db, placePath, 'likes', 'eve'), { uid: 'eve', liked: true }));
});

test('date plan V2: unfinished drafts and date-only candidates stay isolated and couple-private', async () => {
  const { coupleId } = await pair();
  as('alice');
  const oldPlace = await addDatePlace(coupleId, 'alice', {
    name: '기존 보관함', address: '강릉시', latitude: 37.77, longitude: 128.94, category: '여행', memo: '',
  });
  const oldCourse = await saveDateCourse(coupleId, 'alice', {
    title: '기존 코스', date: '2026-10-20', placeIds: [oldPlace], timeSlots: ['08:00-09:00'],
  });
  const planId = await createDatePlanDraft(coupleId, 'alice');
  const planPath = `couples/${coupleId}/datePlans/${planId}`;
  const candidateId = await addDatePlanCandidate(coupleId, planId, 'alice', {
    name: '니뽕내뽕', address: '강릉시', latitude: 37.75, longitude: 128.88,
    category: '맛집', memo: '점심 후보',
  });
  const candidatePath = `${planPath}/candidates/${candidateId}`;
  // Query reads and the actual listener are required by the UI; a direct getDoc alone
  // can pass even when the list stays empty or the collection listener is denied.
  expect((await readDatePlanCandidates(coupleId, planId)).map((item) => item.id)).toEqual([candidateId]);
  const observed = await new Promise<string[]>((resolve, reject) => {
    let unsubscribe: () => void = () => {};
    unsubscribe = subscribeDatePlanCandidates(coupleId, planId, (items) => {
      resolve(items.map((item) => item.id));
      queueMicrotask(() => unsubscribe());
    }, reject);
  });
  expect(observed).toEqual([candidateId]);
  const plan = (await getDocFromServer(doc(client.db, planPath))).data();
  expect(plan?.status).toBe('draft');
  expect(plan?.schemaVersion).toBe(2);
  expect(plan?.title).toBe('');
  expect(plan?.date).toBe('');
  expect((await getDocFromServer(doc(client.db, 'couples', coupleId, 'datePlaces', candidateId))).exists()).toBe(false);
  expect((await getDocFromServer(doc(client.db, 'couples', coupleId, 'dateCourses', oldCourse))).data()?.placeIds).toEqual([oldPlace]);

  as('bob');
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.name).toBe('니뽕내뽕');
  expect((await readDatePlanCandidates(coupleId, planId)).map((item) => item.id)).toEqual([candidateId]);
  const again = await addDatePlanCandidate(coupleId, planId, 'bob', {
    name: '니뽕내뽕', address: '강릉시', latitude: 37.75, longitude: 128.88,
    category: '맛집', memo: '다른 사람의 중복 제출',
  });
  expect(again).toBe(candidateId);
  expect((await readDatePlanCandidates(coupleId, planId)).length).toBe(1);
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.memo).toBe('점심 후보');
  await updateDatePlanDraft(coupleId, planId, { title: '함께 만드는 초안', date: '2026-11-21' });
  await updateDatePlanCandidateMemo(coupleId, planId, candidateId, '예비 식당으로');
  expect((await getDocFromServer(doc(client.db, planPath))).data()?.title).toBe('함께 만드는 초안');
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.memo).toBe('예비 식당으로');

  await assertFails(updateDoc(doc(client.db, planPath), { status: 'confirmed', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(client.db, planPath), { createdBy: 'bob', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(client.db, candidatePath), { latitude: 0, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(client.db, planPath)));
  await assertFails(setDoc(doc(client.db, 'couples', coupleId, 'datePlans', 'spoof'), {
    id: 'spoof', title: '', date: '', status: 'draft', schemaVersion: 2, createdBy: 'alice',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(client.db, planPath, 'candidates', 'fake'), {
    id: 'fake', name: '', address: '', latitude: 0, longitude: 0, category: '기타', memo: '',
    createdBy: 'bob', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(client.db, 'couples', coupleId, 'datePlans', 'not-created', 'candidates', 'orphan'), {
    id: 'orphan', name: '잘못된 후보', address: '', latitude: 0, longitude: 0, category: '기타', memo: '',
    createdBy: 'bob', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await signup('eve');
  const outsider = as('eve');
  await assertFails(getDocFromServer(doc(outsider.db, planPath)));
  await assertFails(getDocFromServer(doc(outsider.db, candidatePath)));
  await assertFails(updateDoc(doc(outsider.db, candidatePath), { memo: '변조', updatedAt: serverTimestamp() }));
  expect((await getDocFromServer(doc(as('alice').db, 'couples', coupleId, 'dateCourses', oldCourse))).data()?.timeSlots)
    .toEqual(['08:00-09:00']);
});


test('date plan V2: partner choices, comments and atomic candidate deletion stay couple-private', async () => {
  const { coupleId } = await pair();
  const planId = await createDatePlanDraft(coupleId, 'bob');
  const candidateId = await addDatePlanCandidate(coupleId, planId, 'bob', {
    name: 'CGV 강변', address: '서울 광진구', latitude: 37.535, longitude: 127.095,
    category: '놀거리', memo: '후보 그대로',
  });
  const candidatePath = 'couples/' + coupleId + '/datePlans/' + planId + '/candidates/' + candidateId;
  as('alice');
  await setDatePlanCandidatePreference(coupleId, planId, candidateId, 'alice', 'want');
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.votes).toEqual({ alice: 'want' });
  as('bob');
  await setDatePlanCandidatePreference(coupleId, planId, candidateId, 'bob', 'considering');
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.votes)
    .toEqual({ alice: 'want', bob: 'considering' });
  await setDatePlanCandidatePreference(coupleId, planId, candidateId, 'bob', 'pass');
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.votes)
    .toEqual({ alice: 'want', bob: 'pass' });
  await assertFails(updateDoc(doc(client.db, candidatePath), { 'votes.alice': 'pass', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(client.db, candidatePath), { 'votes.bob': 'invalid', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(client.db, candidatePath), { 'votes.alice': 'pass', 'votes.bob': 'want', updatedAt: serverTimestamp() }));
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.memo).toBe('후보 그대로');

  const bobComment = await addDatePlanCandidateComment(coupleId, planId, candidateId, 'bob', '여긴 자리 예매하자');
  const bobCommentPath = candidatePath + '/comments/' + bobComment;
  as('alice');
  const aliceComment = await addDatePlanCandidateComment(coupleId, planId, candidateId, 'alice', '좋아! 🎬');
  const aliceCommentPath = candidatePath + '/comments/' + aliceComment;
  const observed = await new Promise<string[]>((resolve, reject) => {
    let unsubscribe: () => void = () => {};
    unsubscribe = subscribeDatePlanCandidateComments(coupleId, planId, candidateId, (items) => {
      if (items.length !== 2) return;
      resolve(items.map((item) => item.text));
      queueMicrotask(() => unsubscribe());
    }, reject);
  });
  expect(observed).toContain('여긴 자리 예매하자');
  expect(observed).toContain('좋아! 🎬');
  await assertFails(deleteDatePlanCandidateComment(coupleId, planId, candidateId, bobComment));
  await assertFails(updateDoc(doc(client.db, bobCommentPath), { text: '남의 댓글 변경' }));
  await assertFails(setDoc(doc(client.db, candidatePath, 'comments', 'spoof'), {
    id: 'spoof', authorUid: 'bob', text: '가짜', createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(client.db, candidatePath, 'comments', 'too-long'), {
    id: 'too-long', authorUid: 'alice', text: '가'.repeat(501), createdAt: serverTimestamp(),
  }));

  await setDatePlanCandidatePreference(coupleId, planId, candidateId, 'alice', null);
  expect((await getDocFromServer(doc(client.db, candidatePath))).data()?.votes).toEqual({ bob: 'pass' });
  await deleteDatePlanCandidateComment(coupleId, planId, candidateId, aliceComment);
  expect((await getDocFromServer(doc(client.db, aliceCommentPath))).exists()).toBe(false);
  await signup('eve');
  const outsider = as('eve');
  await assertFails(getDocFromServer(doc(outsider.db, bobCommentPath)));
  await assertFails(setDatePlanCandidatePreference(coupleId, planId, candidateId, 'eve', 'want'));
  await assertFails(addDatePlanCandidateComment(coupleId, planId, candidateId, 'eve', '남의 후보'));

  as('alice');
  await removeDatePlanCandidateWithFeedback(coupleId, planId, candidateId);
  expect((await getDocFromServer(doc(client.db, candidatePath))).exists()).toBe(false);
  await assertFails(getDocFromServer(doc(client.db, bobCommentPath)));
  expect((await getDocFromServer(doc(client.db, 'couples/' + coupleId + '/datePlans/' + planId))).exists()).toBe(true);
});


test('date plan V2: both members share unfinished timetable without lost edits or outsider access', async () => {
  const { coupleId } = await pair();
  as('alice');
  const oldPlace = await addDatePlace(coupleId, 'alice', {
    name: '예전 저장 장소', address: '강릉', latitude: 37.75, longitude: 128.89, category: '기타', memo: '',
  });
  const planId = await createDatePlanDraft(coupleId, 'alice');
  const candidateId = await addDatePlanCandidate(coupleId, planId, 'alice', {
    name: 'CGV 강변', address: '서울 광진구', latitude: 37.535, longitude: 127.095,
    category: '놀거리', memo: '함께 가고 싶어',
  });
  const path = 'couples/' + coupleId + '/datePlans/' + planId + '/schedule/draft';
  const block = {
    id:'first', position:0, kind:'activity' as const, title:'영화 보기', primaryCandidateId:candidateId,
    backupCandidateIds:[], activityMinutes:120, travelMinutes:20, fixedStart:null,
  };
  expect((await readDatePlanSchedule(coupleId,planId)).revision).toBe(0);
  const version = await saveDatePlanSchedule(coupleId,planId,'alice',0,'10:00',[block],[candidateId],[candidateId]);
  expect(version).toBe(1);
  const observed = await new Promise<number>((resolve,reject) => {
    let stop: () => void = () => {};
    stop = subscribeDatePlanSchedule(coupleId,planId,(schedule) => {
      if (schedule.revision !== 1) return;
      resolve(schedule.blocks[0].travelMinutes);
      queueMicrotask(() => stop());
    },reject);
  });
  expect(observed).toBe(20);
  as('bob');
  const bobDraft = await readDatePlanSchedule(coupleId,planId);
  expect(bobDraft.startTime).toBe('10:00');
  const revision2 = await saveDatePlanSchedule(coupleId,planId,'bob',bobDraft.revision,'11:00',
    [{...block,activityMinutes:90,travelMinutes:25}],[candidateId]);
  expect(revision2).toBe(2);
  as('alice');
  await expect(saveDatePlanSchedule(coupleId,planId,'alice',1,'09:00',[block],[candidateId]))
    .rejects.toThrow('date-plan-schedule-conflict');
  const latest = await readDatePlanSchedule(coupleId,planId);
  expect(latest.startTime).toBe('11:00');
  expect(latest.blocks[0].travelMinutes).toBe(25);
  expect(latest.updatedBy).toBe('bob');
  expect((await getDocFromServer(doc(client.db,'couples',coupleId,'datePlaces',oldPlace))).exists()).toBe(true);

  await assertFails(updateDoc(doc(client.db,path), {revision:3,updatedBy:'bob',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(client.db,path), {revision:4,updatedBy:'alice',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(client.db,path), {startTime:'28:00',blocks:[block],revision:3,updatedBy:'alice',updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(client.db,path)));
  await signup('eve');
  const outsider = as('eve');
  await assertFails(getDocFromServer(doc(outsider.db,path)));
  await assertFails(setDoc(doc(outsider.db,path), {startTime:'',blocks:[],revision:3,updatedBy:'eve',updatedAt:serverTimestamp()}));
});


test('date plan V2: two real members must approve, reviewed drafts freeze, and revisions preserve accepted content', async () => {
  const { coupleId } = await pair();
  as('alice');
  const legacyId = await addDatePlace(coupleId, 'alice', {
    name:'기존 여행 후보',address:'서울 광진구',latitude:37.51,longitude:127.08,category:'기타',memo:'',
  });
  const planId = await createDatePlanDraft(coupleId, 'alice', { title:'강변 데이트', date:'2026-10-20' });
  const candidateId = await addDatePlanCandidate(coupleId, planId, 'alice', {
    name:'CGV 강변',address:'서울 광진구',latitude:37.535,longitude:127.095,category:'놀거리',memo:'',
  });
  const candidate = (await readDatePlanCandidates(coupleId,planId))[0];
  const block = {
    id:'film', position:0, kind:'activity' as const, title:'영화',
    primaryCandidateId:candidateId, backupCandidateIds:[],
    activityMinutes:120, travelMinutes:20, fixedStart:null,
  };
  await saveDatePlanSchedule(coupleId,planId,'alice',0,'10:00',[block],[candidateId]);
  const statePath = 'couples/' + coupleId + '/datePlans/' + planId + '/approval/state';
  const infoPath = 'couples/' + coupleId + '/datePlans/' + planId;
  const schedulePath = infoPath + '/schedule/draft';
  const candidatePath = infoPath + '/candidates/' + candidateId;

  await requestDatePlanApproval(coupleId,planId,'alice',[candidate]);
  const requestActivityPath = 'couples/' + coupleId + '/activity/plan-' + planId + '-1';
  const requestActivity = (await getDocFromServer(doc(client.db,requestActivityPath))).data()!;
  expect(requestActivity.recipientUid).toBe('bob');
  expect(requestActivity.title).toBe('데이트 최종 확정 요청이 왔어요');
  expect(requestActivity.target).toEqual({screen:'date-plan',itemId:planId});
  as('bob');
  const requestFeed = await new Promise<string[]>((resolve,reject) => {
    let stop: () => void = () => {};
    stop = subscribeCoupleActivities(coupleId,'bob',(items) => {
      if (!items.some((item) => item.id === 'plan-' + planId + '-1')) return;
      resolve(items.map((item) => item.id));
      queueMicrotask(() => stop());
    },reject);
  });
  expect(requestFeed).toContain('plan-' + planId + '-1');
  as('alice');
  let state = (await getDocFromServer(doc(client.db,statePath))).data()!;
  expect(state.status).toBe('review');
  expect(state.approvedBy).toEqual({alice:true});
  expect(state.confirmedSnapshot.blocks[0].title).toBe('영화');
  await assertFails(updateDoc(doc(client.db,infoPath), {title:'독단적 변경',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(client.db,schedulePath), {startTime:'09:00',revision:2,updatedBy:'alice',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(client.db,candidatePath), {memo:'무단 수정',updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(client.db,candidatePath)));
  await expect(approveDatePlan(coupleId,planId,'alice')).rejects.toThrow('date-plan-approval-changed');

  as('bob');
  await assertFails(updateDoc(doc(client.db,statePath), {status:'confirmed',revision:2,updatedAt:serverTimestamp()}));
  as('alice');
  await assertFails(updateDoc(doc(client.db,statePath), {
    status:'confirmed', approvedBy:{alice:true,bob:true}, revision:2, updatedAt:serverTimestamp(),
  }));
  as('bob');
  await approveDatePlan(coupleId,planId,'bob');
  state = (await getDocFromServer(doc(client.db,statePath))).data()!;
  expect(state.status).toBe('confirmed');
  expect(state.approvedBy).toEqual({alice:true,bob:true});
  const approvedSnapshot = state.confirmedSnapshot;
  const observed = await new Promise<string>((resolve,reject) => {
    let stop: () => void = () => {};
    stop = subscribeDatePlanApproval(coupleId,planId,(value) => {
      if (value?.status !== 'confirmed') return;
      resolve(value.confirmedSnapshot.title);
      queueMicrotask(() => stop());
    },reject);
  });
  expect(observed).toBe('강변 데이트');
  await assertFails(deleteDoc(doc(client.db,statePath)));

  const proposal = {
    ...approvedSnapshot, title:'변경한 강변 데이트',
    blocks:[{...block,activityMinutes:90,travelMinutes:40}],
  };
  await proposeDatePlanChange(coupleId,planId,'bob',proposal,[candidate]);
  state = (await getDocFromServer(doc(client.db,statePath))).data()!;
  expect(state.status).toBe('change-review');
  expect(state.approvedBy).toEqual({bob:true});
  expect(state.confirmedSnapshot).toEqual(approvedSnapshot);
  await expect(approveDatePlan(coupleId,planId,'bob')).rejects.toThrow('date-plan-approval-changed');
  as('alice');
  await assertFails(updateDoc(doc(client.db,statePath), {
    'confirmedSnapshot.title':'몰래 변경', revision:state.revision+1,updatedAt:serverTimestamp(),
  }));
  await approveDatePlan(coupleId,planId,'alice');
  state = (await getDocFromServer(doc(client.db,statePath))).data()!;
  expect(state.status).toBe('confirmed');
  expect(state.confirmedSnapshot.title).toBe('변경한 강변 데이트');
  expect(state.confirmedSnapshot.blocks[0].travelMinutes).toBe(40);
  expect((await getDocFromServer(doc(client.db,schedulePath))).data()?.blocks[0].travelMinutes).toBe(20);
  expect((await getDocFromServer(doc(client.db,'couples',coupleId,'datePlaces',legacyId))).exists()).toBe(true);

  await proposeDatePlanChange(coupleId,planId,'alice',{...proposal,title:'취소할 변경안'},[candidate]);
  await withdrawDatePlanReview(coupleId,planId);
  state = (await getDocFromServer(doc(client.db,statePath))).data()!;
  expect(state.status).toBe('confirmed');
  expect(state.confirmedSnapshot.title).toBe('변경한 강변 데이트');

  await signup('eve');
  const outsider = as('eve');
  await assertFails(getDocFromServer(doc(outsider.db,statePath)));
  await assertFails(setDoc(doc(outsider.db,statePath), {
    status:'confirmed',requestedBy:'eve',proposedBy:'eve',approvedBy:{eve:true},
    confirmedSnapshot:proposal,proposedSnapshot:proposal,revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  }));
});

test('date plan V2: withdrawing initial review restores editable shared draft, not a false confirmation', async () => {
  const { coupleId } = await pair();
  as('alice');
  const planId = await createDatePlanDraft(coupleId,'alice',{title:'주말',date:'2026-10-21'});
  const candidateId = await addDatePlanCandidate(coupleId,planId,'alice', {
    name:'식당',address:'강릉',latitude:37.7,longitude:128.9,category:'맛집',memo:'',
  });
  const candidates = await readDatePlanCandidates(coupleId,planId);
  await saveDatePlanSchedule(coupleId,planId,'alice',0,'12:00',[{
    id:'meal',position:0,kind:'meal',title:'점심',primaryCandidateId:candidateId,
    backupCandidateIds:[],activityMinutes:90,travelMinutes:0,fixedStart:null,
  }],[candidateId]);
  await requestDatePlanApproval(coupleId,planId,'alice',candidates);
  as('bob');
  await withdrawDatePlanReview(coupleId,planId);
  const path = 'couples/' + coupleId + '/datePlans/' + planId;
  expect((await getDocFromServer(doc(client.db,path,'approval','state'))).exists()).toBe(false);
  await updateDatePlanDraft(coupleId,planId,{title:'수정 가능한 초안'});
  expect((await getDocFromServer(doc(client.db,path))).data()?.title).toBe('수정 가능한 초안');
});


test('actionable activity: partners see genuine messages, source spoofing and outsider reads are blocked', async () => {
  const { coupleId } = await pair();
  as('alice');
  const msg = { id: 983217, sender: 'me' as const, type: 'text' as const, text: '안녕!', timestamp: new Date().toISOString(), read: false };
  await sendCoupleMessage(coupleId, 'alice', msg);
  const record = 'couples/' + coupleId + '/activity/chat-983217';
  expect((await getDocFromServer(doc(client.db, record))).data()?.target)
    .toEqual({screen:'chat',itemId:'983217'});
  as('bob');
  const partnerFeed = await new Promise<string[]>((resolve, reject) => {
    let stop: () => void = () => {};
    stop = subscribeCoupleActivities(coupleId,'bob',(items) => {
      if (!items.some((item) => item.id === 'chat-983217')) return;
      resolve(items.map((item) => item.id));
      queueMicrotask(() => stop());
    },reject);
  });
  expect(partnerFeed).toContain('chat-983217');
  await assertFails(setDoc(doc(client.db, 'couples', coupleId, 'activity', 'chat-spoof'), {
    id:'chat-spoof',kind:'chat',sourceId:'spoof',revision:0,authorUid:'bob',recipientUid:'alice',
    title:'가짜 알림',detail:'',target:{screen:'chat',itemId:'spoof'},createdAt:serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(client.db, record)));
  await signup('eve');
  const outsider = as('eve');
  await assertFails(getDocFromServer(doc(outsider.db, record)));
});
