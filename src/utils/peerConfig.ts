/**
 * PeerJS configuration.
 * En dev navigateur (localhost) : PeerServer local sur le port 9000.
 * En app (Capacitor) ou en prod : pas de localhost, PeerJS cloud par défaut.
 */
export function getPeerOptions(peerId?: string): { id?: string; debug?: number; host?: string; port?: number; path?: string; secure?: boolean } {
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
  const isLocalBrowser =
    typeof window !== 'undefined' &&
    !isCapacitor &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const base: Record<string, unknown> = {
    debug: isCapacitor ? 0 : 2,
  };

  if (peerId) {
    base.id = peerId;
  }

  if (isLocalBrowser) {
    base.host = window.location.hostname;
    base.port = 9000;
    base.path = '/peerjs';
    base.secure = false;
  }

  return base as ReturnType<typeof getPeerOptions>;
}
