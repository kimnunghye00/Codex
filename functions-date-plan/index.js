const { onRequest } = require('firebase-functions/v2/https');

// Retained as a tombstone endpoint for older installed clients.
exports.deleteDatePlanDraftV2 = onRequest({ region: 'asia-northeast3' }, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'date-planning-retired' });
});
