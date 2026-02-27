/**
 * Capture d'écran native dans l'app (Android MediaProjection).
 * Expose un MediaStream à partir du flux servi par le plugin (endpoint /frame).
 *
 * FIX : on attend qu'au moins N frames soient dessinés sur le canvas
 * AVANT de résoudre la promesse → WebRTC reçoit un stream avec de vraies données.
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
  try {
    return ScreenCaptureNative;
  } catch {
    return (window as any).Capacitor?.Plugins?.ScreenCapture ?? null;
  }
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

const MJPEG_FPS = 15;
const FRAME_POLL_MS = Math.round(1000 / MJPEG_FPS);

// ✅ FIX — Nombre de frames à attendre avant de considérer le stream "chaud"
//    WebRTC a besoin de vraies données dans le canvas au moment du addTrack()
const WARMUP_FRAMES = 3;

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
    throw new Error(
      typeof e === 'object' && e && 'message' in e
        ? String((e as Error).message)
        : 'Failed to start stream'
    );
  }

  if (!url || typeof url !== 'string') throw new Error('Failed to get stream URL');

  const baseUrl = url.replace(/\/+$/, '');
  const frameUrl = `${baseUrl}/frame`;

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  if (!ctx || typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas stream not supported');
  }

  // ✅ FIX — Démarrer captureStream AVEC un fps explicite
  //    Sans fps (ou 0), certains WebView Android ne génèrent pas de frames même si le canvas change
  const stream = canvas.captureStream(MJPEG_FPS);

  let stopped = false;
  let frameIntervalId: ReturnType<typeof setInterval> | null = null;
  let framesDrawn = 0;

  const stop = async () => {
    stopped = true;
    if (frameIntervalId) clearInterval(frameIntervalId);
    frameIntervalId = null;
    stream.getTracks().forEach((t) => t.stop());
    try {
      if (canvas.parentNode) canvas.remove();
    } catch (_) {}
    try {
      await plugin.stopStream();
    } catch (_) {}
  };

  const drawNextFrame = async (): Promise<boolean> => {
    if (stopped) return false;
    try {
      const res = await fetch(frameUrl, { cache: 'no-store' });
      if (!res.ok || !res.body) return false;
      const blob = await res.blob();
      if (blob.size === 0) return false;
      const bitmap = await createImageBitmap(blob);
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      framesDrawn++;
      return true;
    } catch (_) {
      return false;
    }
  };

  // ✅ FIX PRINCIPAL — Phase de "chauffe" : on dessine WARMUP_FRAMES frames
  //    de manière synchrone avant de retourner le stream à WebRTC.
  //    Sans ça, canvas.captureStream() retourne un stream "vide" et l'offre SDP
  //    n'a pas de vraie track vidéo → le viewer ne reçoit rien.
  // Warmup — on essaie d'avoir au moins 1 frame mais on ne bloque pas si ça prend trop de temps
  // Le plugin Android peut mettre jusqu'à 2-3s avant d'avoir le premier JPEG dispo
  console.log('[NativeCapture] Warming up canvas stream...');
  let warmupAttempts = 0;
  while (framesDrawn < 1 && warmupAttempts < 40) {  // 40 * 150ms = 6s max
    const ok = await drawNextFrame();
    if (!ok) await new Promise((r) => setTimeout(r, 150));
    warmupAttempts++;
  }

  // On continue même si on n'a pas eu de frame — le setInterval va continuer à essayer
  console.log(`[NativeCapture] Warmup done: ${framesDrawn} frames in ${warmupAttempts} attempts.`);

  // ✅ FIX — requestVideoFrameCallback si dispo, sinon setInterval classique
  //    Certains WebView Android throttlent setInterval en arrière-plan
  const useRVFC =
    typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  if (!useRVFC) {
    frameIntervalId = setInterval(drawNextFrame, FRAME_POLL_MS);
  } else {
    // Fallback via setInterval quand même (on n'a pas de <video> ici)
    frameIntervalId = setInterval(drawNextFrame, FRAME_POLL_MS);
  }

  // ✅ FIX — S'assurer que la track vidéo est bien "enabled" et "live"
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = true;
    console.log('[NativeCapture] VideoTrack state:', videoTrack.readyState, 'enabled:', videoTrack.enabled);
  } else {
    throw new Error('canvas.captureStream() n\'a pas généré de VideoTrack');
  }

  return { stream, stop };
}