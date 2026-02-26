package com.getcapacitor.myapp;

import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;

import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Capture l'écran via MediaProjection et sert un flux MJPEG sur localhost
 * pour que le WebView puisse le charger dans une balise video et utiliser captureStream().
 */
public class ScreenCaptureHelper {
    private static final String TAG = "ScreenCaptureHelper";
    private static final int VIRT_DISPLAY_FLAGS =
            DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
                    | DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC;
    private static final int MIN_DIMENSION = 64;
    private static final int MAX_DIMENSION = 1280;
    private static final int JPEG_QUALITY = 80;
    private static final int TARGET_FPS = 15;

    private final WindowManager windowManager;
    private final int width;
    private final int height;
    private final int densityDpi;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread handlerThread;
    private Handler handler;
    private final AtomicReference<byte[]> latestJpeg = new AtomicReference<>();
    private ServerSocket serverSocket;
    private int serverPort = 0;
    private volatile boolean running = false;
    private Thread serverThread;

    public ScreenCaptureHelper(WindowManager wm, int densityDpi) {
        this.windowManager = wm;
        this.densityDpi = densityDpi <= 0 ? 320 : Math.min(480, Math.max(120, densityDpi));
        Display display = wm.getDefaultDisplay();
        Point size = new Point();
        try {
            display.getSize(size);
        } catch (Throwable t) {
            size.x = 720;
            size.y = 1280;
        }
        int w = Math.max(1, size.x);
        int h = Math.max(1, size.y);
        while (w * h > (2 << 19)) {
            w = w >> 1;
            h = h >> 1;
        }
        if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
            float scale = Math.min((float) MAX_DIMENSION / w, (float) MAX_DIMENSION / h);
            w = (int) (w * scale);
            h = (int) (h * scale);
        }
        if (w < MIN_DIMENSION) w = MIN_DIMENSION;
        if (h < MIN_DIMENSION) h = MIN_DIMENSION;
        w = w & ~1;
        h = h & ~1;
        if (w < MIN_DIMENSION) w = MIN_DIMENSION;
        if (h < MIN_DIMENSION) h = MIN_DIMENSION;
        this.width = w;
        this.height = h;
    }

    public int getWidth() { return width; }
    public int getHeight() { return height; }

    public void start(MediaProjection projection) {
        if (running) return;
        if (projection == null) return;
        if (width <= 0 || height <= 0) {
            Log.e(TAG, "Invalid dimensions " + width + "x" + height);
            return;
        }
        Log.d("SCDBG", "H3: helper.start begin " + width + "x" + height);
        try {
            this.mediaProjection = projection;
            running = true;

            // Démarrer le ServerSocket en premier pour que l'URL soit dispo tout de suite
            Thread setupThread = new Thread(() -> {
                try {
                    Log.d("SCDBG", "H3: ServerSocket creating");
                    ServerSocket ss = new ServerSocket(0);
                    serverSocket = ss;
                    serverPort = ss.getLocalPort();
                    ScreenCaptureService.streamUrl = "http://127.0.0.1:" + serverPort;
                    serverThread = new Thread(this::serveMjpeg, "MjpegServer");
                    serverThread.start();
                    Log.d("SCDBG", "H3: ServerSocket port=" + serverPort + " streamUrl set");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start MJPEG server", e);
                    running = false;
                }
            }, "ScreenCaptureSetup");
            setupThread.start();

            handlerThread = new HandlerThread("ScreenCapture", android.os.Process.THREAD_PRIORITY_BACKGROUND);
            handlerThread.start();
            handler = new Handler(handlerThread.getLooper());
            Log.d("SCDBG", "H3: HandlerThread started");

            try {
                imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3);
            } catch (Throwable t) {
                Log.e(TAG, "ImageReader.newInstance failed", t);
                running = false;
                ScreenCaptureService.streamUrl = null;
                stop();
                return;
            }
            Log.d("SCDBG", "H3: ImageReader created");
            imageReader.setOnImageAvailableListener(reader -> {
                Image image = null;
                try {
                    image = reader.acquireLatestImage();
                    if (image != null) {
                        byte[] jpeg = imageToJpeg(image);
                        if (jpeg != null) latestJpeg.set(jpeg);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "onImageAvailable error", e);
                } finally {
                    if (image != null) try { image.close(); } catch (Exception e2) { }
                }
            }, handler);

            Handler mainHandler = new Handler(Looper.getMainLooper());
            Log.d("SCDBG", "H3: before createVirtualDisplay");
            try {
                virtualDisplay = mediaProjection.createVirtualDisplay(
                        "ScreenCapture",
                        width, height, densityDpi,
                        VIRT_DISPLAY_FLAGS,
                        imageReader.getSurface(),
                        null, mainHandler);
            } catch (Throwable t) {
                Log.e(TAG, "createVirtualDisplay failed", t);
                imageReader.close();
                imageReader = null;
                running = false;
                ScreenCaptureService.streamUrl = null;
                stop();
                return;
            }
            Log.d("SCDBG", "H3: createVirtualDisplay done");
        } catch (Throwable t) {
            Log.e(TAG, "start failed", t);
            running = false;
            ScreenCaptureService.streamUrl = null;
            stop();
        }
    }

    private byte[] imageToJpeg(Image image) {
        try {
            Image.Plane[] planes = image.getPlanes();
            if (planes == null || planes.length == 0) return null;
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            if (rowStride <= 0 || pixelStride <= 0) return null;
            int rowPadding = rowStride - pixelStride * width;
            int bitmapWidth = width + rowPadding / pixelStride;
            if (bitmapWidth <= 0 || height <= 0) return null;

            Bitmap bitmap = Bitmap.createBitmap(bitmapWidth, height, Bitmap.Config.ARGB_8888);
            bitmap.copyPixelsFromBuffer(buffer);
            Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height);
            if (bitmap != cropped) bitmap.recycle();

            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos);
            cropped.recycle();
            return baos.toByteArray();
        } catch (Exception e) {
            Log.e(TAG, "imageToJpeg error", e);
            return null;
        }
    }

    private void serveMjpeg() {
        try {
            if (serverSocket == null) return;
            while (running) {
                Socket client = serverSocket.accept();
                try {
                    java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(client.getInputStream()));
                    String requestLine = reader.readLine();
                    String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) { /* consommer en-têtes */ }
                    String path = (requestLine != null && requestLine.startsWith("GET ")) ? requestLine.split(" ")[1].split("\\?")[0] : "/";
                    OutputStream out = client.getOutputStream();

                    if (path.contains("frame")) {
                        for (int i = 0; i < 80 && latestJpeg.get() == null && running; i++) {
                            try { Thread.sleep(50); } catch (InterruptedException e) { break; }
                        }
                        byte[] jpeg = latestJpeg.get();
                        if (jpeg != null && jpeg.length > 0) {
                            String header = "HTTP/1.0 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: " + jpeg.length + "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
                            out.write(header.getBytes());
                            out.write(jpeg);
                        } else {
                            String header = "HTTP/1.0 204 No Content\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
                            out.write(header.getBytes());
                        }
                        out.flush();
                        client.close();
                        continue;
                    }

                    for (int i = 0; i < 60 && latestJpeg.get() == null && running; i++) {
                        try { Thread.sleep(50); } catch (InterruptedException e) { break; }
                    }
                    String boundary = "frame";
                    String header = "HTTP/1.0 200 OK\r\n" +
                            "Content-Type: multipart/x-mixed-replace; boundary=" + boundary + "\r\n" +
                            "Cache-Control: no-store\r\n\r\n";
                    out.write(header.getBytes());
                    out.flush();

                    long frameIntervalMs = 1000 / TARGET_FPS;
                    while (running && !client.isClosed()) {
                        byte[] jpeg = latestJpeg.get();
                        if (jpeg != null && jpeg.length > 0) {
                            String part = "--" + boundary + "\r\nContent-Type: image/jpeg\r\nContent-Length: " + jpeg.length + "\r\n\r\n";
                            out.write(part.getBytes());
                            out.write(jpeg);
                            out.write("\r\n".getBytes());
                            out.flush();
                        }
                        Thread.sleep(frameIntervalMs);
                    }
                    client.close();
                } catch (Exception e) {
                    try { client.close(); } catch (Exception e2) { }
                    if (running) Log.e(TAG, "MJPEG client error", e);
                }
            }
        } catch (Exception e) {
            if (running) Log.e(TAG, "MJPEG server error", e);
        }
    }

    public String getStreamUrl() {
        if (serverPort <= 0) return null;
        return "http://127.0.0.1:" + serverPort;
    }

    public void stop() {
        running = false;
        try {
            if (virtualDisplay != null) {
                virtualDisplay.release();
                virtualDisplay = null;
            }
        } catch (Exception e) { Log.e(TAG, "stop virtualDisplay", e); }
        try {
            if (imageReader != null) {
                imageReader.close();
                imageReader = null;
            }
        } catch (Exception e) { Log.e(TAG, "stop imageReader", e); }
        try {
            if (mediaProjection != null) {
                mediaProjection.stop();
                mediaProjection = null;
            }
        } catch (Exception e) { Log.e(TAG, "stop mediaProjection", e); }
        try {
            if (serverSocket != null) {
                serverSocket.close();
                serverSocket = null;
            }
        } catch (Exception e) { Log.e(TAG, "stop serverSocket", e); }
        if (serverThread != null && serverThread.isAlive()) {
            serverThread.interrupt();
        }
        try {
            if (handlerThread != null && handlerThread.isAlive()) {
                handlerThread.quitSafely();
            }
        } catch (Exception e) { Log.e(TAG, "stop handlerThread", e); }
    }
}
