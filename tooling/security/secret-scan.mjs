/**
 * Stage 9: secret scanning (local and CI). Walks the repository source (never .env files, dependencies, build output or local data)
 * and reports anything that looks like a credential committed to the code: private keys, cloud / provider tokens, connection strings
 * with passwords, and hard-coded secret assignments. Known development / test placeholders are allow-listed explicitly below.
 *
 *   node tooling/security/secret-scan.mjs          exit 1 when a finding remains
 *
 * It complements (does not replace) a dedicated scanner in CI (e.g. GitHub secret scanning / gitleaks) - see
 * docs/SECURITY_TESTING_HANDOFF.md. Findings print the file and line, never the matched secret.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', '.tools', '.storage', '.pgdata', 'generated', 'coverage', 'test-results', 'playwright-report', 'Figma Files', 'figma-handoff', 'screenshots']);
const SKIP_FILE = /^\.env($|\.)|\.(png|jpe?g|gif|webp|ico|pdf|mp4|webm|woff2?|ttf|zip|dump|lock)$|pnpm-lock\.yaml$/i;

const RULES = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'stripe-like-live-key', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: 'connection-string-password', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/'"]+:([^@\s'"]{6,})@/ },
  { id: 'secret-assignment', re: /\b(?:secret|password|passwd|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{16,})["']/i },
];

/**
 * Reviewed placeholders: values that exist only for local development, tests or CI and are documented as such. Matching is on the
 * captured value (or file for rule-wide exceptions). Adding to this list needs a security review.
 */
const ALLOW_VALUES = [
  /^test-|^ci-|^dev-|^openapi-generation-only|^CHANGE_ME|^unset$|^Test-Password|^x{10,}|^y{10,}|^Qa-\$\{/,
  /^(?:payout|notify)-webhook-secret-0123456789abcdef/,
  /^mock[-_]/i,
  // values built at runtime (template interpolation) or documented placeholders
  /^\$\{/,
  /YOUR_|CHANGE_ME/,
  /^openapi$/,
];
const ALLOW_FILES = [
  // a CI-only Postgres password for the throwaway service container
  { file: /^\.github\/workflows\//, rule: 'connection-string-password', value: /^ci-/ },
  // test fixtures create throwaway users with literal passwords on the disposable test database (never real credentials)
  { file: /(^|\/)test\/|\.test\.tsx?$|^tooling\/e2e\//, rule: 'secret-assignment', value: /./ },
];

const findings = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full);
      continue;
    }
    if (SKIP_FILE.test(name) || st.size > 2_000_000) continue;
    const rel = relative(root, full).replace(/\\/g, '/');
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const r of RULES) {
        const m = r.re.exec(line);
        if (!m) continue;
        const value = m[1] ?? m[0];
        if (ALLOW_VALUES.some((a) => a.test(value))) continue;
        if (ALLOW_FILES.some((a) => a.file.test(rel) && a.rule === r.id && a.value.test(value))) continue;
        // env / placeholder references are not secrets
        if (/process\.env|\$\{\{|<[a-z-]+>|example|placeholder|redacted/i.test(value)) continue;
        findings.push({ file: rel, line: i + 1, rule: r.id });
      }
    });
  }
}
walk(root);
for (const f of findings) console.log(`FINDING ${f.rule} ${f.file}:${f.line}`);
console.log(findings.length ? `${findings.length} possible secret(s) found (values not printed)` : 'secret scan: no findings');
process.exit(findings.length ? 1 : 0);
