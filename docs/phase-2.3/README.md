# T.A.L.A. Phase 2.3 Verification Portal

The portal reads acknowledged BEEF and SSS E-1 submissions from the existing Express and PostgreSQL API. Verifiers can find records, inspect each stored scan, and compare the submitted values with original OCR. Reviewer corrections and finalized values are displayed separately when available.

- [Repository and API inspection](investigation.md)
- [Current OpenAPI contract](../phase-2.1/openapi.json)
- [Test evidence and acceptance criteria](acceptance.md)
- [Phase 2.4 handoff](phase-2.4-handoff.md)

## Build and serve locally

Use the workspace's supported Node version and install locked dependencies at the repository root. Follow the [backend setup](../phase-2.1/README.md) to configure PostgreSQL, apply migrations for a fresh database, seed template definitions, and provision a `VERIFIER` account. The Phase 2.3 endpoints use the existing schema.

```powershell
npm.cmd ci
npm.cmd run build -w @tala/web
```

For the simplest same-origin setup, configure these values in the ignored `apps/backend/.env` alongside the existing database and private storage settings. Use a certificate for the exact hostname users will open.

```dotenv
WEB_ROOT=../web/dist
HOST=127.0.0.1
PORT=8788
TLS_CERT_FILE=C:/path/to/portal-cert.pem
TLS_KEY_FILE=C:/path/to/portal-key.pem
CORS_ORIGINS=https://localhost:8788
```

Start the existing backend with `npm.cmd run start -w @tala/backend` and open `https://localhost:8788`. Browser login requires a trusted HTTPS certificate and an exact entry in `CORS_ORIGINS`. The URL contains the app shell at `/` and its API at `/api/v1`. Images remain in the backend's separate private storage root.

For the provisioned Windows setup, `apps/backend/.env` can contain only `TALA_BACKEND_ENV_FILE` pointing to the absolute path of the private `backend.env` in the user's local T.A.L.A. folder. The same configuration then applies to `start`, `migrate`, and `seed`. Run `Start-Tala-Backend.cmd` in that folder after restarting Windows to start both the dedicated PostgreSQL instance and the API.

For HMR during web development, configure a local HTTPS certificate in `apps/web/.env.local`. Match the proxy URL's protocol to the loopback backend. For a backend that serves HTTPS directly, use:

```dotenv
WEB_DEV_CERT=C:/path/to/localhost-cert.pem
WEB_DEV_KEY=C:/path/to/localhost-key.pem
WEB_DEV_API=https://127.0.0.1:8788
WEB_DEV_CA=C:/path/to/backend-localhost-cert.pem
```

Add `https://localhost:5173` to the backend's `CORS_ORIGINS` and restart the backend and Vite after changing their environment files. `WEB_DEV_CA` supplies the trust certificate for a self-signed HTTPS backend. If the backend instead listens on plain HTTP behind Vite, use `http://127.0.0.1:8788`, leave `WEB_DEV_CA` unset, and enable `TRUST_LOOPBACK_PROXY=true` on the loopback backend. The service worker is available in the built portal. [Vite server and proxy options](https://vite.dev/config/server-options)

## Production setup

Set `NODE_ENV=production` and serve `apps/web/dist` with `WEB_ROOT` in Express or with a same-origin HTTPS reverse proxy. Forward `/api/*` to the existing backend. Serve the static app shell for web navigation routes only. Set `CORS_ORIGINS` to the exact portal origin and keep PostgreSQL credentials and certificate keys on the server. If a proxy terminates TLS, bind the backend to loopback, enable its existing proxy trust option, and replace forwarded headers at the proxy.

The frontend has no credential environment variables. The API supplies an HttpOnly, Secure, SameSite Strict refresh cookie for browser login. The access bearer and TanStack Query data stay in memory, with no persisted query cache. Route protection gates verifier screens. The API independently enforces roles and ownership. An unavailable connection hides private views and clears the query cache. Image URLs are created from authenticated blobs and revoked when the viewer leaves or switches pages.

## Components and API

- `app.tsx` contains the sign-in and account screens, route guards, and responsive navigation. `session.tsx` restores cookies on load, clears data on logout and expiry, and handles browser connectivity. `api.ts` centralizes bearer requests, refresh, timeouts, and error handling. Response schemas are in `contracts.ts`.
- `submissions.tsx` uses TanStack Query for the dashboard, catalog, and filtered page requests. The summary endpoint returns one PostgreSQL view of status totals and six recent records. The submissions table uses offset pagination and indexes record identity by server UUID.
- `review.tsx` reads record details and the pinned template version. `Viewer` serves one original image at a time, with page navigation, zoom, fit and display rotation. `FieldCard` pairs the linked raw and confirmed values by stable field key and shows warnings and confidence when the API supplies them. Unknown types display their original string values.
- The manifest and build-generated `sw.js` cache only public shell assets. The worker bypasses API requests. Offline navigation can load the shell for the connection message. An installed worker signals when a new portal version is ready to activate. [Service worker secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, and `GET /auth/me` support browser-mode sessions, a memory-only bearer, and server-side refresh revocation.
- `GET /submissions/overview` returns verifier-only counts and recent acknowledged records.
- `GET /submissions` uses `q` to search server references and template names or IDs. Parameters `status`, `template`, `from`, `to`, `sort`, `limit`, and `offset` filter and order on the server. Date bounds are inclusive UTC receipt days.
- `GET /submissions/{id}` returns record status, receipt, page metadata, raw OCR, and downstream values.
- `GET /templates` and `GET /templates/{id}/versions/{version}` supply the actual labels, sections, page slots, types, and conditions.
- `GET /submissions/{id}/pages/{pageNumber}` returns the authenticated JPEG or PNG with the original stored bytes.

The Phase 2.3 backend additions are the summary route, compatible list filters and columns, BEEF section labels, and optional public web shell delivery. Encoders retain their existing owner-scoped list workflow. Submitting-account details are returned only on verifier lists. No new PostgreSQL relations or mobile payload fields are needed.

## Verification commands

```powershell
npm.cmd run typecheck -w @tala/web
npm.cmd run typecheck -w @tala/backend
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-web.ps1 -WithMobileProtocol
```

The test script uses PostgreSQL 18, OpenSSL and Chromium. Set `TALA_TEST_BROWSER` to an alternate Chromium executable or install Playwright Chromium. Set `TALA_TEST_OPENSSL` if OpenSSL is installed outside the Windows Git defaults. The mobile protocol option uses the cached Kotlin toolchain described in the [Phase 2.2 report](../phase-2.2/acceptance.md). The temporary browser test certificates, database and screenshots remain in the ignored workspace cache.
