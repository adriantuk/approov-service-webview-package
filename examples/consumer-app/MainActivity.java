package com.example.consumer;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import io.approov.service.webview.ApproovWebViewService;

public final class MainActivity extends AppCompatActivity {
    private WebView webView;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        ApproovWebViewService service = ApproovWebViewService.getInstance();
        service.configureWebView(webView);
        webView.setWebViewClient(service.buildWebViewClient(null));
        webView.loadUrl("https://your-web-app.example.com");
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            ApproovWebViewService.getInstance().releaseWebView(webView);
            webView.destroy();
        }

        super.onDestroy();
    }
}
