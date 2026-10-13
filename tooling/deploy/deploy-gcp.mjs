/**
 * Launch readiness: deploy a tagged release to a Google Cloud Run cell (STAGING ONLY).
 *
 * Order: 1) point the migration job at the release image and run it (forward-only migrate deploy + permission catalogue sync; the
 * deploy stops if it fails), 2) roll out the API, 3) roll out the five web apps, 4) verify readiness (GET /v1/health/ready = 200).
 * Cloud Run only sends traffic to a revision after its startup probe passes.
 *
 * PRODUCTION IS REFUSED: production deployment is not authorized (founder decision); a production path is added only after approval.
 *
 * Environment: DEPLOY_TARGET=staging, RELEASE_VERSION=vX.Y.Z, GCP_PROJECT, GCP_REGION, GCP_ARTIFACT_REGISTRY (region-docker.pkg.dev/
 * project/repo), CELL_PREFIX (default dd-staging); optional HEALTH_URL (+ CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET when the
 * environment is behind Cloudflare Access). Without HEALTH_URL (private mode) readiness is checked on the service URL with an
 * identity token. `DRY_RUN=1` prints the commands without running them.
 */
import { execFileSync } from 'node:child_process';

const env = process.env;
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (env.DEPLOY_TARGET !== 'staging')
  fail(`BLOCKED: ${env.DEPLOY_TARGET ?? '(none)'} deployment is not authorized. This step deploys STAGING only.`);
if (!/^v\d+\.\d+\.\d+$/.test(env.RELEASE_VERSION ?? '')) fail('RELEASE_VERSION must be a release tag like v1.2.3');
for (const k of ['GCP_PROJECT', 'GCP_REGION', 'GCP_ARTIFACT_REGISTRY'])
  if (!env[k]) fail(`BLOCKED: ${k} is not configured (staging cloud not provisioned yet). Nothing was deployed.`);

const v = env.RELEASE_VERSION;
const prefix = env.CELL_PREFIX ?? 'dd-staging';
const common = [`--project=${env.GCP_PROJECT}`, `--region=${env.GCP_REGION}`, '--quiet'];
const image = (name) => `${env.GCP_ARTIFACT_REGISTRY}/${name}:${v}`;
const dry = env.DRY_RUN === '1';
const gcloud = (...args) => {
  console.log(`$ gcloud ${args.join(' ')}`);
  if (dry) return '';
  return execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
};

// 1) migrations first (the job fails the deploy if a migration fails)
gcloud('run', 'jobs', 'update', `${prefix}-migrate`, `--image=${image('migrate')}`, ...common);
gcloud('run', 'jobs', 'execute', `${prefix}-migrate`, '--wait', ...common);

// 2) API, then 3) web apps
gcloud('run', 'services', 'update', `${prefix}-api`, `--image=${image('api')}`, `--update-labels=release=${v.replaceAll('.', '-')}`, ...common);
for (const app of ['customer', 'merchant', 'staff', 'partner', 'admin'])
  gcloud('run', 'services', 'update', `${prefix}-${app}`, `--image=${image(app)}`, `--update-labels=release=${v.replaceAll('.', '-')}`, ...common);

// 4) readiness
if (!dry) {
  let url;
  const headers = {};
  if (env.HEALTH_URL) {
    url = env.HEALTH_URL;
    if (env.CF_ACCESS_CLIENT_ID) {
      headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET ?? '';
    }
  } else {
    const uri = gcloud('run', 'services', 'describe', `${prefix}-api`, '--format=value(status.url)', ...common).trim();
    url = `${uri}/v1/health/ready`;
    headers.Authorization = `Bearer ${execFileSync('gcloud', ['auth', 'print-identity-token', `--audiences=${uri}`], { encoding: 'utf8' }).trim()}`;
  }
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) {
    const res = await fetch(url, { headers }).catch(() => null);
    ok = res?.status === 200;
    if (!ok) await new Promise((r) => setTimeout(r, 6000));
  }
  if (!ok) fail(`Release ${v} deployed but ${url} is not ready. Roll back by redeploying the previous tag.`);
}
console.log(`staging now runs ${v}${dry ? ' (dry run: nothing executed)' : ''}`);
