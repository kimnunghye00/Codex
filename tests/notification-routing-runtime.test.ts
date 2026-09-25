import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePartnerNotifications, notificationDestination, notificationRouteUrl, type AppNotification } from '../src/utils/notifications.ts';

const example = (id: string): AppNotification => ({
  id, actor: 'partner', kind: 'date-plan', title: '최종 확정 요청',
  createdAt: '2026-09-25T01:00:00.000Z', read: false,
  target: { screen: 'date-plan', itemId: 'abc123' },
});

test('different partner activity may navigate only to declared app screens', () => {
  assert.deepEqual(notificationDestination({ screen: 'date-plan', itemId: 'abc123' }), { screen:'date-plan', itemId:'abc123' });
  assert.deepEqual(notificationDestination({ screen: 'chat', itemId: '123456' }), { screen:'chat', itemId:'123456' });
  assert.deepEqual(notificationDestination({ screen: 'album', itemId: '481' }), { screen:'album', itemId:'481' });
  assert.equal(notificationDestination({ screen:'javascript:alert(1)', itemId:'2' }), null);
  assert.equal(notificationDestination({ screen:'chat', itemId:'../../settings' }), null);
  assert.equal(notificationDestination({ screen:'album', itemId:'not-a-number' }), null);
  assert.equal(notificationRouteUrl({ screen:'date-plan', itemId:'abc123' }), '/?open=date-plan&item=abc123');
});

test('merging new live events preserves read state and avoids duplicate cards', () => {
  const older = { ...example('cloud:plan-1-1'), read: true };
  const updated = { ...example('cloud:plan-1-1'), detail:'changed' };
  const newest = { ...example('cloud:plan-1-2'), title:'확정 완료', createdAt:'2026-09-25T01:01:00.000Z' };
  assert.deepEqual(mergePartnerNotifications([older], [updated, newest]).map(({ id, read }) => [id, read]), [
    ['cloud:plan-1-2', false], ['cloud:plan-1-1', true],
  ]);
});
