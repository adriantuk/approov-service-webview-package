package io.approov.service.webview;

import java.net.URI;

/**
 * Describes which outbound page requests should be re-executed through the native Approov bridge.
 *
 * <p>Keeping this allow-list narrow avoids replacing normal browser networking for unrelated page
 * traffic such as analytics, third-party scripts, and general site navigation.
 */
public final class ApproovWebViewNativeRequestRule {
    private final String host;
    private final String pathPrefix;

    public ApproovWebViewNativeRequestRule(String host, String pathPrefix) {
        this.host = requireNonBlank(host, "host");
        this.pathPrefix = pathPrefix == null ? "" : pathPrefix;
    }

    public String getHost() {
        return host;
    }

    public String getPathPrefix() {
        return pathPrefix;
    }

    public boolean matches(URI uri) {
        if (uri == null || uri.getHost() == null) {
            return false;
        }

        if (!host.equalsIgnoreCase(uri.getHost())) {
            return false;
        }

        return pathPrefix.isEmpty() || uri.getPath().startsWith(pathPrefix);
    }

    private static String requireNonBlank(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }

        return value;
    }
}
