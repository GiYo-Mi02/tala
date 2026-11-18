# T.A.L.A. Phase 2.1 backend

The Express API stores submissions and verification history in PostgreSQL. The server stores accepted page bytes in a private disk directory and checks them against the database SHA-256 when serving or completing a page. The template catalog contains the existing BEEF and SSS E-1 mappings, both at version 1.

- [Existing mobile models and contract decisions](investigation.md)
- [Crow’s-foot ERD](erd.md) and [data dictionary](data-dictionary.md)
- [OpenAPI 3.1 contract](openapi.json)
- [Phase 2.2 Android synchronization handoff](mobile-handoff.md)
- [Acceptance criteria and test evidence](acceptance.md)

## Local setup

Use Node 22.13 or later within the repository’s supported range and a PostgreSQL server. Phase 2.1 was verified on Node 24.12 and PostgreSQL 18.6. Create a dedicated development database and login from `psql` as a PostgreSQL administrator.

```sql
CREATE ROLE tala_owner LOGIN;
\password tala_owner
CREATE DATABASE tala_dev OWNER tala_owner;
```

At the repository root, install the locked dependencies and copy the example config. Set the PostgreSQL password in the local copy of `DATABASE_URL` and URL-encode special characters in the password.

```powershell
npm.cmd ci
Copy-Item apps/backend/.env.example apps/backend/.env
npm.cmd run migrate -w @tala/backend
npm.cmd run seed -w @tala/backend
```

The seed records define templates and field rules. Provision an initial `ADMIN` with the following commands. A masked prompt supplies the password. The service requires 12 to 128 characters. Use the same command with `ENCODER` or `VERIFIER` for fictional local test accounts, or use the administrator API.

```powershell
$env:TALA_USER_EMAIL = 'admin@example.test'
$env:TALA_USER_ROLE = 'ADMIN'
$env:TALA_USER_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Account password' -AsSecureString)).Password
try { npm.cmd run provision -w @tala/backend }
finally { Remove-Item Env:TALA_USER_PASSWORD, Env:TALA_USER_ROLE, Env:TALA_USER_EMAIL }
```

Start the service and check it from a second terminal.

```powershell
npm.cmd run start -w @tala/backend
Invoke-RestMethod http://127.0.0.1:8788/api/v1/health
```

If you edit the API description, regenerate and test the committed contract.

```powershell
npm.cmd run openapi -w @tala/backend
npm.cmd run typecheck -w @tala/backend
npm.cmd run test -w @tala/backend
npm.cmd run test:postgres -w @tala/backend
```

The PostgreSQL suite uses `initdb` and `pg_ctl` to start a dedicated SCRAM-authenticated cluster on an ephemeral loopback port. On Windows the runner defaults to `C:/Program Files/PostgreSQL/18/bin`. Set `PG_BIN` to a different binary directory as needed. Test storage and PostgreSQL logs are under the ignored `.cache/tala-backend-tests` directory. The runner shuts the cluster down at exit.

## Deployment configuration

- Use `NODE_ENV=production` and direct HTTPS with `TLS_CERT_FILE` and `TLS_KEY_FILE`, or bind to loopback behind a TLS-terminating proxy with `TRUST_LOOPBACK_PROXY=true`. The proxy must overwrite forwarded protocol and address headers. Use a device-trusted certificate for the Android API host.
- Use a backend-only database secret, a private PostgreSQL listener, and verified TLS when connecting to a separate database host. For deployment, grant the runtime login only the required data access and use a separate owner for migrations. Reserve account bootstrapping and maintenance for trusted operators.
- Set `STORAGE_ROOT` to dedicated persistent storage outside public roots and synced folders. Use the example `.cache` path with synthetic data for development. Restrict production filesystem permissions to the service account, including Windows ACLs on NTFS. Back up and restore the database and image store together. For consistent backup snapshots, quiesce writes or use coordinated database and storage snapshots.
- Configure exact origins in `CORS_ORIGINS` for the future browser client. Browser refresh requires HTTPS and an allowed origin. Plan a same-site frontend and API for the strict refresh cookie, and use explicit authorization for document fetches.
- Limit uploads at the proxy and API. `MAX_PAGE_BYTES` defaults to 10 MB per image, with an upper configuration limit of 25 MB. The API also checks for a genuine single JPEG or PNG with upright orientation, up to 24 million pixels and up to 8,000 pixels per axis.
- API, login, refresh, upload, and admin creation rate limits are per process and source IP. Put a shared rate-limiting layer in front of the API before running multiple instances, and use a private object store implementation or shared filesystem for those instances.
- Database transactions protect status, review history, and retry responses. Maintenance reports first. Run `npm.cmd run maintenance -w @tala/backend -- --apply` to expire inactive incomplete uploads after `RETAIN_INCOMPLETE_DAYS` and remove sufficiently old unreferenced files. Completed records require an institutional retention schedule and are outside automated expiry.

See the platform guidance for [Express production security](https://expressjs.com/en/advanced/best-practice-security/), [Node.js scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), and [PostgreSQL lock behavior](https://www.postgresql.org/docs/18/explicit-locking.html).
