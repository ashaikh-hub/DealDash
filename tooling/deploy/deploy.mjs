/**
 * Stage 9: provider-neutral deployment step (called by .github/workflows/release.yml).
 *
 * Hosting is not selected yet (EXTERNAL DEPENDENCY, founder decision). Until it is, this step REFUSES to deploy: it never guesses a
 * target. When hosting is chosen, the platform's deploy hook (or CLI) receives the release version; the platform then
 *   1. runs `prisma migrate deploy` with the MIGRATION role (forward-only; never reset / seed),
 *   2. rolls out the versioned images (API first, then the web apps),
 *   3. checks GET /v1/health/ready on every instance before taking traffic,
 * and the deploy record (version, target, who approved, time) is kept with the release artifact.
 *
 * Inputs (environment): DEPLOY_TARGET (staging | production), RELEASE_VERSION (vX.Y.Z), DEPLOY_HOOK_URL, DEPLOY_HOOK_TOKEN.
 */
const target = process.env.DEPLOY_TARGET;
const version = process.env.RELEASE_VERSION;
const hook = process.env.DEPLOY_HOOK_URL;
const token = process.env.DEPLOY_HOOK_TOKEN;

if (!['staging', 'production'].includes(target ?? '')) {
  console.error('DEPLOY_TARGET must be staging or production');
  process.exit(1);
}
if (!/^v\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('RELEASE_VERSION must be a release tag like v1.2.3 (deployments are always of a built, tagged release)');
  process.exit(1);
}
if (!hook || !token) {
  console.error(`BLOCKED: hosting for ${target} is not configured (DEPLOY_HOOK_URL / DEPLOY_HOOK_TOKEN secrets are not set). Nothing was deployed.`);
  process.exit(1);
}
if (!hook.startsWith('https://')) {
  console.error('DEPLOY_HOOK_URL must be https');
  process.exit(1);
}
const res = await fetch(hook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ target, version, requestedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, actor: process.env.GITHUB_ACTOR ?? null }),
});
console.log(`deploy hook answered ${res.status} for ${target} ${version}`);
if (!res.ok) process.exit(1);
