/* global Request, Response, Headers, URL */

(function () {
  // The bridge can be injected in two ways:
  // 1. Automatically at document-start by ApproovWebViewService on modern WebView builds.
  // 2. Manually through a script tag as a fallback.
  // Different features are installed independently so the manual script include can still attach
  // form listeners even if fetch/XHR wrapping already happened earlier.
  const bridgeState = window.__approovWebViewState || (window.__approovWebViewState = {});

  const BRIDGE_NAME = "ApproovNativeBridge";
  const bridgeConfig = window.__approovWebViewConfig || {};
  const nativeRequestRules = Array.isArray(bridgeConfig.nativeRequestRules)
    ? bridgeConfig.nativeRequestRules.filter(function (rule) {
      return rule && typeof rule.host === "string";
    })
    : [];
  const pendingRequests = bridgeState.pendingRequests || (bridgeState.pendingRequests = new Map());
  const originalFetch = bridgeState.originalFetch
    || (bridgeState.originalFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null);
  const OriginalXMLHttpRequest = bridgeState.originalXMLHttpRequest
    || (bridgeState.originalXMLHttpRequest = window.XMLHttpRequest);
  const OriginalHTMLFormElement = bridgeState.originalHTMLFormElement
    || (bridgeState.originalHTMLFormElement = window.HTMLFormElement);
  const originalRequestSubmit = bridgeState.originalRequestSubmit !== undefined
    ? bridgeState.originalRequestSubmit
    : (bridgeState.originalRequestSubmit = OriginalHTMLFormElement
      && typeof OriginalHTMLFormElement.prototype.requestSubmit === "function"
      ? OriginalHTMLFormElement.prototype.requestSubmit
      : null);
  const originalFormSubmit = bridgeState.originalFormSubmit !== undefined
    ? bridgeState.originalFormSubmit
    : (bridgeState.originalFormSubmit = OriginalHTMLFormElement
      && typeof OriginalHTMLFormElement.prototype.submit === "function"
      ? OriginalHTMLFormElement.prototype.submit
      : null);
  let requestCounter = typeof bridgeState.requestCounter === "number" ? bridgeState.requestCounter : 0;
  const FORM_SUBMISSION_LOCK = "__approovNativeFormPending";

  function nextRequestId() {
    requestCounter += 1;
    bridgeState.requestCounter = requestCounter;
    return "approov-" + Date.now() + "-" + requestCounter;
  }

  function getNativeBridge() {
    return window[BRIDGE_NAME] || null;
  }

  function resolveUrl(input) {
    if (typeof input === "string") {
      return new URL(input, window.location.href).toString();
    }

    if (typeof URL !== "undefined" && input instanceof URL) {
      return new URL(input.toString(), window.location.href).toString();
    }

    if (typeof Request === "function" && input instanceof Request) {
      return new URL(input.url, window.location.href).toString();
    }

    throw new Error("Unsupported request input type.");
  }

  function matchesNativeRequestRule(url) {
    if (nativeRequestRules.length === 0) {
      return true;
    }

    return nativeRequestRules.some(function (rule) {
      const rulePathPrefix = typeof rule.pathPrefix === "string" ? rule.pathPrefix : "";
      return typeof rule.host === "string"
        && rule.host.toLowerCase() === url.host.toLowerCase()
        && (rulePathPrefix === "" || url.pathname.indexOf(rulePathPrefix) === 0);
    });
  }

  function shouldRouteToNative(url) {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }

      return matchesNativeRequestRule(parsed);
    } catch (error) {
      return false;
    }
  }

  function copyFunctionProperties(target, source) {
    if (!source) {
      return;
    }

    Object.getOwnPropertyNames(source).forEach(function (name) {
      if (name === "length" || name === "name") {
        return;
      }

      try {
        Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name));
      } catch (error) {
        // Ignore read-only function properties from the platform implementation.
      }
    });

    try {
      Object.setPrototypeOf(target, Object.getPrototypeOf(source));
    } catch (error) {
      // Function prototype updates are a best-effort compatibility aid.
    }
  }

  function headersToObject(headersInit) {
    const normalizedHeaders = {};

    if (!headersInit) {
      return normalizedHeaders;
    }

    new Headers(headersInit).forEach(function (value, key) {
      normalizedHeaders[key] = value;
    });

    return normalizedHeaders;
  }

  function findHeaderValue(headersObject, name) {
    if (!headersObject) {
      return null;
    }

    return Object.keys(headersObject).find(function (headerName) {
      return headerName.toLowerCase() === name.toLowerCase();
    }) || null;
  }

  function isSelfTarget(target) {
    return !target || target === "_self";
  }

  function isFormElement(candidate) {
    return !!candidate
      && typeof candidate === "object"
      && String(candidate.tagName || "").toUpperCase() === "FORM";
  }

  function canSerializeForm(form) {
    return !Array.prototype.some.call(form.elements || [], function (element) {
      return element
        && element.tagName === "INPUT"
        && String(element.type || "").toLowerCase() === "file"
        && element.files
        && element.files.length > 0;
    });
  }

  function appendSubmitter(formData, submitter) {
    if (!submitter || !submitter.name) {
      return;
    }

    formData.append(submitter.name, submitter.value || "");
  }

  function serializeTextPlain(formData) {
    const lines = [];
    formData.forEach(function (value, key) {
      lines.push(key + "=" + value);
    });
    return lines.join("\r\n");
  }

  function normalizeFormMethod(form, submitter) {
    const method = ((submitter && submitter.formMethod) || form.method || "GET").toUpperCase();
    return method === "POST" ? "POST" : "GET";
  }

  function hasSupportedFormMethod(form, submitter) {
    const rawMethod = ((submitter && submitter.formMethod) || form.method || "GET").toUpperCase();
    return rawMethod === "GET" || rawMethod === "POST" || rawMethod === "";
  }

  function normalizeFormEnctype(form, submitter) {
    return ((submitter && submitter.formEnctype) || form.enctype || "application/x-www-form-urlencoded")
      .toLowerCase();
  }

  function buildFormRequest(form, submitter) {
    const action = resolveUrl((submitter && submitter.formAction) || form.action || window.location.href);
    const method = normalizeFormMethod(form, submitter);
    const enctype = normalizeFormEnctype(form, submitter);
    const formData = new FormData(form);
    const headers = {};

    appendSubmitter(formData, submitter);

    if (method === "GET") {
      const requestUrl = new URL(action);
      new URLSearchParams(formData).forEach(function (value, key) {
        requestUrl.searchParams.append(key, value);
      });

      return {
        body: null,
        headers: headers,
        method: "GET",
        url: requestUrl.toString()
      };
    }

    if (enctype === "text/plain") {
      headers["content-type"] = "text/plain;charset=UTF-8";
      return {
        body: serializeTextPlain(formData),
        headers: headers,
        method: method,
        url: action
      };
    }

    headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    return {
      body: new URLSearchParams(formData).toString(),
      headers: headers,
      method: method,
      url: action
    };
  }

  function shouldRouteFormToNative(form, submitter) {
    return evaluateFormRouting(form, submitter).shouldRoute;
  }

  function evaluateFormRouting(form, submitter) {
    if (!isFormElement(form)) {
      return {
        reason: "event target is not a form element",
        shouldRoute: false,
        url: window.location.href
      };
    }

    const enctype = normalizeFormEnctype(form, submitter);
    const target = (((submitter && submitter.formTarget) || form.target || "") + "").toLowerCase();
    if (
      !hasSupportedFormMethod(form, submitter)
      || !isSelfTarget(target)
      || enctype === "multipart/form-data"
      || !canSerializeForm(form)
    ) {
      let reason = "unsupported form configuration";
      if (!hasSupportedFormMethod(form, submitter)) {
        reason = "unsupported method " + (((submitter && submitter.formMethod) || form.method || "GET").toUpperCase());
      } else if (!isSelfTarget(target)) {
        reason = "unsupported target " + target;
      } else if (enctype === "multipart/form-data") {
        reason = "multipart/form-data requires browser networking";
      } else if (!canSerializeForm(form)) {
        reason = "file inputs require browser networking";
      }

      return {
        enctype: enctype,
        method: normalizeFormMethod(form, submitter),
        reason: reason,
        shouldRoute: false,
        url: resolveUrl((submitter && submitter.formAction) || form.action || window.location.href)
      };
    }

    const requestUrl = resolveUrl((submitter && submitter.formAction) || form.action || window.location.href);
    const method = normalizeFormMethod(form, submitter);
    if (!shouldRouteToNative(requestUrl)) {
      return {
        enctype: enctype,
        method: method,
        reason: "request URL does not match native request rules",
        shouldRoute: false,
        url: requestUrl
      };
    }

    return {
      enctype: enctype,
      method: method,
      reason: "matched native request rules",
      shouldRoute: true,
      url: requestUrl
    };
  }

  function logFormDecision(message, decision, source) {
    const prefix = source ? "[" + source + "] " : "";
    console.info(
      "Approov " + prefix + message
        + ": " + (decision.url || window.location.href)
        + " (" + (decision.method || "GET") + ", " + decision.reason + ")"
    );
  }

  function withNativeFormLock(form, action) {
    if (!form) {
      return false;
    }

    if (form[FORM_SUBMISSION_LOCK]) {
      return true;
    }

    form[FORM_SUBMISSION_LOCK] = true;
    Promise.resolve()
      .then(action)
      .finally(function () {
        try {
          delete form[FORM_SUBMISSION_LOCK];
        } catch (error) {
          form[FORM_SUBMISSION_LOCK] = false;
        }
      });
    return true;
  }

  function dispatchNativeFormSubmission(form, submitter, source) {
    const decision = evaluateFormRouting(form, submitter);
    if (!decision.shouldRoute) {
      logFormDecision("skipped native HTML form submission", decision, source);
      return false;
    }

    return withNativeFormLock(form, function () {
      logFormDecision("intercepting HTML form submission", decision, source);
      return submitFormThroughNative(form, submitter || null).catch(function (error) {
        console.error(
          "Approov native HTML form submission failed for " + (decision.url || window.location.href),
          error
        );
      });
    });
  }

  function getSubmitterFromTarget(target) {
    const candidate = target && typeof target.closest === "function"
      ? target.closest("button, input")
      : target;
    if (!candidate || !candidate.form) {
      return null;
    }

    const tagName = String(candidate.tagName || "").toUpperCase();
    const type = String(candidate.type || (tagName === "BUTTON" ? "submit" : "")).toLowerCase();
    if (tagName === "BUTTON" && (type === "" || type === "submit")) {
      return candidate;
    }

    if (tagName === "INPUT" && (type === "submit" || type === "image")) {
      return candidate;
    }

    return null;
  }

  function updateLocationForResponse(url) {
    if (!url) {
      return;
    }

    try {
      const nextUrl = new URL(url, window.location.href);
      if (nextUrl.origin === window.location.origin) {
        window.history.replaceState(null, "", nextUrl.toString());
      }
    } catch (error) {
      // Cross-origin history updates are not allowed; the response is still rendered below.
    }
  }

  function renderFormResponse(text, responseUrl) {
    updateLocationForResponse(responseUrl);
    document.open();
    document.write(text);
    document.close();
    installFormSupport();
  }

  function submitFormThroughNative(form, submitter) {
    const request = buildFormRequest(form, submitter);
    return performNativeRequest(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method
    }).then(function (response) {
      return response.text().then(function (text) {
        renderFormResponse(text, response.url || request.url);
        return response;
      });
    });
  }

  function buildResponseObject(result) {
    if (typeof Response === "function") {
      const response = new Response(result.bodyText || "", {
        headers: result.headers || {},
        status: result.status,
        statusText: result.statusText || ""
      });

      if (typeof Proxy === "function") {
        return new Proxy(response, {
          get: function (target, property) {
            if (property === "url") {
              return result.url || "";
            }

            if (property === "redirected") {
              return !!result.redirected;
            }

            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
      }

      try {
        Object.defineProperty(response, "url", {
          configurable: true,
          value: result.url || ""
        });
      } catch (error) {
        // Ignore if the platform does not allow overriding Response.url.
      }

      try {
        Object.defineProperty(response, "redirected", {
          configurable: true,
          value: !!result.redirected
        });
      } catch (error) {
        // Ignore if the platform does not allow overriding Response.redirected.
      }

      return response;
    }

    return {
      ok: !!result.ok,
      redirected: !!result.redirected,
      status: result.status,
      statusText: result.statusText || "",
      url: result.url || "",
      headers: result.headers || {},
      text: function () {
        return Promise.resolve(result.bodyText || "");
      },
      json: function () {
        return Promise.resolve(JSON.parse(result.bodyText || "null"));
      }
    };
  }

  function handleNativeReply(event) {
    let parsedEnvelope;

    try {
      parsedEnvelope = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    const pending = pendingRequests.get(parsedEnvelope.requestId);
    if (!pending) {
      return;
    }

    pendingRequests.delete(parsedEnvelope.requestId);

    if (parsedEnvelope.status === "success") {
      pending.resolve(buildResponseObject(parsedEnvelope.payload || {}));
      return;
    }

    const errorPayload = parsedEnvelope.error || {};
    const nativeError = new Error(errorPayload.message || "Native request failed.");
    nativeError.name = errorPayload.type || "NativeRequestError";
    pending.reject(nativeError);
  }

  async function buildNativePayload(input, init) {
    const request = new Request(input, init || {});
    const method = (request.method || "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD"
      ? null
      : await request.clone().text();

    return {
      body: body,
      headers: headersToObject(request.headers),
      method: method,
      pageUrl: window.location.href,
      requestId: nextRequestId(),
      url: resolveUrl(request)
    };
  }

  function performNativeRequest(input, init) {
    return buildNativePayload(input, init).then(function (payload) {
      return new Promise(function (resolve, reject) {
        const nativeBridge = getNativeBridge();
        if (!nativeBridge || typeof nativeBridge.postMessage !== "function") {
          reject(new Error("Approov native bridge is unavailable for this origin."));
          return;
        }

        pendingRequests.set(payload.requestId, {
          reject: reject,
          resolve: resolve
        });

        nativeBridge.postMessage(JSON.stringify(payload));
      });
    });
  }

  const nativeBridge = getNativeBridge();
  if (nativeBridge && typeof nativeBridge === "object") {
    nativeBridge.onmessage = handleNativeReply;
  } else {
    console.warn("Approov WebView bridge is not available. Network calls will fail.");
  }

  if (originalFetch && !window.fetch.__approovWrapped) {
    // This keeps page code simple. The page still writes normal fetch() calls, but the transport
    // path is replaced so native Android code can inject the Approov JWT and any extra secret headers.
    const wrappedFetch = function (input, init) {
      const url = resolveUrl(input);
      if (!shouldRouteToNative(url)) {
        return originalFetch(input, init);
      }

      return performNativeRequest(input, init);
    };

    wrappedFetch.__approovWrapped = true;
    copyFunctionProperties(wrappedFetch, originalFetch);
    window.fetch = wrappedFetch;
  }

  function handleSubmitEvent(event) {
    const form = isFormElement(event.target)
      ? event.target
      : (event.target && typeof event.target.closest === "function"
        ? event.target.closest("form")
        : null);
    if (event.defaultPrevented) {
      return;
    }

    if (dispatchNativeFormSubmission(form, event.submitter || null, "submit")) {
      event.preventDefault();
    }
  }

  function handleSubmitterClick(event) {
    if (event.defaultPrevented) {
      return;
    }

    const submitter = getSubmitterFromTarget(event.target);
    if (!submitter || !isFormElement(submitter.form)) {
      return;
    }

    if (dispatchNativeFormSubmission(submitter.form, submitter, "click")) {
      event.preventDefault();
    }
  }

  function installFormSupport() {
    if (!document) {
      return;
    }

    document.removeEventListener("submit", handleSubmitEvent, true);
    document.addEventListener("submit", handleSubmitEvent, true);
    document.removeEventListener("click", handleSubmitterClick, true);
    document.addEventListener("click", handleSubmitterClick, true);
  }

  installFormSupport();

  if (OriginalHTMLFormElement && originalFormSubmit) {
    OriginalHTMLFormElement.prototype.submit = function () {
      if (!dispatchNativeFormSubmission(this, null, "submit()")) {
        return originalFormSubmit.call(this);
      }
    };
  }

  if (OriginalHTMLFormElement && originalRequestSubmit) {
    OriginalHTMLFormElement.prototype.requestSubmit = function (submitter) {
      if (!dispatchNativeFormSubmission(this, submitter || null, "requestSubmit()")) {
        return originalRequestSubmit.call(this, submitter);
      }
    };
  }

  function NativeXMLHttpRequest() {
    this._delegate = null;
    this._headers = {};
    this._listeners = {};
    this._method = "GET";
    this._responseHeaders = {};
    this._url = "";
    this.readyState = NativeXMLHttpRequest.UNSENT;
    this.response = "";
    this.responseText = "";
    this.responseType = "";
    this.responseURL = "";
    this.status = 0;
    this.statusText = "";
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this.onloadend = null;
  }

  NativeXMLHttpRequest.UNSENT = 0;
  NativeXMLHttpRequest.OPENED = 1;
  NativeXMLHttpRequest.HEADERS_RECEIVED = 2;
  NativeXMLHttpRequest.LOADING = 3;
  NativeXMLHttpRequest.DONE = 4;

  NativeXMLHttpRequest.prototype.addEventListener = function (type, listener) {
    if (!this._listeners[type]) {
      this._listeners[type] = [];
    }

    this._listeners[type].push(listener);
  };

  NativeXMLHttpRequest.prototype.removeEventListener = function (type, listener) {
    if (!this._listeners[type]) {
      return;
    }

    this._listeners[type] = this._listeners[type].filter(function (candidate) {
      return candidate !== listener;
    });
  };

  NativeXMLHttpRequest.prototype._emit = function (type) {
    if (typeof this["on" + type] === "function") {
      this["on" + type].call(this);
    }

    (this._listeners[type] || []).forEach(function (listener) {
      listener.call(this);
    }, this);
  };

  NativeXMLHttpRequest.prototype._syncFromDelegate = function () {
    if (!this._delegate) {
      return;
    }

    this.readyState = this._delegate.readyState;
    this.response = this._delegate.response;
    this.responseText = this._delegate.responseText;
    this.responseURL = this._delegate.responseURL;
    this.status = this._delegate.status;
    this.statusText = this._delegate.statusText;
  };

  NativeXMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    const resolvedUrl = new URL(url, window.location.href).toString();
    this._method = (method || "GET").toUpperCase();
    this._url = resolvedUrl;

    if (async === false) {
      throw new Error("Synchronous XMLHttpRequest is not supported by the Approov bridge.");
    }

    if (!shouldRouteToNative(resolvedUrl)) {
      this._delegate = new OriginalXMLHttpRequest();
      this._delegate.responseType = this.responseType;

      ["readystatechange", "load", "error", "loadend", "abort", "timeout"].forEach(function (eventName) {
        this._delegate.addEventListener(eventName, function () {
          this._syncFromDelegate();
          this._emit(eventName);
        }.bind(this));
      }, this);

      this._delegate.open(method, url, async, user, password);
      return;
    }

    this._delegate = null;
    this._headers = {};
    this.readyState = NativeXMLHttpRequest.OPENED;
    this._emit("readystatechange");
  };

  NativeXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._delegate) {
      this._delegate.setRequestHeader(name, value);
      return;
    }

    this._headers[name] = value;
  };

  NativeXMLHttpRequest.prototype.send = function (body) {
    if (this._delegate) {
      this._delegate.send(body);
      return;
    }

    performNativeRequest(this._url, {
      body: body,
      headers: this._headers,
      method: this._method
    }).then(function (response) {
      return response.text().then(function (responseText) {
        this.readyState = NativeXMLHttpRequest.DONE;
        this.status = response.status;
        this.statusText = response.statusText;
        this.response = responseText;
        this.responseText = responseText;
        this.responseURL = response.url || this._url;
        this._responseHeaders = {};

        if (typeof response.headers.forEach === "function") {
          response.headers.forEach(function (value, key) {
            this._responseHeaders[key] = value;
          }, this);
        } else {
          this._responseHeaders = response.headers || {};
        }

        this._emit("readystatechange");
        this._emit("load");
        this._emit("loadend");
      }.bind(this));
    }.bind(this)).catch(function (error) {
      this.readyState = NativeXMLHttpRequest.DONE;
      this.status = 0;
      this.statusText = error.message;
      this.response = "";
      this.responseText = "";
      this._emit("readystatechange");
      this._emit("error");
      this._emit("loadend");
    }.bind(this));
  };

  NativeXMLHttpRequest.prototype.abort = function () {
    if (this._delegate) {
      this._delegate.abort();
      return;
    }

    this.status = 0;
    this.statusText = "aborted";
    this.readyState = NativeXMLHttpRequest.DONE;
    this._emit("readystatechange");
    this._emit("abort");
    this._emit("loadend");
  };

  NativeXMLHttpRequest.prototype.getAllResponseHeaders = function () {
    if (this._delegate) {
      return this._delegate.getAllResponseHeaders();
    }

    return Object.keys(this._responseHeaders).map(function (name) {
      return name + ": " + this._responseHeaders[name];
    }, this).join("\r\n");
  };

  NativeXMLHttpRequest.prototype.getResponseHeader = function (name) {
    if (this._delegate) {
      return this._delegate.getResponseHeader(name);
    }

    const headerName = findHeaderValue(this._responseHeaders, name);
    return headerName ? this._responseHeaders[headerName] : null;
  };

  if (!window.XMLHttpRequest || !window.XMLHttpRequest.__approovWrapped) {
    NativeXMLHttpRequest.__approovWrapped = true;
    window.XMLHttpRequest = NativeXMLHttpRequest;
  }
})();
