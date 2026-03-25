# Approov Service WebView for Android

Standalone Android library repo for protecting `WebView` API traffic with Approov through the Approov OkHttp SDK.

This repo is intended for source-based consumption from GitHub. Customers do not need a Maven publication, but they do need to add the repo to their Gradle build as a source module.

## What It Covers

- `fetch(...)`
- `XMLHttpRequest`
- same-frame HTML form submission
- native-only secret header injection
- Approov token injection through `io.approov:service.okhttp`
- cookie sync between `CookieManager` and native OkHttp
- document-start bridge injection through `androidx.webkit`

## Repo Layout

- `src/main/java/io/approov/service/webview/`
  - public library classes
- `src/main/assets/approov-webview-bridge.js`
  - injected JavaScript bridge
- `examples/consumer-app/`
  - example snippets for consuming this repo from GitHub source
- `docs/ADDING_FROM_GITHUB.md`
  - step-by-step integration guide

## Add From GitHub Source

The supported flow is:

1. add this repo to your app repo as a git submodule or sibling checkout
2. include it in your Gradle settings as a project
3. depend on it with `implementation(project(":approov-service-webview"))`

Use the exact snippets in [docs/ADDING_FROM_GITHUB.md](/Users/adriantukendorf/Developer/WebView%20Quickstarts/approov-service-webview-android/docs/ADDING_FROM_GITHUB.md).

## Minimal Integration

Create the config once in your `Application`:

```java
import io.approov.service.webview.ApproovWebViewConfig;
import io.approov.service.webview.ApproovWebViewLogLevel;
import io.approov.service.webview.ApproovWebViewNativeRequestRule;
import io.approov.service.webview.ApproovWebViewSecretHeader;
import io.approov.service.webview.ApproovWebViewService;

ApproovWebViewConfig config = new ApproovWebViewConfig.Builder(BuildConfig.APPROOV_CONFIG)
    .setApproovDevKey(BuildConfig.APPROOV_DEV_KEY)
    .setApproovTokenHeaderName("approov-token")
    .setAllowRequestsWithoutApproov(true)
    .setServiceLoggingEnabled(BuildConfig.DEBUG)
    .setOkHttpLogLevel(BuildConfig.DEBUG ? ApproovWebViewLogLevel.HEADERS : ApproovWebViewLogLevel.NONE)
    .addAllowedOriginRule("https://your-web-app.example.com")
    .addNativeRequestRule(new ApproovWebViewNativeRequestRule(
        "api.example.com",
        "/protected/"
    ))
    .addSecretHeader(new ApproovWebViewSecretHeader(
        "api.example.com",
        "/protected/",
        "x-api-key",
        BuildConfig.PROTECTED_API_KEY
    ))
    .build();

ApproovWebViewService.initialize(this, config);
```

Then configure the `WebView` in your activity:

```java
ApproovWebViewService service = ApproovWebViewService.getInstance();
service.configureWebView(webView);
webView.setWebViewClient(service.buildWebViewClient(null));
webView.loadUrl("https://your-web-app.example.com");
```

## Important Constraints

- This is not a plain remote package URL. Consumers cannot use `implementation("https://github.com/...")`.
- Consumers must include the repo source in their Gradle build.
- Keep `addNativeRequestRule(...)` narrow. Only protect the API hosts and paths that actually need Approov.
- `fetch`/XHR/form traffic can be protected. Arbitrary browser-managed subresources such as every `<script>` or `<img>` request are not transparently rewritten by this library.

## Build

```bash
./gradlew assemble
./gradlew testDebugUnitTest
```
