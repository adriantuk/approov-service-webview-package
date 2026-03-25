package io.approov.service.webview;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.net.URI;

public class ApproovWebViewConfigTest {
    @Test
    public void nativeRequestRuleMatchesConfiguredHostAndPathPrefix() {
        ApproovWebViewNativeRequestRule nativeRequestRule =
            new ApproovWebViewNativeRequestRule("api.example.com", "/v1/");

        assertTrue(nativeRequestRule.matches(URI.create("https://api.example.com/v1/orders")));
        assertFalse(nativeRequestRule.matches(URI.create("https://api.example.com/v2/orders")));
        assertFalse(nativeRequestRule.matches(URI.create("https://cdn.example.com/v1/orders")));
    }

    @Test
    public void configRetainsNativeRequestRules() {
        ApproovWebViewConfig config = new ApproovWebViewConfig.Builder("approov-config")
            .addAllowedOriginRule("https://app.example.com")
            .setServiceLoggingEnabled(true)
            .setOkHttpLogLevel(ApproovWebViewLogLevel.HEADERS)
            .addRedactedHeaderName("x-custom-secret")
            .addNativeRequestRule(new ApproovWebViewNativeRequestRule("api.example.com", "/v1/"))
            .build();

        assertEquals(1, config.getNativeRequestRules().size());
        assertEquals("api.example.com", config.getNativeRequestRules().get(0).getHost());
        assertEquals("/v1/", config.getNativeRequestRules().get(0).getPathPrefix());
        assertTrue(config.isServiceLoggingEnabled());
        assertEquals(ApproovWebViewLogLevel.HEADERS, config.getOkHttpLogLevel());
        assertTrue(config.getRedactedHeaderNames().contains("x-custom-secret"));
        assertTrue(config.getRedactedHeaderNames().contains("approov-token"));
        assertFalse(config.interceptsMainFrameNavigations());
        assertFalse(config.protectsSameFrameHtmlFormSubmissions());
    }

    @Test
    public void riskyHtmlReplayFeaturesAreExplicitOptIns() {
        ApproovWebViewConfig config = new ApproovWebViewConfig.Builder("approov-config")
            .addAllowedOriginRule("https://app.example.com")
            .setInterceptMainFrameNavigations(true)
            .setProtectSameFrameHtmlFormSubmissions(true)
            .build();

        assertTrue(config.interceptsMainFrameNavigations());
        assertTrue(config.protectsSameFrameHtmlFormSubmissions());
    }
}
