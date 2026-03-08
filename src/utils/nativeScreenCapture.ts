/**
 * Capture d'écran native (Android MediaProjection) — version LOW LATENCY
 *
 * AVANT : XHR polling /frame à 15fps → latence 300-800ms
 * APRÈS : WebSocket push binaire → latence 80-150ms
 *
 * Le serveur Java pousse chaque JPEG dès qu'il est encodé, sans attente.
 */
import { registerPlugin } from '@capacitor/core';

export interface ScreenCapturePlugin {
  requestPermission(): Promise<{ granted: boolean }>;
  startStream(): Promise<{ url: string }>;
  stopStream(): Promise<void>;
}

const ScreenCaptureNative = registerPlugin<ScreenCapturePlugin>('ScreenCapture');

function getPlugin(): ScreenCapturePlugin | null {
  if (typeof (window as any).Capacitor === 'undefined') return null;
  try { return ScreenCaptureNative; }
  catch { return (window as any).Capacitor?.Plugins?.ScreenCapture ?? null; }
}

export function isNativeScreenCaptureAvailable(): boolean {
  return getPlugin() != null;
}

export async function requestNativeScreenPermission(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  const { granted } = await plugin.requestPermission();
  return granted;
}

const TARGET_FPS = 20;
const WARMUP_TIMEOUT_MS = 6000;

export async function getNativeScreenStream(): Promise<{
  stream: MediaStream;
  stop: () => Promise<void>;
}> {
  const plugin = getPlugin();
  if (!plugin) throw new Error('ScreenCapture plugin not available');

  let url: string;
  try {
    const result = await plugin.startStream();
    url = result?.url ?? '';
  } catch (e) {
    throw new Error(typeof e === 'object' && e && 'message' in e ? String((e as Error).message) : 'Failed to start stream');
  }
  if (!url || typeof url !== 'string') throw new Error('Failed to get stream URL');

  const baseUrl = url.replace(/\/+$/, '');
  // WebSocket sur le même port que le serveur HTTP Java
  const wsUrl = baseUrl.replace('http://', 'ws://') + '/ws';
  const frameUrl = `${baseUrl}/frame`;

  // ── Canvas + captureStream ────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas stream not supported');
  }

  const stream = canvas.captureStream(TARGET_FPS);
  let stopped = false;
  let ws: WebSocket | null = null;

  const stop = async () => {
    stopped = true;
    if (ws) {
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    }
    stream.getTracks().forEach(t => t.stop());
    try { if (canvas.parentNode) canvas.remove(); } catch (_) {}
    try { await plugin.stopStream(); } catch (_) {}
  };

  // ── Warmup : attendre le premier JPEG via /frame ──────────────────────────
  // On fait ça en HTTP simple pour s'assurer que le serveur Java est prêt
  // avant d'ouvrir le WebSocket.
  console.log('[NativeCapture] Warming up...');
  let warmedUp = false;
  const warmupStart = Date.now();

  while (!warmedUp && Date.now() - warmupStart < WARMUP_TIMEOUT_MS) {
    try {
      const blob = await fetchFrame(frameUrl);
      if (blob && blob.size > 0) {
        const bitmap = await createImageBitmap(blob);
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        warmedUp = true;
        console.log('[NativeCapture] Warmup OK — first frame received');
      }
    } catch (_) {}
    if (!warmedUp) await sleep(150);
  }

  if (!warmedUp) {
    console.warn('[NativeCapture] Warmup timeout — continuing anyway');
  }

  // ── Connexion WebSocket pour le push temps-réel ──────────────────────────
  console.log('[NativeCapture] Connecting WS:', wsUrl);

  await new Promise<void>((resolve) => {
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    // Résoudre dès que le WS est ouvert (même si pas encore de frame)
    ws.onopen = () => {
      console.log('[NativeCapture] WS connected');
      resolve();
    };

    ws.onerror = (e) => {
      console.error('[NativeCapture] WS error', e);
      resolve(); // résoudre quand même, le stream canvas a déjà un frame
    };

    ws.onclose = () => {
      if (!stopped) {
        console.warn('[NativeCapture] WS closed unexpectedly');
        // Tenter de reconnecter après 500ms
        setTimeout(() => {
          if (!stopped) reconnectWs(wsUrl, canvas, ctx, stream, () => stopped, (newWs) => { ws = newWs; });
        }, 500);
      }
    };

    ws.onmessage = async (evt) => {
      if (stopped) return;
      try {
        const blob = new Blob([evt.data], { type: 'image/jpeg' });
        if (blob.size === 0) return;
        const bitmap = await createImageBitmap(blob);
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      } catch (_) {}
    };

    // Timeout au cas où le WS ne répond pas
    setTimeout(resolve, 2000);
  });

  // Vérifier la track vidéo
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) throw new Error("canvas.captureStream() n'a pas généré de VideoTrack");
  videoTrack.enabled = true;
  console.log('[NativeCapture] VideoTrack:', videoTrack.readyState, 'enabled:', videoTrack.enabled);

  return { stream, stop };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchFrame(url: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.timeout = 2000;
    xhr.onload = () => resolve(xhr.status === 200 && xhr.response?.size > 0 ? xhr.response : null);
    xhr.onerror = () => resolve(null);
    xhr.ontimeout = () => resolve(null);
    xhr.send();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function reconnectWs(
  wsUrl: string,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  stream: MediaStream,
  isStopped: () => boolean,
  setWs: (ws: WebSocket) => void
) {
  if (isStopped()) return;
  console.log('[NativeCapture] Reconnecting WS...');
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  setWs(ws);

  ws.onopen = () => console.log('[NativeCapture] WS reconnected');

  ws.onerror = () => {
    if (!isStopped()) setTimeout(() => reconnectWs(wsUrl, canvas, ctx, stream, isStopped, setWs), 1000);
  };

  ws.onclose = () => {
    if (!isStopped()) setTimeout(() => reconnectWs(wsUrl, canvas, ctx, stream, isStopped, setWs), 500);
  };

  ws.onmessage = async (evt) => {
    if (isStopped()) return;
    try {
      const blob = new Blob([evt.data], { type: 'image/jpeg' });
      if (blob.size === 0) return;
      const bitmap = await createImageBitmap(blob);
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    } catch (_) {}
  };
}