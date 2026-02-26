/**
 * Capture d'écran native dans l'app (Android MediaProjection).
 * Expose un MediaStream à partir du flux MJPEG servi par le plugin.
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

/**
 * Démarre la capture native et retourne un MediaStream + une fonction stop.
 * Utilise une image MJPEG + canvas.captureStream() (le WebView ne lit pas toujours MJPEG en <video>).
 */
export async function getNativeScreenStream(): Promise<{ stream: MediaStream; stop: () => Promise<void> }> {
  const plugin = getPlugin();
  if (!plugin) throw new Error('ScreenCapture plugin not available');

  const { url } = await plugin.startStream();
  if (!url) throw new Error('Failed to get stream URL');

  const img = document.createElement('img');
  img.crossOrigin = 'anonymous';
  img.style.position = 'fixed';
  img.style.left = '-9999px';
  img.style.visibility = 'hidden';
  document.body.appendChild(img);

  const streamUrl = url + (url.endsWith('/') ? '' : '/');
  let streamRef: MediaStream | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let intervalId = 0;

  const stop = async () => {
    if (intervalId) clearInterval(intervalId);
    if (streamRef) streamRef.getTracks().forEach((t) => t.stop());
    streamRef = null;
    img.src = '';
    img.remove();
    if (canvas?.parentNode) canvas.remove();
    try {
      await plugin.stopStream();
    } catch (_) {}
  };

  const tryCreateStream = (): boolean => {
    if (streamRef) return true;
    const w = img.naturalWidth || img.width || 1280;
    const h = img.naturalHeight || img.height || 720;
    if (w <= 0 || h <= 0) return false;
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') return false;
    const stream = canvas.captureStream(MJPEG_FPS);
    streamRef = stream;
    intervalId = window.setInterval(() => {
      if (ctx && img.naturalWidth > 0) ctx.drawImage(img, 0, 0);
    }, 1000 / MJPEG_FPS);
    return true;
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      img.src = '';
      img.remove();
      reject(new Error('Timeout loading screen stream'));
    }, 12000);

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (streamRef) resolve({ stream: streamRef, stop });
      else reject(new Error('Failed to create stream'));
    };

    img.onload = () => {
      if (tryCreateStream()) done();
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      img.remove();
      reject(new Error('Failed to load screen stream'));
    };

    img.src = streamUrl;

    // WebView Android peut ne pas déclencher onload pour MJPEG multipart : après 1.5 s on essaie quand même
    setTimeout(() => {
      if (streamRef) return;
      if (tryCreateStream()) done();
    }, 1500);
  });
}
