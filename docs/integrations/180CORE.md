# 180 Core integration spec (180 Identity login + 180 Pay checkout)

Researched 2026-11-23 from public sources only:
- the browser SDK `https://profile.180core.cloud/sdk/v1/180-core-sdk.js` (v`1.0.0-sovereign`, unminified),
- the `@workspace/identity-sdk` source that the developer docs bundle ships (it is not on npm) (chunk `4575-*.js`),
- the hosted login and checkout apps on `profile.180core.cloud` (chunks `3102-*`, `248-*`, `auth/login/page-*`),
- the developer portal and the 180core.cloud product pages (chunks `706-*`, dashboard `3364-*`),
- unauthenticated GETs against `api.180core.cloud`.

Labels used below: **[confirmed]** means read in shipped code or seen in a live response. **[docs-only]** means it appears only in marketing or docs samples. **[unconfirmed]** means it could not be tested without credentials or a real payment.

> **Two blockers to clear first, both [confirmed] live on 2026-11-23:**
> 1. **180 Identity is disabled for our app.** `GET https://api.180core.cloud/api/oauth/authorize/validate?client_id=180_client_805393dc46af69a611bee40852e11c46` returns `403 {"error":"unauthorized_client","error_description":"180 Identity Authentication is disabled for application 'Vaishora'.","details":{"type":"AUTH_DISABLED",...,"hint":"Enable 180 Identity in the application settings under 180 Developer Portal."}}`. Turn it on in developer.180core.cloud → project → 180 Identity.
> 2. **180 Pay hosted checkout is in maintenance mode.** The page served at `https://profile.180core.cloud/checkout/<id>` renders "Maintenance Lock Active / 180 Pay Under Scheduled Maintenance … Payment checkouts, UPI captures, and automated debits are temporarily locked". The code is `em="false"!==process.env.NEXT_PUBLIC_MAINTENANCE_MODE`. Their own `?bypass=1` / `?admin=1` query flag skips the screen, but it is meant for internal use, so do not depend on it. Until 180 lifts the lock, keep the existing Razorpay path as the fallback.

---

## 0. Hosts, origins and configuration

| Purpose | URL |
|---|---|
| Browser SDK (CDN) | `https://profile.180core.cloud/sdk/v1/180-core-sdk.js`. The header comment also lists `https://api.180core.cloud/sdk/v1/180-core-sdk.js`. Responds with `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=14400`. There is no versioned or SRI-pinned build. |
| Hosted UI (inside the iframe) | `https://profile.180core.cloud` (`/auth/login`, `/checkout/{sessionId}`). Sends `content-security-policy: frame-ancestors *`, so it can be framed from any origin. |
| REST API | `https://api.180core.cloud` |
| OIDC discovery | `https://api.180core.cloud/.well-known/openid-configuration` (also served on profile.180core.cloud) |
| JWKS | `https://api.180core.cloud/certs/jwks.json`. The same keyset is at `/.well-known/jwks.json` and `/api/oauth/jwks.json`: one RSA key, `kid: "180-identity-2026-v1"`, `alg: RS256`. |

**CSP for our Next.js app.** We currently send no CSP that blocks these. If we add one, it needs:
- `script-src https://profile.180core.cloud`
- `frame-src https://profile.180core.cloud`
- `connect-src https://api.180core.cloud` (only if the browser calls the API, for example during SDK prefetch)

The checkout iframe loads `checkout.razorpay.com` inside its own document, so our page's CSP does not need it. The iframe is created with `allow="clipboard-write; payment; geolocation"`.

**postMessage.** The hosted pages post every message with `targetOrigin "*"` to `window.parent` and `window.opener`. **[confirmed]**
- The CDN SDK listener does **not** check `event.origin` or `event.source`. **[confirmed]** (`openAdaptiveModal` → `onMessage`)
- If we write our own listener, it must require `event.origin === "https://profile.180core.cloud"` and `event.source === iframe.contentWindow`.
- Because the SDK accepts messages from any origin, treat every browser-side result as untrusted. Verify everything on the server.

**Developer-portal settings to configure:**
- Allowed Web Origins: `http://localhost:3000` (already allowed: `GET /api/oauth/bootstrap?...&origin=http://localhost:3000` returns `"isOriginAllowed": true`) and the production origin.
- Redirect URIs: `<origin>/oauth/callback`, which is the SDK default.
- Webhook URL.
- Enable 180 Identity and enable 180 Pay.
- The project logo is currently a **1.7 MB data-URL**, returned on every app-config fetch. Replace it with a small hosted image.

How the hosted login decides the merchant origin [confirmed]:
1. the `origin` query parameter, if present;
2. otherwise `document.referrer`'s origin;
3. otherwise the origin of `redirect_uri`.

So do not set `Referrer-Policy: no-referrer` on pages that open the sheet.

Credentials issued by the portal (the portal's download writes these names as `180_CLIENT_ID`, `180_CLIENT_SECRET`, `180_WEBHOOK_SECRET`):

```
ONE_EIGHTY_CLIENT_ID=180_client_805393dc46af69a611bee40852e11c46   # public
ONE_EIGHTY_CLIENT_SECRET=<client secret>                            # server only
ONE_EIGHTY_WEBHOOK_SECRET=whsec_<...>                               # server only, separate from the client secret
```

Env names cannot start with a digit, so use `ONE_EIGHTY_*`, which is what 180's own samples use.

---

## 1. Loading the SDK without npm

```html
<script src="https://profile.180core.cloud/sdk/v1/180-core-sdk.js" async></script>
```

In Next.js 16, use `next/script` with `strategy="afterInteractive"` in the component that needs it.

**Globals set by the CDN script** [confirmed]:

```js
global.OneEighty = OneEighty;          // root: { version, init, auth, pay, verify, ui, webhooks, signIn, signOut, getUser, getAccessToken, checkout, openModal, ... }
global.OneEightyCore = OneEighty;      // alias (NOT a server class)
global.OneEightyIdentity = OneEightyAuth;
global.OneEightyAuth = OneEightyAuth;  // { signIn, signOut, getUser, getAccessToken, openBottomSheet, openPopup, openAuthModal, openLoginPopup }
global.OneEightyPay = OneEightyPay;    // { checkout, openBottomSheet, openPopup, openFullPage, openCheckoutModal, webhooks }
global.OneEightyVerify = OneEightyVerify;
window.__180_SDK_LOADED = window.__180_LOADED = true;
window.on180Ready(cb)                  // also drains window.__180_QUEUE / __180_READY_QUEUE
// events: window 'CustomEvent("180:ready")' and Event('180_READY')
```

It also registers the custom elements `<one-eighty-auth-button>`, `<one-eighty-identity-button>`, `<one-eighty-pay-button>` and `<one-eighty-pricing-table>`.

**Client id.**
- `OneEighty.init({ clientId })` sets `_config.clientId`. **Only Pay and Verify read it.**
- CDN `signIn` uses `options.clientId || '180-core-client'` and ignores `init()` and `window.__180_CLIENT_ID`. **Always pass `clientId` explicitly to both calls.**
- The npm-style SDK resolves `opts.clientId || window.__180_CLIENT_ID || process.env.NEXT_PUBLIC_CORE_CLIENT_ID || DEFAULT_PLATFORM_CLIENT_ID ("180_client_2d51a605038c38ffb6fa037688988a83" = 180 Core's own app)`. A missing id therefore silently logs users into **180's** app.

**Environment** (CDN `resolveEnvironmentMode`): defaults to `'production'`. It switches to `'development'` (pointing at `http://localhost:3009` / `:4003`) only when one of these is true:
- `environment: 'development' | 'local_monorepo'` is passed;
- `window.__180_INTERNAL_DEV__ === true`;
- `window.__180_ENV__ === 'development'`;
- `process.env.ONE_EIGHTY_ENV === 'development'`.

**Never set those.** Pass `environment: 'production'` explicitly, because the npm build treats any `http:` or localhost page as "development".

---

## 2. 180 Identity (login bottom sheet)

### 2.1 Browser call (CDN)

```ts
const result = await window.OneEightyIdentity.signIn({
  clientId: process.env.NEXT_PUBLIC_ONE_EIGHTY_CLIENT_ID,          // required in practice
  redirectUri: `${location.origin}/oauth/callback`,                  // default; must be registered
  scope: 'openid identity:read identity:email identity:phone',       // default 'openid identity:read identity:email'
  state: crypto.randomUUID(),                                        // default random 16 chars
  environment: 'production',
  uxMode: 'bottom_sheet',                                            // only value that matters; popup aliases also use bottom_sheet
  authServerUrl: undefined,                                          // override host (don't)
  onSuccess(r) {}, onError(err) {}, onCancel() {},
});
// resolves the mapped result on success, null on cancel/close; rejects Error{code,hint} on 180_*_ERROR
```

The SDK opens an iframe at:

```
https://profile.180core.cloud/auth/login?client_id=…&redirect_uri=…&response_type=code&scope=…&state=…
  &code_challenge=<S256>&code_challenge_method=S256&ux_mode=bottom_sheet&env=production&app=auth
```

**PKCE problem** [confirmed]:
- The CDN `signIn` generates a PKCE pair and sends `code_challenge`, **but never returns or stores the `verifier`**.
- If the token endpoint enforces PKCE for codes issued with a challenge, a code obtained through CDN `signIn` **cannot be exchanged** [unconfirmed whether it is enforced].
- The npm `openAuth` sends **no** `code_challenge` at all, so its codes are exchanged with only the client secret.

**Recommendation:** use the small first-party launcher in section 2.5, which owns the PKCE verifier and checks the message origin. Use CDN `signIn` only for a quick prototype.

### 2.2 Success result

The hosted page posts `type:'180_IDENTITY_SUCCESS'`, and the same payload again as `'180_AUTH_SUCCESS'`. The raw message [confirmed, `3102-*.js`]:

```js
{ type, code, token, accessToken, refreshToken, refresh_token, authToken, id_token, state,
  user: { id, email, name, username, phone, avatar, avatarUrl, picture, avatar_url, headline, tagline, bio,
          languages, gender, dob, age, address, city, country, role, isVerified, isOnboarded,
          isEmailVerified, isPhoneVerified, securityPreferences } }
```

- `code` and `id_token` come from `POST /api/oauth/authorize/consent` (`t.code`, `t.id_token || t.credential`). They can be empty if the consent response lacks them.
- `token`, `accessToken` and `authToken` are the **user's 180 platform session token** (`platform_auth_token`). That token is not bound to our app.

The CDN SDK maps this message to:

```js
{ code, token, accessToken, idToken: data.id_token, state, user }
```

It also writes `localStorage` keys `platform_auth_token`, `180_access_token` and `180_user`. The npm build additionally sets a `platform_auth_token` cookie on our origin. With our own launcher we can avoid persisting these.

The `user` object is **unsigned client data**. Use it only to pre-fill forms. Never use it to authenticate.

On error, the message is `{type:'180_IDENTITY_ERROR', error, error_description, details}`. Close messages are `180_IDENTITY_CLOSE` and `180_MODAL_CLOSE`.

### 2.3 Server verification (pick one; both are audience-bound)

**A. Code exchange.** Preferred: it gives tokens and needs our client secret.

```ts
// POST https://api.180core.cloud/api/oauth/token   (JSON body, as sent by TokenExchangeClient)
const r = await fetch('https://api.180core.cloud/api/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    client_id: process.env.ONE_EIGHTY_CLIENT_ID,
    client_secret: process.env.ONE_EIGHTY_CLIENT_SECRET,   // discovery also lists client_secret_basic
    code, redirect_uri: REDIRECT_URI,                       // must equal the one used to open the sheet
    code_verifier,                                          // only if we sent a code_challenge
  }),
});
if (!r.ok) throw new Error((await r.json()).error_description);
const tokens = await r.json(); // expected { access_token, id_token?, refresh_token?, expires_in, token_type } [unconfirmed shape]
```

- Refresh uses the same endpoint: `{grant_type:'refresh_token', client_id, client_secret, refresh_token, scope?}`.
- Revoke: `https://api.180core.cloud/api/oauth/revoke`.
- Access-token lifetime is set per app in the portal (default 15 min). Refresh-token retention defaults to 7 days.

**B. Verify the `id_token` with JWKS** (as the SDK's `JwksVerifier` does):
- `algorithms: ['RS256']`;
- look the key up by `kid` in `https://api.180core.cloud/certs/jwks.json` (cache for 1 h);
- check `issuer: 'https://profile.180core.cloud'` (from discovery);
- check `audience: <our client_id>` [audience value unconfirmed];
- discovery also advertises `HS256`, so **pin RS256**;
- the hosted page reads a `nonce` param, but the SDK never sends one. If we build the URL ourselves, add `nonce` and check it.

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://api.180core.cloud/certs/jwks.json'));
const { payload } = await jwtVerify(idToken, JWKS, {
  algorithms: ['RS256'], issuer: 'https://profile.180core.cloud', audience: process.env.ONE_EIGHTY_CLIENT_ID,
});
const userId = payload.sub;
```

**Do not** log users in by calling userinfo with the posted platform `token`. Any other 180-integrated app receives the same kind of token and could replay it against us.

### 2.4 Userinfo, scopes and claims

- `GET https://api.180core.cloud/api/oauth/userinfo` with `Authorization: Bearer <access_token>`. Without a token it returns `401 {"success":false,"error":"Authentication token required"}`.
- The body may be flat claims or `{ user: {...} }`; 180's own code handles both (`e.user || e`) [unconfirmed shape].
- `scopes_supported`: `openid identity:read identity:email identity:phone pitch:read pitch:write messages:send`.
- `claims_supported`: `sub iss aud exp iat name given_name family_name username email email_verified phone picture avatarUrl headline age isOnboarded location`.

So **name, email and phone can be requested from 180** (`identity:read`, `identity:email`, `identity:phone`). **Gender and address are not OIDC claims.** They only appear in the unsigned postMessage `user` object, so Vaishora must collect gender and address itself, or treat the posted values as unverified pre-fill.

Phone sign-up is not available today. The bootstrap response shows `enableWhatsappAuth:false, enableSmsAuth:false`, and the login page says "Mobile verification is currently unavailable". Methods enabled for our app: Google, LinkedIn, GitHub, email.

### 2.5 Recommended first-party launcher (browser)

```ts
// Opens the hosted login in an iframe; we own PKCE + origin checks. Server exchanges the code.
export async function open180Login(opts: { clientId: string; redirectUri: string; scope?: string }) {
  const { verifier, challenge } = await pkce();              // S256, base64url
  const state = crypto.randomUUID();
  sessionStorage.setItem('180_pkce', JSON.stringify({ verifier, state }));
  const u = new URL('https://profile.180core.cloud/auth/login');
  Object.entries({ client_id: opts.clientId, redirect_uri: opts.redirectUri, response_type: 'code',
    scope: opts.scope ?? 'openid identity:read identity:email identity:phone', state,
    code_challenge: challenge, code_challenge_method: 'S256', ux_mode: 'bottom_sheet',
    env: 'production', app: 'auth', origin: location.origin }).forEach(([k, v]) => u.searchParams.set(k, v));
  const iframe = document.createElement('iframe');
  iframe.src = u.toString(); iframe.allow = 'clipboard-write; payment';
  /* ...mount inside our own bottom-sheet UI... */
  return new Promise<{ code: string; idToken: string | null } | null>((resolve, reject) => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== 'https://profile.180core.cloud' || e.source !== iframe.contentWindow) return;
      const d = typeof e.data === 'string' ? safeJson(e.data) : e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === '180_IDENTITY_SUCCESS') {
        if (d.state !== state) return reject(new Error('state mismatch'));
        cleanup(); resolve({ code: d.code, idToken: d.id_token ?? null });   // ignore d.token / d.user
      } else if (d.type === '180_IDENTITY_ERROR') { cleanup(); reject(Object.assign(new Error(d.error_description), d)); }
      else if (d.type === '180_IDENTITY_CLOSE' || d.type === '180_MODAL_CLOSE') { cleanup(); resolve(null); }
    }
    function cleanup() { window.removeEventListener('message', onMsg); iframe.remove(); }
    window.addEventListener('message', onMsg);
  });
}
// then POST { code, idToken } to our /api/auth/180 route; server sends code + code_verifier to /api/oauth/token.
```

The verifier can stay in the browser and be sent with the code to our own server. Alternatively, keep it server-side keyed by `state`.

---

## 3. 180 Pay (checkout bottom sheet)

### 3.1 Browser call (CDN)

```ts
const res = await window.OneEightyPay.checkout({
  clientId: process.env.NEXT_PUBLIC_ONE_EIGHTY_CLIENT_ID,  // or OneEighty.init({clientId}) once
  amount: 2499,              // WHOLE currency units: 2499 = ₹2,499 (NOT paise)
  currency: 'INR',           // uppercased; CDN defaults to 'USD' if omitted, so always pass it
  title: 'Bridal mehndi booking',
  description: 'Deposit for booking VSH-1234', // must NOT contain "sandbox"/"demo"
  orderId: booking.id,       // sent as order_id & orderId
  metadata: { bookingId: booking.id },          // JSON-stringified into the URL
  customerEmail, customerPhone,                 // prefill (email also used for coupons)
  returnUrl, cancelUrl,      // optional; checkout appends session_id, payment_id, transaction_id, order_id, amount, currency, status
  couponCode: undefined, planCode: undefined, appId: undefined, appName: undefined,
  sessionId: undefined,      // pass a server-created session id if we create one (3.3)
  environment: 'production',
  payServerUrl: undefined,   // npm build calls it checkoutServerUrl; don't override
  onSuccess(r) {}, onError(err) {}, onCancel() {},
});
```

**Amount units.** Whole units. Evidence:
- product page: "1. Whole Currency Units (Not Paise / Cents) … Pass `amount=499` for ₹499 INR";
- checkout uses `parseFloat(amount)`;
- the server returns `amountPaise` separately for Razorpay.

**Session id.** Generated in the browser when none is passed:
- CDN: `cs_<24 chars>` in production, or `sess_sandbox_<16>` when sandbox (see 3.2);
- npm build: `sess_<rand>_<ms>`.

**What the iframe does:**
1. Loads `https://profile.180core.cloud/checkout/{sessionId}?amount=…&currency=…&title=…&order_id=…&orderId=…&description=…&customerEmail=…&customer_email=…&customerPhone=…&client_id=…&clientId=…&metadata=…&app=pay&ux_mode=bottom_sheet&env=production`.
2. Calls `GET /api/oauth/checkout/sessions/{id}?<same query>`, which **auto-creates the session from those query params** [confirmed: an unknown id comes back with `metadata.source:"AUTO_RESOLVED_CLIENT_SDK","autoCreated":true`, expiry 1 h].
3. Calls `POST /api/v1/checkout/sessions/{id}/direct-order` and opens Razorpay.
4. Calls `/direct-verify` and `/status`.

**Consequence:** amount, currency and orderId are **client-controlled** unless the session is created on the server first. The payer can also change country or currency in the sheet; the paid amount is then FX-converted (`amount`/`currency` in the success message are the converted figures).

**Result:**
- CDN resolves `{ sessionId, transactionId, amount, currency, status:'completed', isFree }` on success. `transactionId` is the Razorpay `payment_id`, or `tx_free_*` for free orders.
- Cancel or close resolves `null` and calls `onCancel`.
- A `180_PAY_ERROR` / `180_PAYMENT_ERROR` message rejects with `Error{code,hint}` and calls `onError`.
- The npm build instead resolves a default object `{sessionId, transactionId: undefined, amount, currency, isFree:false}` on cancel **and** on error.
- Raw messages: `180_PAYMENT_SUCCESS` / `180_PAY_SUCCESS` (`{sessionId, transactionId, amount, currency, status:'success', returnUrl, creditedUserBalance}`), followed by `180_PAYMENT_CLOSE` / `180_PAY_CLOSE` (`{success:true, transactionId}`). Cancel sends `180_PAYMENT_CLOSE` (`error:'SESSION_CANCELLED'`), `180_PAY_CLOSE` and `180_PAYMENT_CANCEL`. Also `180_COUPON_APPLIED` / `180_COUPON_REMOVED`, and `180_MODAL_LOCK_CLOSE` when our origin is not whitelisted.

**The browser result is never proof of payment.** Confirm on the server (3.4 / section 4).

### 3.2 Test mode

There is no merchant test-mode switch or test key in any shipped code.
- The SDK labels a checkout "sandbox" when `environment !== 'production'`, or the description contains `sandbox`/`demo`, or the title contains `sandbox` (npm also: `demo`). It then uses id prefix `sess_sandbox_`.
- The checkout page only skips pre-warming the Razorpay order for `sess_sandbox_` / `sess_demo_` ids, and tells developers "For local sandbox testing, ensure your session prefix starts with sess_sandbox_".
- Whether sandbox sessions use Razorpay test keys or simulate success on the server is **[unconfirmed]**.
- **Server-side: always reject `sess_sandbox_*`, `sess_demo_*` and `sess_dev_*` ids for real bookings.** Keep the words "sandbox" and "demo" out of production titles and descriptions.

### 3.3 Server step before checkout (documented, unverified)

The 180 Pay product page documents this [docs-only, endpoint not testable without a secret]:

```ts
// POST https://api.180core.cloud/api/v1/pay/checkout-session
const r = await fetch('https://api.180core.cloud/api/v1/pay/checkout-session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ONE_EIGHTY_CLIENT_SECRET}` },
  body: JSON.stringify({
    client_id: process.env.ONE_EIGHTY_CLIENT_ID, client_secret: process.env.ONE_EIGHTY_CLIENT_SECRET,
    amount: 2499, currency: 'INR', title: 'Bridal mehndi booking', order_id: booking.id,
    return_url: 'https://<site>/booking/confirmed',
  }),
});
const { sessionId, checkoutUrl } = await r.json();   // then OneEightyPay.checkout({ sessionId, ... same amount ... })
```

The product page says "Your server creates a checkout session" in step 1. Whether the iframe's GET then keeps the server-stored amount or overwrites it with the query is **[unconfirmed]**. Pass identical values either way.

### 3.4 Server verification (works today, no auth)

| Call | Response [confirmed] |
|---|---|
| `GET https://api.180core.cloud/api/v1/checkout/sessions/{id}/status` | `{"success":true,"status":"PENDING","isPaid":false,"returnUrl":""}`. Paid is `status:"CAPTURED"` or `"COMPLETED"` or `isPaid:true`, plus `transactionId` and `fulfillment`. |
| `GET https://api.180core.cloud/api/v1/checkout/sessions/{id}` | `{success, session:{id, appId, userId, amount, currency, status, title, description, displayMode, returnUrl, cancelUrl, mode, planId, couponCode, discountAmount, originalAmount, country, metadata, expiresAt, completedAt, createdAt, updatedAt, app:{id, clientId, name, allowedOrigins, redirectUris, customGateway*…}, isExpired}, data:<same>}` |

Warnings about the second call:
- It **auto-creates a session for an unknown id**, so only call it with ids we stored ourselves.
- It is **public** and leaks app config: origins, redirect URIs, and `customGatewaySecret` / `customGatewayWebhookSecret` fields (null for 180's app). **Do not configure a bring-your-own Razorpay secret in 180** until 180 fixes this.

Fulfilment check on our server:

```ts
async function confirm180Payment(sessionId: string, booking: { id: string; amountInr: number }) {
  if (/^(sess_sandbox_|sess_demo_|sess_dev_)/.test(sessionId)) throw new Error('sandbox session');
  const s = await (await fetch(`https://api.180core.cloud/api/v1/checkout/sessions/${encodeURIComponent(sessionId)}`)).json();
  const sess = s.session ?? s.data;
  const paid = ['CAPTURED', 'COMPLETED'].includes(sess?.status);
  const ours = sess?.app?.clientId === process.env.ONE_EIGHTY_CLIENT_ID;
  const amountOk = Number(sess?.originalAmount ?? sess?.amount) === booking.amountInr && sess?.currency === 'INR';
  const orderOk = !sess?.metadata?.orderId || sess.metadata.orderId === booking.id; // storage of orderId unconfirmed
  if (!(paid && ours && amountOk && orderOk)) throw new Error('payment not verified');
  return { transactionId: sess.metadata?.transactionId, completedAt: sess.completedAt };
}
```

Store `sessionId` against the booking **before** opening checkout, and pass `orderId` / `metadata.bookingId`. Pair this check with the webhook in section 4. There is no authenticated transaction lookup, so this is defence in depth, not proof against a determined attacker.

Not found anywhere (no SDK method, endpoint or docs): **refund API, transaction-by-id API, order lookup**. `GET /api/v1/transactions/*`, `/api/v1/payments/*` and `/api/v1/refunds` all return 404. Do refunds by hand in the 180 dashboard, which shows "Incoming Transaction Receipts" and payouts.

---

## 4. Webhooks

Configure them in the portal under project → 180 Pay → "Overview & Webhook": "Payment Webhook Destination URL" and "Webhook Signing Secret `whsec_…`" (auto-generated, rotatable). There is also a "Send Test Ping" button. No API exists to register webhooks.

**Signature check** [confirmed, `Sovereign180Pay.verifyWebhookDetailed`]:
- Headers: `x-180-signature` (also accepts `X-180-Signature`, `x_180_signature`) and `x-180-timestamp`.
- The signature may also be `t=<ts>,v1=<hex>`; then `t` is the timestamp and `v1` the signature.
- Algorithm: HMAC-SHA256, **hex** digest, constant-time compare.
- With a timestamp: the timestamp must be within **300 s** (seconds; otherwise it fails with `TIMESTAMP_EXPIRED`). Pre-image is `` `${timestamp}.${rawBody}` ``. If that does not match, the SDK also tries the bare `rawBody`.
- Without a timestamp: pre-image is `rawBody` only.
- Secret: the webhook signing secret (`ONE_EIGHTY_WEBHOOK_SECRET`, `whsec_…`). The `Sovereign180PayClient` helper falls back to the client secret only when no secret is passed. Keep the client secret as a second candidate until confirmed.
- Hash the **raw body**, never `JSON.stringify(req.body)`.

**Events and payload** [docs/simulator only, unconfirmed against a real delivery]:
- Event name: `payment.captured` (portal simulator default, product-page sample: `if (event.event === 'payment.captured') … event.data?.orderId`). The docs page sample reads `event.type` instead, so read `body.event ?? body.type`.
- Simulator body: `{ event, timestamp: ISO, id: 'evt_<ms>', data: { app_id, client_id, status: 'success', amount: 49900, currency: 'INR', customer: { id, name } } }`. Its `amount: 49900` looks like paise, which conflicts with the whole-units rule, so do not trust the webhook amount. Re-check with 3.4.
- The simulator's sample header uses `t=<Date.now() ms>`. Accept millisecond timestamps by normalising.
- No failed, refunded or subscription event names exist in any bundle.

Next.js 16 route handler (`app/api/webhooks/180/route.ts`):

```ts
import crypto from 'node:crypto';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const raw = await req.text();                                  // raw body, unparsed
  let sig = req.headers.get('x-180-signature') ?? '';
  let ts = req.headers.get('x-180-timestamp') ?? '';
  if (sig.includes('t=') && sig.includes('v1=')) {
    for (const p of sig.split(',').map(s => s.trim())) {
      if (p.startsWith('t=') && !ts) ts = p.slice(2);
      if (p.startsWith('v1=')) sig = p.slice(3);
    }
  }
  const secrets = [process.env.ONE_EIGHTY_WEBHOOK_SECRET, process.env.ONE_EIGHTY_CLIENT_SECRET].filter(Boolean) as string[];
  const hmac = (k: string, s: string) => crypto.createHmac('sha256', k).update(s).digest('hex');
  const eq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  let ok = false;
  if (ts) {
    let t = Number(ts); if (t > 1e12) t = Math.floor(t / 1000);
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return new Response('stale', { status: 401 });
    ok = secrets.some(k => eq(hmac(k, `${ts}.${raw}`), sig.trim()) || eq(hmac(k, raw), sig.trim()));
  } else {
    ok = secrets.some(k => eq(hmac(k, raw), sig.trim()));
  }
  if (!ok) return new Response('bad signature', { status: 401 });

  const evt = JSON.parse(raw);
  const type = evt.event ?? evt.type;
  // idempotency: store evt.id; ignore repeats
  if (type === 'payment.captured') {
    // find booking by evt.data.orderId / evt.data.sessionId / metadata; then confirm180Payment(sessionId, booking)
  }
  return Response.json({ received: true });
}
```

---

## 5. Server SDK classes, as plain fetch

`Sovereign180PayClient({ clientId, clientSecret, baseUrl = 'https://api.180core.cloud' })` and the static `Sovereign180Pay` [confirmed source]:

| SDK method | HTTP call |
|---|---|
| `Sovereign180Pay.verifyWebhookDetailed / verifyWebhookSignature / constructEvent(raw, sig, secret, ts, tol=300) / createWebhookMiddleware` | Local HMAC only (section 4). |
| `client.webhooks.*` | Same, with secret defaulting to `clientSecret`. |
| `client.coupons.validate(body)` | `POST /api/v1/coupons/validate`, JSON `body` passed through, optional `Origin` header. No auth. Body fields undocumented. |
| `client.paymentLinks.create(appId, body, bearer)` | `POST /api/v1/payment-links/apps/{appId}`, `Authorization: Bearer <developer platform token>` (not the client secret). |
| `client.paymentLinks.getPublic(id)` | `GET /api/v1/payment-links/public/{id}` |
| `client.portal.createSession(body)` / `getData(token)` | `POST /api/v1/portal/sessions` / `GET /api/v1/portal/data?token=` |
| `client.agents.purchase(body)` | `POST /api/v1/checkout/agent-purchase`, headers `X-180-Agent-Key`, `Idempotency-Key` |
| `exchangeAuthCode` / `TokenExchangeClient.exchangeCode` / `refreshToken` | `POST /api/oauth/token` (JSON) |
| `getUserInfo` / `UserInfoClient.fetchProfile` | `GET /api/oauth/userinfo`, Bearer |
| `verifyIdToken` / `JwksVerifier` | JWKS candidates: `/certs/jwks.json`, `/.well-known/jwks.json`, `/api/oauth/jwks.json`, `/oauth/certs`, profile `/.well-known/jwks.json`. RS256 only. |
| 180 Verify server: `createVerificationSession` / `fetchVerificationResult` | `POST /api/v1/identity/verify/session` and `GET /api/v1/identity/verify/session/{id}/result`. This is the only confirmed **Basic `base64(clientId:clientSecret)`** auth pattern. |
| Public | `GET /api/oauth/client/{clientId}` (app config), `GET /api/oauth/bootstrap?client_id&redirect_uri&scope&state&origin`, `GET /api/v1/pricing-tables/{appId or clientId}`, `GET /api/v1/geo-pricing/resolve?appId&baseAmount&baseCurrency&country`, `GET /health` |

There is **no** `OneEightyCore` class with `clientSecret`: `OneEightyCore` is just an alias of the browser `OneEighty` object.

---

## 6. Gaps and uncertainties

1. **Identity disabled** for our client and **Pay in maintenance**: live state on 2026-11-23, see the top of this doc.
2. Whether `/api/oauth/token` enforces PKCE for CDN-issued codes. The CDN SDK drops the verifier; use the custom launcher (2.5).
3. Whether consent returns an `id_token`, its `aud`, its claims, and whether it is RS256 (keys are RS256; discovery also lists HS256). Token-response and userinfo-response shapes.
4. `POST /api/v1/pay/checkout-session` (server session) is documented on the product page only. Its auth (Bearer secret plus secret in body), response fields, and whether it locks the amount are all unconfirmed.
5. How sandbox sessions behave on the server: test keys or simulated success. There is no real test mode.
6. Real webhook payload: `event` vs `type`, amount units (simulator shows 49900), presence of `orderId` / `sessionId`, timestamp units, which secret signs (webhook vs client secret), retry policy. Only `payment.captured` is named; no failure, refund or subscription events.
7. Whether `orderId` and `metadata` are stored on the session (`metadata.orderId`?), and what `amount` holds after the payer switches currency.
8. No refund, transaction-lookup or order-lookup API. Session and status endpoints are unauthenticated and auto-create sessions.
9. Security notes on 180's side:
   - the SDK does not check postMessage origins;
   - the hosted login posts the user's platform token to `*`;
   - public session reads expose app config and gateway-secret fields.
10. During research, one GET to `/api/v1/checkout/sessions/sess_probe_doesnotexist_1` auto-created a PENDING ₹100 session under 180's own default app. No payment was made, and it expires after 1 h.
