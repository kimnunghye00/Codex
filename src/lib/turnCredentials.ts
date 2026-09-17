import { auth } from './firebaseAuth';
import { createTurnCredentialClient } from './turnCredentialClient';

const client = createTurnCredentialClient({ getUser: () => auth.currentUser });

export function clearTurnIceServers() {
  client.clear();
  document.documentElement.dataset.danduliTurnReady = '0';
}

export async function loadTurnIceServers(coupleId: string): Promise<RTCIceServer[]> {
  const endpoint = String(import.meta.env.VITE_TURN_CREDENTIALS_URL || '').trim();
  if (endpoint && !/^https:\/\//.test(endpoint) && !/^\/(?!\/)/.test(endpoint)) {
    throw new Error('turn-credentials-insecure-url');
  }
  try {
    const servers = await client.load(coupleId, endpoint);
    document.documentElement.dataset.danduliTurnReady = servers.length ? '1' : '0';
    return servers;
  } catch (cause) {
    document.documentElement.dataset.danduliTurnReady = '0';
    throw cause;
  }
}
