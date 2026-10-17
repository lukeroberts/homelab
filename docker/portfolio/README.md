# Portfolio workload

## Sure rollout (additive)

This stack adds Sure while retaining Actual Budget, Wealthfolio, and their existing
volume names and configuration. Removing the old services or retargeting their
public URLs is a separate cutover. dTax and other crypto-tax tools are not included.

Sure uses the upstream `0.7.5-hotfix.2` image for both web and Sidekiq, PostgreSQL 16,
and Redis 8.2. Images are version-pinned, and Watchtower is explicitly disabled for
the new services. The web entrypoint prepares the database; the worker waits for
web health before starting. `/up` is a boot/liveness check, not proof that banking
connections or background imports work.

### Before merging / deploying

The Git-backed Portainer stack follows the repository default branch with hourly
automatic updates. **Merging can deploy this change.** Arrange the deployment
window and configure the required stack variables before merging. Do not change
the stack's existing Wealthfolio variables.

| Variable | Purpose |
| --- | --- |
| `SURE_SECRET_KEY_BASE` | Required persistent Rails application secret; generate with `openssl rand -hex 64` |
| `SURE_POSTGRES_PASSWORD` | Required database password; generate with `openssl rand -hex 32` |

Store the real values in the secret manager and supply them to Portainer's stack
environment. Do not commit an `.env` containing real credentials. Retain the Rails
secret securely with backups; changing it can invalidate sessions and protected
data. Changing a PostgreSQL environment password does not rotate an initialized
database's password.

No bank/exchange credentials, cloud AI key, or static MCP token is enabled in this
Compose file. Configure providers after secure first-user setup. Do not import demo
or financial data until the intended instance and backup arrangements are verified.

### Reverse proxy and initial setup

Only the `sure` web service joins the existing external `frontend` network. It has
no host-published port. PostgreSQL, Redis, and Sidekiq are on a separate stack-local
bridge, not `frontend`; the bridge allows outbound provider access for background
syncs and is deliberately not Docker `internal: true`.

Create a new, privately accessible HTTPS proxy host pointing to **HTTP `sure:3000`**.
Retain the old proxy hosts until a separately approved cutover. Preserve the original
Host and `X-Forwarded-Proto: https` headers. `RAILS_ASSUME_SSL=true` expects HTTPS
termination at this trusted proxy; the backend itself speaks HTTP. No DNS, proxy,
firewall, or registration changes are applied by this repository change.

Verify container health, then connectivity from the reverse proxy to `sure:3000`,
then the final HTTPS hostname. Complete first-user registration over the restricted
HTTPS path before making it accessible to others; the first user is privileged.
Close self-service registration in Sure's self-hosting settings afterward. Configure
MFA if available, and test the actual login and onboarding screens, not just `/up`.

### Provider and query access follow-up

- Link banking/card accounts through SimpleFIN and reconcile balances and transfers.
- Add read-only exchange credentials and verify whole-wallet address coverage.
- Set up MCP separately after deciding which tools may be exposed. Sure's native
  MCP is write-capable; a client hiding tools is not an enforced read-only boundary.
- Do not assume features documented on upstream `main` exist in this pinned release.

### Authentik OIDC (optional)

The shared web/worker environment supports one OpenID Connect provider using the
release's native YAML/env configuration. Set these stack variables in Portainer:

| Variable | Purpose |
| --- | --- |
| `SURE_OIDC_ISSUER` | Authentik's per-application issuer URL, ending in `/application/o/<slug>/` |
| `SURE_OIDC_CLIENT_ID` | Confidential OIDC client identifier |
| `SURE_OIDC_CLIENT_SECRET` | Client secret stored in Bitwarden; never commit the value |
| `SURE_OIDC_REDIRECT_URI` | Exact HTTPS callback ending in `/auth/openid_connect/callback` |

Without all four values, Sure skips the OIDC provider and local login remains
available. Redeploy through Portainer after setting the values; changing the
stack environment alone does not alter running containers. The login button is
labelled **Sign in with Authentik**. No DB-provider mode or database edits are
needed for this env-backed configuration.

Use authorization-code flow, an exact callback allowlist, and the `openid`,
`email`, and `profile` scopes. Restrict the Authentik application's allowed users
or groups before enabling it. Sure requires a verified email claim: use an
appropriate trusted mapping for the authorized identity, not an alias rewrite.

Local login is explicitly retained. JIT provisioning is `create_and_link` so a
new SSO email can create its own account through Sure's first-login flow. Keep
the local break-glass super-admin account separate: do not link the SSO identity
to it, change its email, or configure automatic super-admin group mappings. The
instance administrator promotes the new SSO account manually after first login.
A new account may create its own household/family; do not assume it shares the
local administrator's financial data automatically.

Verify the sign-in button, authorization redirect and complete callback with the
intended Authentik user. Merely validating discovery does not prove login works.
If rolling back, clear the four OIDC stack values and redeploy; the separate local
administrator login remains available. Do not delete user data during rollback.

### Persistence, backups, and rollback

New stack-scoped named volumes:

- `sure-storage`: `/rails/storage`, shared by web and worker (uploads/attachments).
- `sure-postgres-data`: PostgreSQL data; use consistent database dumps, not a live
  filesystem copy as the only backup.
- `sure-redis-data`: persistent Redis state (AOF enabled).

**Automated off-host backups are not installed by this PR.** Before real financial
imports, configure a backup destination and schedule. Retain consistent PostgreSQL
dumps, application storage, and application secrets, then test restoration into an
isolated instance. Pause writers for a coordinated database/storage snapshot when
necessary. Never commit database exports or backup secrets to this repository.

For an initial rollout failure, stop/revert only the new Sure services through
Portainer/Git. Retain all new and existing volumes; do not use `down -v` or volume
pruning. The old applications remain available. Once Sure contains data, database
migrations can make image downgrades unsafe: restore a compatible database/storage
backup rather than assuming an old image will read a migrated database.

### Configuration validation

Render with neutral non-production values before publishing changes:

```sh
SURE_SECRET_KEY_BASE=validation-only-not-a-real-secret \
SURE_POSTGRES_PASSWORD=validation-only-password \
WF_SECRET_KEY=validation-only-key \
WF_AUTH_PASSWORD_HASH=validation-only-hash \
WF_CORS_ALLOW_ORIGINS=https://example.invalid \
docker compose -f docker/portfolio/docker-compose.yml config --quiet
```

This checks Compose configuration only. Real-image startup, account setup, proxy
routing, backups, bank sync, and MCP access must be verified during the approved
rollout; a valid Compose file is not proof of a working production deployment.
