import { createSign } from 'node:crypto';
import process from 'node:process';

const projectId = 'meluni-f4e00';
const siteUrl = 'https://meluni-f4e00.web.app/';
const oneHourAgo = Date.now() - 60 * 60 * 1000;

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

async function accessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  const assertion = `${body}.${signer.sign(credentials.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`oauth-${response.status}`);
  return (await response.json()).access_token;
}

function field(document, name) {
  const value = document.fields?.[name];
  return value?.stringValue ?? value?.timestampValue ?? value?.booleanValue ?? '';
}

const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!credentials.client_email || !credentials.private_key) throw new Error('ROUTE_FIREBASE_SERVICE_ACCOUNT is missing');

const health = await fetch(siteUrl, { headers: { 'cache-control': 'no-cache' } });
if (!health.ok) throw new Error(`hosting-health-${health.status}`);
const html = await health.text();
if (!html.includes('단둘이') || !/assets\/index-[\w-]+\.js/.test(html)) throw new Error('hosting-release-marker-missing');

const token = await accessToken(credentials);
const endpoint = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/operationalErrors`);
endpoint.searchParams.set('pageSize', '100');
endpoint.searchParams.set('orderBy', 'createdAt desc');
const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
if (!response.ok) throw new Error(`diagnostics-read-${response.status}`);
const documents = (await response.json()).documents ?? [];
const recent = documents.filter((document) => Date.parse(field(document, 'createdAt')) >= oneHourAgo);
const callFailures = recent.filter((document) => field(document, 'area') === 'call').length;
const affectedUsers = new Set(recent.map((document) => field(document, 'uid')).filter(Boolean)).size;
const alert = recent.length >= 5 || callFailures >= 3;

const summary = `site=healthy errors_1h=${recent.length} call_errors_1h=${callFailures} affected_users=${affectedUsers}`;
console.log(summary);
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `alert=${alert}\nsummary=${summary}\n`);
}
if (alert) process.exitCode = 2;
