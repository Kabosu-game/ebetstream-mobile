/**
 * Capture d'écran native dans l'app (Android MediaProjection).
 * Expose un MediaStream à partir du flux servi par le plugin (endpoint /frame).
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

/**
 * Demande la permission de capture d'écran (lance le dialogue système).
 */
export async function requestNativeScreenPermission(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  const { granted } = await plugin.requestPermission();
  return granted;
}

const MJPEG_FPS = 15;
const FRAME_POLL_MS = Math.round(1000 / MJPEG_FPS);

/**
 * Démarre la capture native et retourne un MediaStream + une fonction stop.
 * Utilise GET /frame (une image JPEG par requête) + canvas.captureStream(),
 * compatible avec tous les WebViews Android (pas de MJPEG multipart dans <img>).
 */
export async function getNativeScreenStream(): Promise<{ stream: MediaStream; stop: () => Promise<void> }> {
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
  const frameUrl = `${baseUrl}/frame`;
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas stream not supported');
  }

  const stream = canvas.captureStream(MJPEG_FPS);
  let stopped = false;
  let frameIntervalId: ReturnType<typeof setInterval> | null = null;

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

  const drawNextFrame = async () => {
    if (stopped) return;
    try {
      const res = await fetch(frameUrl, { cache: 'no-store' });
      if (!res.ok || !res.body) return;
      const blob = await res.blob();
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

  await drawNextFrame();
  frameIntervalId = setInterval(drawNextFrame, FRAME_POLL_MS);

  return { stream, stop };
}
