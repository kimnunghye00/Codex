import { auth } from './firebaseAuth';
import {
  configureRouteBackgroundLocationUpload,
  isNativePlatform,
  nativePlatform,
} from './native';

const REGISTER_URL = 'https://asia-northeast3-meluni-f4e00.cloudfunctions.net/registerLocationUploadDevice';
const REVOKE_URL = 'https://asia-northeast3-meluni-f4e00.cloudfunctions.net/revokeLocationUploadDevice';
export const BACKGROUND_LOCATION_UPLOAD_URL = 'https://asia-northeast3-meluni-f4e00.cloudfunctions.net/uploadBackgroundLocation';

type ProvisionedCredential = {
  ownerUid: string;
  coupleId: string;
  secret: string;
  expiresAt: string;
};

async function authenticatedPost(url: string, body: unknown) {
  const user = auth.currentUser;
  if (!user) throw new Error('background-location-auth-required');
  const token = await user.getIdToken(true);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'background-location-server-failed');
  }
  return payload;
}

export async function provisionBackgroundLocationUpload(coupleId: string, ownerUid: string) {
  if (!isNativePlatform() || nativePlatform() !== 'android') return;
  const payload = await authenticatedPost(REGISTER_URL, { coupleId }) as unknown as ProvisionedCredential;
  if (payload.ownerUid !== ownerUid || payload.coupleId !== coupleId
    || typeof payload.secret !== 'string' || payload.secret.length < 32) {
    throw new Error('background-location-credential-mismatch');
  }

  await configureRouteBackgroundLocationUpload({
    endpoint: BACKGROUND_LOCATION_UPLOAD_URL,
    coupleId,
    ownerUid,
    secret: payload.secret,
  });
}

export async function revokeBackgroundLocationUpload(coupleId: string) {
  if (!isNativePlatform() || nativePlatform() !== 'android') return;
  try {
    await authenticatedPost(REVOKE_URL, { coupleId });
  } catch (error) {
    // The native credential is still cleared when tracking stops. A failed
    // revocation cannot keep the device uploading, and the server token expires.
    console.warn('[DANDULI background location revoke]', error);
  }
}
