/**
 * Launch readiness G-2: run the ONE-OFF staging seed (synthetic data) after the first release has been deployed to staging.
 *
 * Points the `<prefix>-seed` Cloud Run job at the release's migration image and runs it once. The job takes the seed password and the
 * shared authenticator key from Secret Manager (nothing is passed on the command line), refuses unless it is staging, and refuses any
 * database that already has accounts. Read the two values afterwards in Secret Manager (`<prefix>-seed-user-password`,
 * `<prefix>-seed-admin-totp-secret`) — they are never printed.
 *
 * PRODUCTION IS REFUSED: there is no production seed.
 *
 * Environment: DEPLOY_TARGET=staging, RELEASE_VERSION=vX.Y.Z (already deployed), GCP_PROJECT, GCP_REGION, GCP_ARTIFACT_REGISTRY,
 * CELL_PREFIX (default dd-staging). `DRY_RUN=1` prints the commands without running them.
 */
import { execFileSync } from 'node:child_process';

const env = process.env;
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (env.DEPLOY_TARGET !== 'staging')
  fail(`BLOCKED: ${env.DEPLOY_TARGET ?? '(none)'} seeding is not allowed. Only STAGING is ever seeded.`);
if (!/^v\d+\.\d+\.\d+$/.test(env.RELEASE_VERSION ?? '')) fail('RELEASE_VERSION must be a release tag like v1.2.3');
for (const k of ['GCP_PROJECT', 'GCP_REGION', 'GCP_ARTIFACT_REGISTRY'])
  if (!env[k]) fail(`BLOCKED: ${k} is not configured (staging cloud not provisioned yet). Nothing was run.`);

const prefix = env.CELL_PREFIX ?? 'dd-staging';
if (!prefix.includes('staging')) fail(`BLOCKED: ${prefix} does not look like a staging cell.`);
const common = [`--project=${env.GCP_PROJECT}`, `--region=${env.GCP_REGION}`, '--quiet'];
const dry = env.DRY_RUN === '1';
const gcloud = (...args) => {
  console.log(`$ gcloud ${args.join(' ')}`);
  if (dry) return '';
  return execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
};

gcloud('run', 'jobs', 'update', `${prefix}-seed`, `--image=${env.GCP_ARTIFACT_REGISTRY}/migrate:${env.RELEASE_VERSION}`, ...common);
gcloud('run', 'jobs', 'execute', `${prefix}-seed`, '--wait', ...common);
console.log(
  `staging seeded from ${env.RELEASE_VERSION}${dry ? ' (dry run: nothing executed)' : ''}. Credentials: Secret Manager (${prefix}-seed-user-password, ${prefix}-seed-admin-totp-secret).`,
);
