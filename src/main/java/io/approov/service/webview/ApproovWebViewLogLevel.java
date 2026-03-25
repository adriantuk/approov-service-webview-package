package io.approov.service.webview;

/**
 * Controls how much HTTP traffic the reusable service logs through OkHttp.
 */
public enum ApproovWebViewLogLevel {
    NONE,
    BASIC,
    HEADERS,
    BODY
}
