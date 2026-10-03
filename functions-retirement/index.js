const { onRequest } = require('firebase-functions/v2/https');

// Isolated deployment descriptor: does not load TURN configuration or access data.
exports.deleteDatePlanDraft = onRequest({ region: 'asia-northeast3' }, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'date-planning-retired' });
});
