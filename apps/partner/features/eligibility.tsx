'use client';

import { useState } from 'react';
import { useApi, useAuth, useResource } from '@dealdash/app-shell';
import {
  CARD_PROGRAM_STATUSES,
  PARTNER_VERIFICATION_METHODS,
  type EligibilityExpression,
} from '@dealdash/types';
import { Alert, Button, Card, Field, Input, Select, Tabs, Textarea } from '@dealdash/ui';
import {
  Chip,
  Loaded,
  PartnerPage,
  csvList,
  k,
  parsePairs,
  pbase,
  useCmd,
  usePerms,
  useT,
  type ModuleRow,
} from './utils';

interface Options {
  attributes: string[];
  self: { id: string; nameEn: string; partnerType: string };
  cardPrograms: Array<{
    code: string;
    nameEn: string;
    productCode: string;
    tier: string;
    scheme: string;
  }>;
  employerPrograms: Array<{ code: string; nameEn: string }>;
  cities: string[];
  markets: string[];
}

/** Eligibility: the rule tree is only BUILT here; the shared DealDash engine validates, stores and evaluates it. */
export function PartnerEligibilityPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.elig.title')}
      intro={t('pt.elig.intro')}
      any={['partner.eligibility.read']}
      testId="pt-eligibility"
    >
      {(orgId) => <EligInner orgId={orgId} />}
    </PartnerPage>
  );
}

function EligInner({ orgId }: { orgId: string }) {
  const t = useT();
  const modules = useResource<ModuleRow[]>(`${pbase(orgId)}/modules`);
  const has = (m: string) =>
    modules.data?.some((x) => x.module === m && x.offered && x.entitled) ?? false;
  const tabs = [
    { id: 'rules', label: t('pt.elig.tab.rules') },
    ...(has('CARD_PROGRAMS') ? [{ id: 'cards', label: t('pt.elig.tab.cards') }] : []),
    ...(has('EMPLOYER_PROGRAMS') ? [{ id: 'employers', label: t('pt.elig.tab.employers') }] : []),
  ];
  const [tab, setTab] = useState('rules');
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('pt.elig.title')} />
      {tab === 'rules' ? <Rules orgId={orgId} /> : null}
      {tab === 'cards' ? <CardPrograms orgId={orgId} /> : null}
      {tab === 'employers' ? <EmployerPrograms orgId={orgId} /> : null}
    </div>
  );
}

type Node = EligibilityExpression;
let defaults: { self: string; city: string } = { self: '', city: '' };
/** A new condition starts with a value that is valid on its own: the partner itself for issuer / scheme / employer, an enabled city. */
const leaf = (attr: string): Node => ({
  op: 'ATTR',
  attr: attr as never,
  values:
    ['CARD', 'EMPLOYER', 'SCHEME'].includes(attr) && defaults.self
      ? [defaults.self]
      : attr === 'GEOGRAPHY' && defaults.city
        ? [defaults.city]
        : [],
});

function NodeEditor({
  node,
  onChange,
  onRemove,
  options,
  depth,
}: {
  node: Node;
  onChange: (n: Node) => void;
  onRemove?: () => void;
  options: Options;
  depth: number;
}) {
  const t = useT();
  if (node.op === 'ATTR') {
    const suggestions =
      node.attr === 'CARD_TIER'
        ? options.cardPrograms.map((c) => c.tier)
        : node.attr === 'CARD_PRODUCT'
          ? options.cardPrograms.map((c) => c.productCode)
          : node.attr === 'GEOGRAPHY'
            ? options.cities
            : ['CARD', 'EMPLOYER', 'SCHEME'].includes(node.attr)
              ? [options.self.id]
              : [];
    return (
      <div
        className="dd-row"
        style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}
        data-testid="pt-rule-leaf"
      >
        <Field label={t('pt.elig.attribute')} htmlFor={`a-${depth}`}>
          <Select
            value={node.attr}
            onChange={(e) => onChange({ ...node, attr: e.target.value as never, values: [] })}
          >
            {options.attributes.map((a) => (
              <option key={a} value={a}>
                {t(k('pt.elig.attr', a))}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('pt.elig.values')} htmlFor={`v-${depth}`}>
          <Input
            dir="ltr"
            list={`sug-${node.attr}`}
            value={node.values.join(', ')}
            onChange={(e) => onChange({ ...node, values: csvList(e.target.value) })}
          />
        </Field>
        <datalist id={`sug-${node.attr}`}>
          {[...new Set(suggestions)].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            {t('pt.elig.remove')}
          </Button>
        ) : null}
      </div>
    );
  }
  if (node.op === 'NOT')
    return (
      <div
        className="dd-stack"
        style={{
          gap: 6,
          borderInlineStart: '3px solid var(--dd-color-border, #ddd)',
          paddingInlineStart: 10,
        }}
      >
        <strong>{t('pt.elig.not')}</strong>
        <NodeEditor
          node={node.child}
          onChange={(c) => onChange({ op: 'NOT', child: c })}
          options={options}
          depth={depth + 1}
        />
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            {t('pt.elig.remove')}
          </Button>
        ) : null}
      </div>
    );
  const set = (i: number, c: Node) =>
    onChange({ ...node, children: node.children.map((x, j) => (j === i ? c : x)) });
  return (
    <div
      className="dd-stack"
      style={{
        gap: 8,
        borderInlineStart: '3px solid var(--dd-color-primary, #5B1AFC)',
        paddingInlineStart: 10,
      }}
      data-testid="pt-rule-group"
    >
      <Select
        aria-label={t('pt.elig.builder')}
        value={node.op}
        onChange={(e) => onChange({ ...node, op: e.target.value as 'AND' | 'OR' })}
        style={{ maxWidth: 240 }}
      >
        <option value="AND">{t('pt.elig.all')}</option>
        <option value="OR">{t('pt.elig.any')}</option>
      </Select>
      {node.children.map((c, i) => (
        <NodeEditor
          key={i}
          node={c}
          onChange={(x) => set(i, x)}
          onRemove={
            node.children.length > 1
              ? () => onChange({ ...node, children: node.children.filter((_, j) => j !== i) })
              : undefined
          }
          options={options}
          depth={depth + 1}
        />
      ))}
      <div className="dd-row" style={{ gap: 6 }}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange({
              ...node,
              children: [...node.children, leaf(options.attributes[0] ?? 'GEOGRAPHY')],
            })
          }
          data-testid="pt-rule-add"
        >
          {t('pt.elig.addCondition')}
        </Button>
        {depth < 3 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...node,
                children: [
                  ...node.children,
                  { op: 'OR', children: [leaf(options.attributes[0] ?? 'GEOGRAPHY')] },
                ],
              })
            }
          >
            {t('pt.elig.addGroup')}
          </Button>
        ) : null}
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            {t('pt.elig.remove')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Rules({ orgId }: { orgId: string }) {
  const t = useT();
  const perms = usePerms();
  const { call } = useApi();
  const options = useResource<Options>(`${pbase(orgId)}/eligibility/options`);
  const rules = useResource<Array<{ id: string; name: string; createdAt: string }>>(
    `${pbase(orgId)}/eligibility/rules`,
  );
  const cmd = useCmd();
  const [name, setName] = useState('');
  const [expr, setExpr] = useState<Node | null>(null);
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<string | null>(null);
  if (options.data) defaults = { self: options.data.self.id, city: options.data.cities[0] ?? '' };
  const tree = expr ?? { op: 'AND', children: [leaf(options.data?.attributes[0] ?? 'GEOGRAPHY')] };
  const complete = (n: Node): boolean =>
    n.op === 'ATTR'
      ? n.values.length > 0
      : n.op === 'NOT'
        ? complete(n.child)
        : n.children.every(complete);
  const test = async () => {
    const attributes = parsePairs(sample).flatMap(([attr, v]) =>
      csvList(v).map((value) => ({ attr: attr.toUpperCase(), value })),
    );
    const r = await call<{ result: string }>('POST', `${pbase(orgId)}/eligibility/test`, {
      body: { expression: tree, sample: { attributes } },
    });
    setResult(r.ok && r.data ? r.data.result : null);
    if (!r.ok)
      await cmd.run('POST', `${pbase(orgId)}/eligibility/test`, {
        expression: tree,
        sample: { attributes },
      });
  };
  const save = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/eligibility/rules`,
      { name, expression: tree },
      t('pt.saved'),
    );
    if (r.ok) await rules.reload();
  };
  return (
    <Loaded res={options}>
      {(o) => (
        <div className="dd-stack" style={{ gap: 12 }}>
          {cmd.banner}
          <Card>
            <h2 className="dd-title">{t('pt.elig.builder')}</h2>
            <div className="dd-stack" style={{ gap: 10 }} data-testid="pt-rule-builder">
              <NodeEditor node={tree} onChange={setExpr} options={o} depth={0} />
              <Field label={t('pt.elig.sample')} htmlFor="r-sample">
                <Textarea
                  id="r-sample"
                  dir="ltr"
                  rows={3}
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  placeholder={`CARD = ${o.self.id}\nCARD_TIER = platinum`}
                />
              </Field>
              <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  onClick={() => void test()}
                  disabled={!complete(tree)}
                  data-testid="pt-rule-test"
                >
                  {t('pt.elig.test')}
                </Button>
                {result ? (
                  <Chip
                    v={
                      result === 'ELIGIBLE'
                        ? 'OK'
                        : result === 'HIDDEN'
                          ? 'MISSING'
                          : 'VALIDATION_REQUIRED'
                    }
                    label={t(k('pt.elig.result', result))}
                    testId="pt-rule-result"
                  />
                ) : null}
              </div>
              {perms.includes('partner.eligibility.manage') ? (
                <div
                  className="dd-row"
                  style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
                >
                  <Field label={t('pt.elig.ruleName')} htmlFor="r-name">
                    <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Button
                    onClick={() => void save()}
                    disabled={!name || !complete(tree)}
                    loading={cmd.busy}
                    data-testid="pt-rule-save"
                  >
                    {t('pt.elig.saveRule')}
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
          <Card>
            <h2 className="dd-title">{t('pt.elig.saved')}</h2>
            <Loaded res={rules} empty={(d) => !d.length}>
              {(d) => (
                <ul
                  className="dd-list"
                  style={{ margin: 0, paddingInlineStart: 18 }}
                  data-testid="pt-rules"
                >
                  {d.map((r) => (
                    <li key={r.id}>{r.name}</li>
                  ))}
                </ul>
              )}
            </Loaded>
          </Card>
        </div>
      )}
    </Loaded>
  );
}

interface CardProgram {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  scheme: string;
  issuerName: string;
  productCode: string;
  tier: string;
  binPrefixes: string[];
  market: string;
  verificationMethod: string;
  status: string;
}

function CardPrograms({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const res = useResource<CardProgram[]>(`${pbase(orgId)}/card-programs`);
  const markets = useResource<Array<{ code: string; nameEn: string; nameAr: string }>>(
    `${pbase(orgId)}/markets`,
  );
  const cmd = useCmd();
  const [f, setF] = useState({
    code: '',
    nameEn: '',
    nameAr: '',
    scheme: '',
    issuerName: '',
    productCode: '',
    tier: '',
    bins: '',
    market: '',
    verificationMethod: 'SELF_DECLARED',
    status: 'ACTIVE',
  });
  const save = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/card-programs`,
      {
        ...f,
        binPrefixes: csvList(f.bins),
        market: f.market || markets.data?.[0]?.code,
        bins: undefined,
      },
      t('pt.saved'),
    );
    if (r.ok) await res.reload();
  };
  const field = (key: keyof typeof f, label: string, dir?: 'ltr' | 'rtl') => (
    <Field
      label={label}
      htmlFor={`cp-${key}`}
      error={
        cmd.fields[key === 'bins' ? 'binPrefixes' : key] ??
        (key === 'bins' ? cmd.fields['binPrefixes.0'] : undefined)
      }
    >
      <Input
        id={`cp-${key}`}
        dir={dir}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Alert tone="info">{t('pt.card.privacy')}</Alert>
      {cmd.banner}
      {perms.includes('partner.eligibility.manage') ? (
        <Card>
          <div
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            }}
            data-testid="pt-card-form"
          >
            {field('code', t('pt.card.code'), 'ltr')}
            {field('nameEn', t('pt.nameEn'))}
            {field('nameAr', t('pt.nameAr'), 'rtl')}
            {field('scheme', t('pt.card.scheme'), 'ltr')}
            {field('issuerName', t('pt.card.issuer'))}
            {field('productCode', t('pt.card.productCode'), 'ltr')}
            {field('tier', t('pt.card.tier'), 'ltr')}
            {field('bins', t('pt.card.bins'), 'ltr')}
            <Field label={t('pt.market')} htmlFor="cp-market">
              <Select
                id="cp-market"
                value={f.market}
                onChange={(e) => setF({ ...f, market: e.target.value })}
              >
                {(markets.data ?? []).map((m) => (
                  <option key={m.code} value={m.code}>
                    {locale === 'ar' ? m.nameAr : m.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('pt.card.verify')} htmlFor="cp-verify">
              <Select
                id="cp-verify"
                value={f.verificationMethod}
                onChange={(e) => setF({ ...f, verificationMethod: e.target.value })}
              >
                {PARTNER_VERIFICATION_METHODS.map((v) => (
                  <option key={v} value={v}>
                    {t(k('pt.verify', v))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('pt.status')} htmlFor="cp-status">
              <Select
                id="cp-status"
                value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value })}
              >
                {CARD_PROGRAM_STATUSES.map((v) => (
                  <option key={v} value={v}>
                    {t(k('pt.pstate', v))}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            onClick={() => void save()}
            loading={cmd.busy}
            style={{ marginBlockStart: 8 }}
            data-testid="pt-card-save"
          >
            {t('pt.save')}
          </Button>
        </Card>
      ) : null}
      <Card>
        <Loaded res={res} empty={(d) => !d.length}>
          {(d) => (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="pt-card-table">
                <thead>
                  <tr>
                    <th>{t('pt.card.code')}</th>
                    <th>{t('pt.card.scheme')}</th>
                    <th>{t('pt.card.tier')}</th>
                    <th>{t('pt.card.bins')}</th>
                    <th>{t('pt.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {locale === 'ar' ? c.nameAr : c.nameEn}{' '}
                        <span className="dd-muted dd-ltr">{c.code}</span>
                      </td>
                      <td className="dd-ltr">{c.scheme}</td>
                      <td className="dd-ltr">{c.tier}</td>
                      <td className="dd-ltr">{c.binPrefixes.join(', ')}</td>
                      <td>
                        <Chip v={c.status} label={t(k('pt.pstate', c.status))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

function EmployerPrograms({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const res = useResource<
    Array<{
      id: string;
      code: string;
      nameEn: string;
      nameAr: string;
      domains: string[];
      status: string;
      verifiedMembers: number;
    }>
  >(`${pbase(orgId)}/employer-programs`);
  const markets = useResource<Array<{ code: string; nameEn: string; nameAr: string }>>(
    `${pbase(orgId)}/markets`,
  );
  const cmd = useCmd();
  const [f, setF] = useState({ code: '', nameEn: '', nameAr: '', domains: '', market: '' });
  const save = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/employer-programs`,
      {
        code: f.code,
        nameEn: f.nameEn,
        nameAr: f.nameAr,
        domains: csvList(f.domains),
        market: f.market || markets.data?.[0]?.code,
        status: 'ACTIVE',
      },
      t('pt.saved'),
    );
    if (r.ok) await res.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Alert tone="info">{t('pt.emp.intro')}</Alert>
      {cmd.banner}
      {perms.includes('partner.eligibility.manage') ? (
        <Card>
          <div
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            }}
          >
            <Field label={t('pt.card.code')} htmlFor="ep-code">
              <Input
                id="ep-code"
                dir="ltr"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value })}
              />
            </Field>
            <Field label={t('pt.nameEn')} htmlFor="ep-en">
              <Input
                id="ep-en"
                value={f.nameEn}
                onChange={(e) => setF({ ...f, nameEn: e.target.value })}
              />
            </Field>
            <Field label={t('pt.nameAr')} htmlFor="ep-ar">
              <Input
                id="ep-ar"
                dir="rtl"
                value={f.nameAr}
                onChange={(e) => setF({ ...f, nameAr: e.target.value })}
              />
            </Field>
            <Field
              label={t('pt.emp.domains')}
              htmlFor="ep-dom"
              error={cmd.fields.domains ?? cmd.fields['domains.0']}
            >
              <Input
                id="ep-dom"
                dir="ltr"
                value={f.domains}
                onChange={(e) => setF({ ...f, domains: e.target.value })}
              />
            </Field>
            <Field label={t('pt.market')} htmlFor="ep-market">
              <Select
                id="ep-market"
                value={f.market}
                onChange={(e) => setF({ ...f, market: e.target.value })}
              >
                {(markets.data ?? []).map((m) => (
                  <option key={m.code} value={m.code}>
                    {locale === 'ar' ? m.nameAr : m.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button onClick={() => void save()} loading={cmd.busy} style={{ marginBlockStart: 8 }}>
            {t('pt.save')}
          </Button>
        </Card>
      ) : null}
      <Card>
        <Loaded res={res} empty={(d) => !d.length}>
          {(d) => (
            <table className="dd-table" data-testid="pt-emp-table">
              <tbody>
                {d.map((e) => (
                  <tr key={e.id}>
                    <td>{locale === 'ar' ? e.nameAr : e.nameEn}</td>
                    <td className="dd-ltr">{e.domains.join(', ')}</td>
                    <td>
                      {t('pt.emp.members')}: {e.verifiedMembers}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Loaded>
      </Card>
    </div>
  );
}
