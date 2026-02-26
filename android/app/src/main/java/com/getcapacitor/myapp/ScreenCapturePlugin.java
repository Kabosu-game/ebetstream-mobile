package com.getcapacitor.myapp;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenCapture", requestCodes = { ScreenCapturePlugin.REQUEST_MEDIA_PROJECTION })
public class ScreenCapturePlugin extends Plugin {

    public static final int REQUEST_MEDIA_PROJECTION = 9001;

    private int permissionResultCode = Activity.RESULT_CANCELED;
    private Intent permissionResultData;
    private ScreenCaptureHelper helper;

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_MEDIA_PROJECTION) {
            permissionResultCode = resultCode;
            permissionResultData = data;
            PluginCall call = getSavedCall();
            if (call != null) {
                JSObject ret = new JSObject();
                ret.put("granted", resultCode == Activity.RESULT_OK);
                call.resolve(ret);
                getBridge().releaseCall(call);
            }
        }
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }
        MediaProjectionManager mgr = (MediaProjectionManager) activity.getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
        if (mgr == null) {
            call.reject("MediaProjection not available");
            return;
        }
        Intent intent = null;
        try {
            if (android.os.Build.VERSION.SDK_INT >= 34) {
                intent = mgr.createScreenCaptureIntent();
            }
        } catch (Throwable t) { /* ignore */ }
        if (intent == null) {
            try {
                java.lang.reflect.Method m = mgr.getClass().getMethod("getScreenCaptureIntent");
                intent = (Intent) m.invoke(mgr);
            } catch (Throwable t) {
                call.reject("Screen capture not available");
                return;
            }
        }
        startActivityForResult(call, intent, REQUEST_MEDIA_PROJECTION);
    }

    @PluginMethod
    public void startStream(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }
        if (permissionResultCode != Activity.RESULT_OK || permissionResultData == null) {
            call.reject("Permission not granted. Call requestPermission first.");
            return;
        }
        if (helper != null) {
            call.reject("Stream already running. Call stopStream first.");
            return;
        }
        MediaProjectionManager mgr = (MediaProjectionManager) activity.getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
        if (mgr == null) {
            call.reject("MediaProjection not available");
            return;
        }
        android.media.projection.MediaProjection projection = mgr.getMediaProjection(permissionResultCode, permissionResultData);
        if (projection == null) {
            call.reject("Failed to create MediaProjection");
            return;
        }
        int densityDpi = activity.getResources().getDisplayMetrics().densityDpi;
        final ScreenCaptureHelper h = new ScreenCaptureHelper((android.view.WindowManager) activity.getSystemService(Activity.WINDOW_SERVICE), densityDpi);
        helper = h;
        new Thread(() -> {
            try {
                final CountDownLatch uiLatch = new CountDownLatch(1);
                activity.runOnUiThread(() -> {
                    try {
                        h.start(projection);
                    } catch (Exception e) {
                        android.util.Log.e("ScreenCapture", "start failed", e);
                    } finally {
                        uiLatch.countDown();
                    }
                });
                if (!uiLatch.await(3, TimeUnit.SECONDS)) {
                    activity.runOnUiThread(() -> {
                        if (helper == h) {
                            helper = null;
                            try { h.stop(); } catch (Exception e) { android.util.Log.e("ScreenCapture", "stop timeout", e); }
                            call.reject("Start timeout");
                        }
                    });
                    return;
                }
                String url = null;
                for (int i = 0; i < 50 && helper == h; i++) {
                    try { Thread.sleep(100); } catch (InterruptedException e) { break; }
                    url = h.getStreamUrl();
                    if (url != null) break;
                }
                final String finalUrl = url;
                activity.runOnUiThread(() -> {
                    if (helper != h) return;
                    if (finalUrl != null) {
                        JSObject ret = new JSObject();
                        ret.put("url", finalUrl);
                        call.resolve(ret);
                    } else {
                        helper = null;
                        try { h.stop(); } catch (Exception e) { }
                        call.reject("Failed to start stream server");
                    }
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> {
                    if (helper == h) {
                        helper = null;
                        try { h.stop(); } catch (Exception e2) { }
                        call.reject(e.getMessage() != null ? e.getMessage() : "Failed to start stream");
                    }
                });
            }
        }, "ScreenCaptureStart").start();
    }

    @PluginMethod
    public void stopStream(PluginCall call) {
        Activity activity = getActivity();
        final ScreenCaptureHelper toStop = helper;
        helper = null;
        if (toStop != null && activity != null) {
            activity.runOnUiThread(() -> {
                try {
                    toStop.stop();
                } catch (Exception e) {
                    android.util.Log.e("ScreenCapture", "stopStream", e);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }
}
