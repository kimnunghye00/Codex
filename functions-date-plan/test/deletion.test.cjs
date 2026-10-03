const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('retired planning endpoint returns 410 without loading data services', () => {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
    exports, require: (name) => {
      assert.equal(name, 'firebase-functions/v2/https');
      return { onRequest: (_, handler) => handler };
    },
  });
  let status;
  const response = { set() { return this; }, status(value) { status = value; return this; }, json(value) { return value; } };
  assert.equal(exports.deleteDatePlanDraftV2({}, response).error, 'date-planning-retired');
  assert.equal(status, 410);
});
