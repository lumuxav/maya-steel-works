package com.mayasteelworks.management;

import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long EXIT_WINDOW_MS = 2200L;
    private long lastExitAttempt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleMayaBack();
            }
        });
    }

    private void handleMayaBack() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        webView.evaluateJavascript(
            "(function(){return window.location.pathname || '/'})()",
            pathnameJson -> runOnUiThread(() -> {
                String path = pathnameJson == null ? "" : pathnameJson.replace("\"", "");
                if ("/".equals(path) || "/login".equals(path)) {
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastExitAttempt <= EXIT_WINDOW_MS) {
                        lastExitAttempt = 0L;
                        finish();
                    } else {
                        lastExitAttempt = now;
                        Toast.makeText(this, "Press Back again to exit Maya", Toast.LENGTH_SHORT).show();
                    }
                    return;
                }

                lastExitAttempt = 0L;
                webView.evaluateJavascript(
                    "(function(){if(window.__mayaBackListenerReady){window.dispatchEvent(new Event('maya-native-back'));}else{window.location.assign('/');}})()",
                    null
                );
            })
        );
    }
}
