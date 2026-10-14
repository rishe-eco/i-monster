// The bare page the e2e suite drives Edge's virtual authenticator through
// (plan B4a). It exists only under E2E_CLOCK=1, mounted by routes/test.ts. B4b
// builds the real sign-in and setup screens; this has no design on purpose.
//
// The script is served as a file of its own, not inlined, because the CSP
// forbids inline script (PD-18). It does what @simplewebauthn/browser will do
// in B4b: turn the server's JSON options into `navigator.credentials` calls and
// the browser's answer back into JSON. String.raw keeps the script's own
// backslashes and backticks out of this file's way.

export const AUTH_PAGE_HTML = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auth test page</title>
</head>
<body>
<main>
<h1>Auth test page</h1>
<p>For the end-to-end suite only. It exists only when E2E_CLOCK=1.</p>
<script src="/__test/auth.js"></script>
</main>
</body>
</html>
`;

export const AUTH_PAGE_JS = String.raw`'use strict';
// window.authTest: every call answers { status, json } of the last request it made.
(function () {
  var csrf = null;

  function toBuf(text) {
    var padded = text.split('-').join('+').split('_').join('/');
    while (padded.length % 4 !== 0) padded += '=';
    var bin = atob(padded);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function fromBuf(buffer) {
    var bin = '';
    var bytes = new Uint8Array(buffer);
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).split('+').join('-').split('/').join('_').split('=').join('');
  }

  async function api(method, path, body) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-CSRF-Token'] = csrf;
    var res = await fetch('/admin/api' + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    var text = await res.text();
    var json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
    if (json && typeof json.csrf === 'string') csrf = json.csrf;
    return { status: res.status, json: json };
  }

  async function create(options) {
    var publicKey = Object.assign({}, options, {
      challenge: toBuf(options.challenge),
      user: Object.assign({}, options.user, { id: toBuf(options.user.id) }),
      excludeCredentials: (options.excludeCredentials || []).map(function (c) {
        return Object.assign({}, c, { id: toBuf(c.id) });
      }),
    });
    var cred = await navigator.credentials.create({ publicKey: publicKey });
    var r = cred.response;
    return {
      id: cred.id,
      rawId: fromBuf(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: fromBuf(r.clientDataJSON),
        attestationObject: fromBuf(r.attestationObject),
        transports: r.getTransports ? r.getTransports() : [],
        authenticatorData: fromBuf(r.getAuthenticatorData()),
        publicKeyAlgorithm: r.getPublicKeyAlgorithm(),
        publicKey: fromBuf(r.getPublicKey()),
      },
    };
  }

  async function get(options) {
    var publicKey = Object.assign({}, options, {
      challenge: toBuf(options.challenge),
      allowCredentials: (options.allowCredentials || []).map(function (c) {
        return Object.assign({}, c, { id: toBuf(c.id) });
      }),
    });
    var cred = await navigator.credentials.get({ publicKey: publicKey });
    var r = cred.response;
    return {
      id: cred.id,
      rawId: fromBuf(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: fromBuf(r.clientDataJSON),
        authenticatorData: fromBuf(r.authenticatorData),
        signature: fromBuf(r.signature),
        userHandle: r.userHandle ? fromBuf(r.userHandle) : undefined,
      },
    };
  }

  // A ceremony is options, the browser's answer, then verify. A refused options call ends it there.
  async function ceremony(optionsPath, verifyPath, optionsBody, makeResponse, verifyBody) {
    var options = await api('POST', optionsPath, optionsBody);
    if (options.status !== 200) return options;
    var response = await makeResponse(options.json);
    return api('POST', verifyPath, Object.assign({ response: response }, verifyBody));
  }

  window.authTest = {
    api: api,
    session: function () {
      return api('GET', '/session');
    },
    signIn: function () {
      return ceremony('/auth/signin/options', '/auth/signin/verify', {}, get, {});
    },
    reauth: function () {
      return ceremony('/auth/reauth/options', '/auth/reauth/verify', {}, get, {});
    },
    // With a code: a setup token or an enrolment code. Without: from the signed-in session.
    register: function (name, code) {
      var withCode = code === undefined ? {} : { code: code };
      return ceremony('/auth/register/options', '/auth/register/verify', withCode, create, Object.assign({ name: name }, withCode));
    },
    signOut: function () {
      return api('POST', '/auth/signout', {});
    },
  };
})();
`;
