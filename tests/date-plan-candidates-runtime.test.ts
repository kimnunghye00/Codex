import assert from 'node:assert/strict';
import { test } from 'node:test';
import { datePlanCandidateId, isSameDatePlanPlace } from '../src/lib/datePlanCandidates.ts';

const origin = { name: ' 이재모피자  서면점 ', address: '부산 부산진구 전포대로 209', latitude: 35.15725, longitude: 129.05951 };

test('identical locations from two users resolve to the same candidate ID', () => {
  assert.equal(datePlanCandidateId(origin), datePlanCandidateId({ ...origin, name: '이재모피자 서면점' }));
  assert.equal(isSameDatePlanPlace(origin, { ...origin, latitude: origin.latitude + 0.00008 }), true);
});
test('similarly named but geographically distinct branches are not merged', () => {
  const branch = { ...origin, latitude: 35.183, longitude: 129.078 };
  assert.equal(isSameDatePlanPlace(origin, branch), false);
  assert.notEqual(datePlanCandidateId(origin), datePlanCandidateId(branch));
});
test('a similar name at the same point does not conflate unrelated businesses', () => {
  assert.equal(isSameDatePlanPlace(origin, { ...origin, name: '이재모피자 광복점' }), false);
});
test('matching addresses tolerate moderate provider coordinate deviations', () => {
  assert.equal(isSameDatePlanPlace(origin, { ...origin, latitude: origin.latitude + 0.0007 }), true);
  assert.equal(isSameDatePlanPlace(origin, { ...origin, latitude: origin.latitude + 0.0007, address: '다른 주소' }), false);
});
