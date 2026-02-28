package com.getcapacitor.myapp;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import java.util.concurrent.TimeUnit;

import android.util.Log;

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

    private static final String SCDBG = "SCDBG";

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_MEDIA_PROJECTION) {
            Log.d(SCDBG, "H5: handleOnActivityResult resultCode=" + resultCode + " data=" + (data != null));
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
    if (activity == null) { call.reject("Activity not available"); return; }
    MediaProjectionManager mgr = (MediaProjectionManager) activity.getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
    if (mgr == null) { call.reject("MediaProjection not available"); return; }
    
    // ✅ FIX — createScreenCaptureIntent() disponible depuis Android 5 (API 21)
    // Pas besoin de réflexion, cette méthode existe depuis le début de MediaProjection
    Intent intent = mgr.createScreenCaptureIntent();
    startActivityForResult(call, intent, REQUEST_MEDIA_PROJECTION);
}

    @PluginMethod
    public void startStream(PluginCall call) {
        Log.d(SCDBG, "H5: startStream start");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }
        if (permissionResultCode != Activity.RESULT_OK || permissionResultData == null) {
            Log.d(SCDBG, "H5: startStream reject permission");
            call.reject("Permission not granted. Call requestPermission first.");
            return;
        }
        Intent serviceIntent = new Intent(activity, ScreenCaptureService.class);
        serviceIntent.putExtra("resultCode", permissionResultCode);
        serviceIntent.putExtra("data", permissionResultData);
        Log.d(SCDBG, "H1/H5: before startForegroundService");
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                activity.startForegroundService(serviceIntent);
            } else {
                activity.startService(serviceIntent);
            }
            Log.d(SCDBG, "H1/H5: startForegroundService done");
        } catch (Throwable t) {
            Log.e(SCDBG, "H1/H5: startForegroundService threw", t);
            call.reject(t.getMessage());
            return;
        }

        new Thread(() -> {
            String url = null;
            for (int i = 0; i < 90; i++) {
                try { Thread.sleep(100); } catch (InterruptedException e) { break; }
                url = ScreenCaptureService.getStreamUrl();
                if (url != null) break;
            }
            Log.d(SCDBG, "H4/H5: plugin thread url=" + (url != null));
            final String finalUrl = url;
            Activity a = getActivity();
            if (a == null || a.isDestroyed()) {
                if (finalUrl == null) {
                    try { activity.stopService(new Intent(activity, ScreenCaptureService.class)); } catch (Exception e) { }
                }
                return;
            }
            a.runOnUiThread(() -> {
                Activity act = getActivity();
                if (act == null || act.isDestroyed()) return;
                if (finalUrl != null) {
                    JSObject ret = new JSObject();
                    ret.put("url", finalUrl);
                    call.resolve(ret);
                    Log.d(SCDBG, "H5: call.resolve done");
                } else {
                    try { act.stopService(new Intent(act, ScreenCaptureService.class)); } catch (Exception e) { }
                    call.reject("Failed to start stream server");
                }
            });
        }, "ScreenCaptureStart").start();
    }

    @PluginMethod
    public void stopStream(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.stopService(new Intent(activity, ScreenCaptureService.class));
        }
        call.resolve();
    }
}
