# Cloudflare deployment

RiceText uses Cloudflare Pages for the Vite application, Workers for every /api/* request, D1 for relational state, and R2 for uploaded objects. The Node/Fastify application remains a pre-cutover fallback and a local behavior reference; it is not a safe rollback target after D1 starts accepting writes.

## Current implementation

The Worker implements all existing business contract routes, OIDC Authorization Code + PKCE, opaque HttpOnly sessions, production Origin enforcement, D1 transactions, R2 upload/read/range/ETag, paid-object authorization, and scheduled cleanup. Preview and production are isolated Wrangler environments.

Repository quality gates must pass before deployment:

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm --filter @ricetext/worker test
pnpm test:e2e:cloudflare
pnpm build
```

## Required environment inputs

Create GitHub Environments named preview and production. Each environment needs:

- secrets: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET
- variables: CF_PAGES_PROJECT, CF_APP_ORIGIN

The Cloudflare API token must be limited to the target account and permit Workers Scripts, Workers Routes, D1, R2, and Pages deployment. Never commit OIDC secrets or API tokens.

Use stable same-origin hosts, for example preview.example.com and app.example.com. Register these exact OIDC callbacks at the identity provider:

```text
https://preview.example.com/api/auth/callback
https://app.example.com/api/auth/callback
```

Session mode does not support a cross-origin VITE_API_ROOT. Both Pages builds leave VITE_API_ROOT empty, and each hostname routes /api/* to its matching Worker.

## Create resources

Authenticate Wrangler, then create isolated resources:

```bash
pnpm --filter @ricetext/worker exec wrangler login
pnpm --filter @ricetext/worker exec wrangler d1 create ricetext-preview
pnpm --filter @ricetext/worker exec wrangler d1 create ricetext-production
pnpm --filter @ricetext/worker exec wrangler r2 bucket create ricetext-preview-uploads
pnpm --filter @ricetext/worker exec wrangler r2 bucket create ricetext-production-uploads
```

Create two Pages projects and attach the stable preview/production custom hostnames. Replace every all-zero database_id, every example.com origin/zone, and both route patterns in apps/worker/wrangler.jsonc. Resource IDs and hostnames are auditable configuration; credentials remain secrets.

Before any remote change, run:

```bash
pnpm cf:preflight -- preview
pnpm cf:preflight -- production
```

Preflight rejects placeholder IDs/domains, missing bindings, route/origin disagreement, missing credentials, and invalid OIDC issuer configuration.

## Local Worker

```bash
pnpm --filter @ricetext/worker d1:migrate:local
pnpm --filter @ricetext/worker dev
```

Local Wrangler state uses ALLOW_DEMO_AUTH=true. Preview and production explicitly set it to false, so x-user-id cannot select a production role.

## OIDC identity map

OIDC auto-provisioning creates readers only. Existing authors, moderators, document owners, and ACL editors/administrators must be mapped to their old user IDs during migration.

Create an ignored file such as .data/cloudflare-identity-map.json:

```json
[
  { "issuer": "https://id.example.com", "subject": "oidc-subject-for-author", "userId": "author" },
  { "issuer": "https://id.example.com", "subject": "oidc-subject-for-moderator", "userId": "moderator" }
]
```

The exporter rejects unknown users, duplicate issuer/subject pairs, and any unmapped author or moderator.

## Initial data migration

Always import into a new D1 database that has never served traffic. A failed import is discarded and recreated; it is never resumed in place.

1. Stop Fastify writes.
2. Back up .data/ricetext.sqlite and .data/uploads.
3. Export source data:

```bash
pnpm cf:export -- --db .data/ricetext.sqlite --uploads .data/uploads --out .data/cloudflare-export --identity-map .data/cloudflare-identity-map.json
```

The export fails if an asset file is missing, a local attachment URL cannot be mapped to a managed asset, or a privileged identity is unmapped. The generated D1 file intentionally has no BEGIN TRANSACTION or COMMIT because Wrangler executes imports inside its own transaction handling.

4. Apply schema migrations:

```bash
pnpm --filter @ricetext/worker d1:migrate:preview
# or
pnpm --filter @ricetext/worker d1:migrate:production
```

5. Upload and verify every R2 object:

```bash
pnpm cf:r2-upload -- --manifest .data/cloudflare-export/r2-manifest.json --bucket ricetext-production-uploads --dry-run
pnpm cf:r2-upload -- --manifest .data/cloudflare-export/r2-manifest.json --bucket ricetext-production-uploads
```

The non-dry run downloads every uploaded object, recomputes SHA-256, and writes verification-r2-target.json.

6. Import D1:

```bash
pnpm --filter @ricetext/worker exec wrangler d1 execute DB --remote --env production --file ../../.data/cloudflare-export/d1-import.sql
```

Use --env preview for preview. Historical purchases are restored while purchase triggers are temporarily absent, then the triggers are recreated. No application traffic may reach this database during import.

7. Verify the target:

```bash
pnpm cf:verify -- production .data/cloudflare-export
```

Verification compares table counts and all R2 objects, then checks foreign keys, current revision pointers, owner ACLs, privileged OIDC mappings, and purchase triggers. A non-zero exit blocks cutover.

## Deployment automation

.github/workflows/deploy-cloudflare.yml performs quality checks, applies D1 migrations, writes Worker secrets, deploys the Worker, deploys Pages, and runs smoke checks. A push to main deploys preview. Production is a workflow_dispatch run with target=production. Environment-level concurrency prevents overlapping migration/deploy jobs.

Manual equivalents are:

```bash
pnpm cf:preflight -- preview
pnpm --filter @ricetext/worker d1:migrate:preview
pnpm --filter @ricetext/worker deploy:preview
pnpm --filter @ricetext/web build
pnpm --dir apps/worker exec wrangler pages deploy ../web/dist --project-name <preview-pages-project> --branch preview
pnpm cf:smoke -- https://preview.example.com
```

The smoke command proves the Pages shell is HTML, Worker health is JSON, unknown API paths are not swallowed by the SPA fallback, and the production Origin guard is active. Preview acceptance must additionally complete a real OIDC login/session/logout and an authorized write/rollback with the dedicated test identity.

## Production cutover

1. Complete the full preview migration and acceptance flow.
2. Freeze source writes and take the final SQLite/uploads backup.
3. Export, upload, import, and run cf:verify against fresh production resources.
4. Record a D1 Time Travel bookmark with wrangler d1 time-travel info ricetext-production.
5. Deploy Worker and Pages while writes remain frozen.
6. Run automated smoke plus real OIDC, editor write/rollback, R2 range, paid attachment, comment, suggestion, and poll checks.
7. Re-enable writes only after all checks pass. Retain the source backup read-only for the agreed retention period.

## Rollback

Before Worker writes are enabled, remove the Worker route and re-enable Fastify writes; the frozen source remains current, so RPO is zero.

After Worker writes are enabled, do not route back to the old SQLite database. Roll back application code with the previous Worker/Pages deployment while retaining D1/R2. For a data fault, freeze writes and restore D1 to the recorded Time Travel bookmark. R2 objects are immutable and source uploads remain retained through the rollback window.
