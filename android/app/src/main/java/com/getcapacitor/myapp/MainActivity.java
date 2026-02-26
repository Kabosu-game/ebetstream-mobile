package com.getcapacitor.myapp;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {

    @Override
    protected void load() {
        registerPlugin(ScreenCapturePlugin.class);
        super.load();
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            webView.setWebChromeClient(new MediaPermissionWebChromeClient(bridge));
        }
    }
}
