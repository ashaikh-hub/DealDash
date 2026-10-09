'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth, useResource } from '@dealdash/app-shell';
import { createTranslator, formatDate, formatDateTime, withLocale } from '@dealdash/localization';
import { APPLICATION_SECTIONS, RISK_TIERS, TRUST_LEVELS } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  LoadingState,
  Modal,
  Select,
  StatusChip,
  Table,
  Tabs,
  Textarea,
  Timeline,
} from '@dealdash/ui';
import type { AdminMerchantDetail } from '@dealdash/validation';
import { appTone, docTone, orgTone } from './tones';

type Dialog = null | 'approve' | 'changes' | 'reject' | 'suspend' | 'reactivate' | 'risk' | 'trust';
type Tab = 'overview' | 'documents' | 'branches' | 'people' | 'history' | 'audit';

function useCommand() {
  const { locale } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    clear: () => setError(null),
    async exec<T>(
      fn: () => Promise<{
        ok: boolean;
        data: T | null;
        errors: Array<{ code: string; message: string }>;
      }>,
    ) {
      setBusy(true);
      setError(null);
      const res = await fn();
      setBusy(false);
      if (!res.ok) setError(errorMessage(locale, res.errors));
      return res;
    },
  };
}

export function WorkbenchPage({ orgId }: { orgId: string }) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const detail = useResource<AdminMerchantDetail>(`/v1/admin/merchants/${orgId}`);
  const cmd = useCommand();
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<Dialog>(null);

  // decision form state
  const [note, setNote] = useState('');
  const [sections, setSections] = useState<string[]>([]);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [messageAr, setMessageAr] = useState('');
  const [reasonAr, setReasonAr] = useState('');
  const [appealable, setAppealable] = useState(true);
  const [reason, setReason] = useState('');
  const [tier, setTier] = useState('STANDARD');
  const [level, setLevel] = useState('NEW');
  const [newNote, setNewNote] = useState('');

  const d = detail.data;
  const canManage = me?.permissions.includes('admin.merchants.manage') ?? false;

  async function act(path: string, body?: unknown, close = true) {
    const res = await cmd.exec(() =>
      call<AdminMerchantDetail>('POST', `/v1/admin/merchants/${orgId}/${path}`, {
        body: body ?? {},
      }),
    );
    if (res.ok && res.data) {
      detail.set(res.data);
      if (close) {
        setDialog(null);
        setNote('');
        setMessage('');
        setMessageAr('');
        setReason('');
        setReasonAr('');
        setSections([]);
        setDocIds([]);
      }
    }
    return res;
  }

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  if (detail.loading && !d) return <LoadingState label={t('state.loading')} />;
  if (!d) {
    return (
      <ErrorState
        title={t('state.error')}
        description={errorMessage(locale, detail.errors)}
        retryLabel={t('state.retry')}
        onRetry={() => void detail.reload()}
      />
    );
  }

  const a = d.application;
  const mine = a.assignedToUserId === me?.id;
  const claimable =
    a.status === 'SUBMITTED' ||
    a.status === 'RESUBMITTED' ||
    (a.status === 'IN_REVIEW' && !a.assignedToUserId);
  const deciding = a.status === 'IN_REVIEW' && mine;
  const decided = a.status === 'APPROVED' || a.status === 'REJECTED';
  const name =
    locale === 'ar'
      ? (d.business.tradeNameAr ?? d.business.tradeNameEn)
      : (d.business.tradeNameEn ?? d.business.tradeNameAr);
  const incomplete = d.completeness.filter((c) => !c.complete);
  const reviewDocs = d.documents.filter((x) => x.status !== 'SUPERSEDED');

  const dialogTitle: Record<Exclude<Dialog, null>, string> = {
    approve:
      a.riskTier === 'ENHANCED' && !a.firstApproverUserId ? t('wb.firstApprove') : t('wb.approve'),
    changes: t('wb.requestChanges'),
    reject: t('wb.reject'),
    suspend: t('wb.suspend'),
    reactivate: t('wb.reactivate'),
    risk: t('wb.setRisk'),
    trust: t('wb.setTrust'),
  };

  async function submitDialog() {
    if (dialog === 'approve') return act('approve', { note: note.trim() || undefined });
    if (dialog === 'changes')
      return act('request-changes', {
        sections,
        documentIds: docIds,
        message: message.trim(),
        messageAr: messageAr.trim() || undefined,
      });
    if (dialog === 'reject')
      return act('reject', {
        reason: message.trim(),
        reasonAr: reasonAr.trim() || undefined,
        appealable,
      });
    if (dialog === 'suspend') return act('suspend', { reason: reason.trim() });
    if (dialog === 'reactivate') return act('reactivate', { reason: reason.trim() });
    if (dialog === 'risk') return act('risk-tier', { tier, reason: reason.trim() });
    if (dialog === 'trust') return act('trust-level', { level, reason: reason.trim() });
  }
  const dialogValid =
    dialog === 'approve'
      ? true
      : dialog === 'changes'
        ? sections.length > 0 && message.trim().length > 0
        : dialog === 'reject'
          ? message.trim().length > 0
          : dialog
            ? reason.trim().length > 0
            : false;

  const kvBusiness = [
    { label: t('biz.legalNameEn'), value: d.business.legalNameEn },
    { label: t('biz.legalNameAr'), value: d.business.legalNameAr },
    { label: t('biz.tradeNameEn'), value: d.business.tradeNameEn },
    { label: t('biz.tradeNameAr'), value: d.business.tradeNameAr },
    {
      label: t('biz.crNumber'),
      value: <span className="dd-ltr">{d.business.commercialRegistrationNumber}</span>,
    },
    { label: t('biz.taxNumber'), value: <span className="dd-ltr">{d.business.taxNumber}</span> },
    { label: t('biz.registeredAddress'), value: d.business.registeredAddress },
    {
      label: t('category.category'),
      value: d.category
        ? locale === 'ar'
          ? d.category.nameAr
          : d.category.nameEn
        : d.business.categoryCode,
    },
    { label: t('biz.phone'), value: <span className="dd-ltr">{d.business.businessPhone}</span> },
    { label: t('biz.email'), value: <span className="dd-ltr">{d.business.businessEmail}</span> },
  ];

  const tabBody = {
    overview: (
      <div className="dd-stack">
        {d.duplicateRegistrationNumber ? <Alert tone="warning">{t('wb.duplicateCr')}</Alert> : null}
        {d.riskSuggestion.suggestedTier === 'ENHANCED' && a.riskTier === 'STANDARD' ? (
          <Alert tone="warning" title={t('wb.riskSuggestion')}>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {d.riskSuggestion.reasons.map((r) => (
                <li key={r}>{locale === 'en' ? r : t('wb.riskReasonGeneric')}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Card flat>
          <div className="dd-stack">
            <h3 className="dd-title">{t('wb.completeness')}</h3>
            <div className="dd-row">
              {d.completeness.map((c) => (
                <StatusChip key={c.section} tone={c.complete ? 'success' : 'warning'}>
                  {t(`section.${c.section}` as never)}
                </StatusChip>
              ))}
            </div>
            {incomplete.length ? <p className="dd-caption">{t('wb.incompleteNote')}</p> : null}
          </div>
        </Card>
        {d.changedSinceLastSubmission.length ? (
          <Alert tone="info" title={t('wb.changedSince')}>
            <ul style={{ margin: 0, paddingInlineStart: 20 }} className="dd-ltr">
              {d.changedSinceLastSubmission.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Card flat>
          <div className="dd-stack">
            <h3 className="dd-title">{t('step.business')}</h3>
            <KeyValue items={kvBusiness} />
          </div>
        </Card>
        <Card flat>
          <div className="dd-stack">
            <h3 className="dd-title">{t('step.representative')}</h3>
            {d.representative ? (
              <KeyValue
                items={[
                  { label: t('rep.fullName'), value: d.representative.fullName },
                  { label: t('rep.role'), value: d.representative.role },
                  {
                    label: t('rep.idReference'),
                    value: <span className="dd-ltr">{d.representative.idReferenceMasked}</span>,
                  },
                  {
                    label: t('rep.mobile'),
                    value: <span className="dd-ltr">{d.representative.mobile}</span>,
                  },
                  {
                    label: t('rep.email'),
                    value: <span className="dd-ltr">{d.representative.email}</span>,
                  },
                  {
                    label: t('rep.signatoryShort'),
                    value: d.representative.isSignatory ? t('common.yes') : t('common.no'),
                  },
                ]}
              />
            ) : (
              <p className="dd-muted">-</p>
            )}
          </div>
        </Card>
        <Card flat>
          <div className="dd-stack">
            <h3 className="dd-title">{t('step.settlement')}</h3>
            {d.settlement ? (
              <>
                <KeyValue
                  items={[
                    { label: t('settle.bankName'), value: d.settlement.bankName },
                    {
                      label: t('settle.iban'),
                      value: <span className="dd-ltr">{d.settlement.ibanMasked}</span>,
                    },
                    { label: t('settle.holder'), value: d.settlement.accountHolderName },
                    {
                      label: t('wb.nameMatch'),
                      value: (
                        <StatusChip tone={d.settlement.nameMatches ? 'success' : 'warning'}>
                          {d.settlement.nameMatches ? t('common.yes') : t('common.no')}
                        </StatusChip>
                      ),
                    },
                    {
                      label: t('settle.status'),
                      value: (
                        <StatusChip
                          tone={
                            d.settlement.verificationStatus === 'VERIFIED' ? 'success' : 'warning'
                          }
                        >
                          {d.settlement.verificationStatus === 'VERIFIED'
                            ? t('settle.verified')
                            : t('settle.unverified')}
                        </StatusChip>
                      ),
                    },
                  ]}
                />
                <p className="dd-caption">{t('wb.bankNote')}</p>
                {canManage && d.settlement.verificationStatus !== 'VERIFIED' ? (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={cmd.busy}
                      onClick={() => void act('bank/verify', {}, false)}
                    >
                      {t('wb.verifyBank')}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="dd-muted">-</p>
            )}
          </div>
        </Card>
        <Card flat>
          <div className="dd-stack">
            <h3 className="dd-title">{t('step.agreement')}</h3>
            {d.acceptances.length === 0 ? (
              <p className="dd-muted">{t('wb.noAcceptance')}</p>
            ) : (
              <Table
                columns={[
                  {
                    key: 'v',
                    header: t('wb.version'),
                    render: (x) => <span className="dd-ltr">{x.agreementVersion}</span>,
                  },
                  {
                    key: 's',
                    header: t('rep.fullName'),
                    render: (x) => `${x.signatoryName} (${x.signatoryRole})`,
                  },
                  { key: 'e', header: t('wb.entity'), render: (x) => x.entityLegalName },
                  {
                    key: 'a',
                    header: t('wb.acceptedAt'),
                    render: (x) => formatDateTime(locale, x.acceptedAt),
                  },
                  {
                    key: 'st',
                    header: t('team.status'),
                    render: (x) => (
                      <StatusChip tone={x.status === 'ACCEPTED' ? 'success' : 'neutral'}>
                        {x.status}
                      </StatusChip>
                    ),
                  },
                ]}
                rows={
                  d.acceptances as unknown as Array<
                    Record<string, unknown> & (typeof d.acceptances)[number]
                  >
                }
                rowKey={(x) => x.id}
              />
            )}
            <p className="dd-caption">
              {t('wb.currentAgreement', { version: d.currentAgreementVersion })}
            </p>
          </div>
        </Card>
      </div>
    ),
    documents: (
      <div className="dd-stack">
        <Alert tone="warning">{t('docs.placeholderNote')}</Alert>
        {reviewDocs.length === 0 ? <EmptyState title={t('wb.noDocuments')} /> : null}
        {reviewDocs.map((doc) => {
          const req = d.requirements.find((r) => r.code === doc.requirementCode);
          return (
            <Card key={doc.id} flat>
              <div className="dd-stack">
                <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    {req ? (locale === 'ar' ? req.nameAr : req.nameEn) : doc.requirementCode}
                  </strong>
                  <StatusChip tone={docTone[doc.status]}>
                    {t(`docs.status.${doc.status}` as never)}
                  </StatusChip>
                </div>
                <div className="dd-row">
                  {doc.url ? (
                    <a href={doc.url} target="_blank" rel="noopener noreferrer" className="dd-ltr">
                      {doc.fileName}
                    </a>
                  ) : (
                    <span className="dd-ltr">{doc.fileName}</span>
                  )}
                  <span className="dd-caption">{(doc.sizeBytes / 1024).toFixed(1)} KB</span>
                  {doc.expiryDate ? (
                    <span className="dd-caption">
                      {t('docs.expires', { date: formatDate(locale, doc.expiryDate) })}
                    </span>
                  ) : null}
                </div>
                {doc.reviewerNote ? <Alert tone="danger">{doc.reviewerNote}</Alert> : null}
                {deciding ? (
                  <div className="dd-row">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={doc.status === 'ACCEPTED'}
                      loading={cmd.busy}
                      onClick={() =>
                        void act(`documents/${doc.id}/review`, { decision: 'ACCEPT' }, false)
                      }
                    >
                      {t('wb.acceptDoc')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setDocIds([doc.id]);
                        setSections(['DOCUMENTS']);
                        setDialog('changes');
                      }}
                    >
                      {t('wb.flagDoc')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    ),
    branches: (
      <Table
        columns={[
          {
            key: 'n',
            header: t('branches.nameEn'),
            render: (b) => (locale === 'ar' ? b.nameAr : b.nameEn),
          },
          {
            key: 'a',
            header: t('branches.addressEn'),
            render: (b) => (locale === 'ar' ? b.addressAr : b.addressEn),
          },
          {
            key: 'l',
            header: t('wb.location'),
            render: (b) => (
              <span className="dd-ltr">
                {b.latitude !== null ? `${b.latitude}, ${b.longitude}` : '-'}
              </span>
            ),
          },
          {
            key: 'h',
            header: t('hours.title'),
            render: (b) => (b.hours ? t('common.yes') : t('branches.noHours')),
          },
          {
            key: 's',
            header: t('team.status'),
            render: (b) => (
              <StatusChip tone={b.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {b.status === 'ACTIVE' ? t('status.active') : t('branches.closed')}
              </StatusChip>
            ),
          },
        ]}
        rows={d.branches as unknown as Array<Record<string, unknown> & (typeof d.branches)[number]>}
        rowKey={(b) => b.id}
        empty={<EmptyState title={t('branches.empty')} />}
      />
    ),
    people: (
      <Table
        columns={[
          { key: 'n', header: t('team.name'), render: (u) => u.name },
          {
            key: 'c',
            header: t('team.contact'),
            render: (u) => <span className="dd-ltr">{u.email ?? u.mobile ?? '-'}</span>,
          },
          { key: 'r', header: t('team.role'), render: (u) => t(`role.${u.roleCode}` as never) },
          {
            key: 'b',
            header: t('team.branch'),
            render: (u) => u.branchName ?? t('team.allBranches'),
          },
          {
            key: 's',
            header: t('team.status'),
            render: (u) => (
              <StatusChip tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {u.status}
              </StatusChip>
            ),
          },
        ]}
        rows={d.users as unknown as Array<Record<string, unknown> & (typeof d.users)[number]>}
        rowKey={(u) => u.membershipId}
        empty={<EmptyState title={t('team.empty')} />}
      />
    ),
    history: (
      <div className="dd-stack">
        <Card flat>
          <div className="dd-stack">
            <h3 className="dd-title">{t('wb.decisions')}</h3>
            {d.decisions.length === 0 ? (
              <p className="dd-muted">-</p>
            ) : (
              <Timeline
                label={t('wb.decisions')}
                items={d.decisions.map((x) => ({
                  id: x.id,
                  title: t(`decision.${x.decision}` as never),
                  meta: `${x.decidedBy} · ${formatDateTime(locale, x.at)}`,
                  body: (locale === 'ar' && x.messageAr ? x.messageAr : x.message) ?? undefined,
                  tone:
                    x.decision === 'APPROVE'
                      ? 'success'
                      : x.decision === 'REJECT'
                        ? 'danger'
                        : x.decision === 'REQUEST_CHANGES'
                          ? 'warning'
                          : 'info',
                }))}
              />
            )}
          </div>
        </Card>
        <Card flat>
          <div className="dd-stack">
            <h3 className="dd-title">{t('wb.notes')}</h3>
            {d.notes.length ? (
              <Timeline
                label={t('wb.notes')}
                items={d.notes.map((n) => ({
                  id: n.id,
                  title: n.author,
                  meta: formatDateTime(locale, n.at),
                  body: n.body,
                }))}
              />
            ) : null}
            <Field label={t('wb.addNote')} htmlFor="wb-note">
              <Textarea id="wb-note" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
            </Field>
            <div>
              <Button
                size="sm"
                variant="secondary"
                loading={cmd.busy}
                disabled={!newNote.trim()}
                onClick={async () => {
                  const r = await act('notes', { body: newNote.trim() }, false);
                  if (r.ok) setNewNote('');
                }}
              >
                {t('wb.saveNote')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    ),
    audit: (
      <Table
        caption={t('nav.audit')}
        columns={[
          {
            key: 'at',
            header: t('audit.when'),
            render: (x) => formatDateTime(locale, x.occurredAt),
          },
          {
            key: 'action',
            header: t('audit.action'),
            render: (x) => <span className="dd-ltr">{x.action}</span>,
          },
          { key: 'role', header: t('audit.role'), render: (x) => x.actorRole ?? '-' },
          { key: 'reason', header: t('common.reason'), render: (x) => x.reason ?? '-' },
        ]}
        rows={d.audit as unknown as Array<Record<string, unknown> & (typeof d.audit)[number]>}
        rowKey={(x) => x.id}
        empty={<EmptyState title={t('state.empty')} />}
      />
    ),
  }[tab];

  return (
    <RequirePermission any={['admin.merchants.review']}>
      <div className="dd-stack">
        <div className="dd-row">
          <Link href={withLocale('/merchants', locale)}>← {t('nav.merchants')}</Link>
        </div>
        <div className="dd-row" style={{ justifyContent: 'space-between' }}>
          <div className="dd-stack" style={{ gap: 4 }}>
            <h1 className="dd-title-xl">{name}</h1>
            <span className="dd-caption dd-ltr">{a.reference}</span>
          </div>
          <div className="dd-row">
            <StatusChip tone={appTone[a.status]}>{t(`appStatus.${a.status}` as never)}</StatusChip>
            <StatusChip tone={orgTone[d.organizationStatus]}>
              {t(`orgStatus.${d.organizationStatus}` as never)}
            </StatusChip>
            <StatusChip tone={a.riskTier === 'ENHANCED' ? 'warning' : 'neutral'}>
              {t(`risk.${a.riskTier}` as never)}
            </StatusChip>
            <StatusChip tone="neutral">{t(`trust.${d.trustLevel}` as never)}</StatusChip>
          </div>
        </div>
        {d.suspendedReason ? (
          <Alert tone="danger" title={t('wb.suspendedReason')}>
            {d.suspendedReason}
          </Alert>
        ) : null}
        {cmd.error && !dialog ? <Alert tone="danger">{cmd.error}</Alert> : null}

        <div className="dd-split">
          <div className="dd-stack">
            <Tabs
              label={t('wb.sections')}
              value={tab}
              onChange={(id) => setTab(id as Tab)}
              tabs={[
                { id: 'overview', label: t('wb.tabOverview') },
                { id: 'documents', label: `${t('step.documents')} (${reviewDocs.length})` },
                { id: 'branches', label: `${t('nav.branches')} (${d.branches.length})` },
                { id: 'people', label: t('wb.tabPeople') },
                { id: 'history', label: t('wb.tabHistory') },
                { id: 'audit', label: t('nav.audit') },
              ]}
            />
            {tabBody}
          </div>

          <aside className="dd-split__aside">
            <Card>
              <div className="dd-stack">
                <h2 className="dd-title">{t('wb.decision')}</h2>
                <KeyValue
                  items={[
                    { label: t('wb.assignedTo'), value: a.assignedTo ?? t('merchants.unassigned') },
                    {
                      label: t('status.submittedAt'),
                      value: a.submittedAt ? formatDateTime(locale, a.submittedAt) : '-',
                    },
                    {
                      label: t('status.version'),
                      value: <span className="dd-ltr">{a.version}</span>,
                    },
                  ]}
                />
                {a.riskTier === 'ENHANCED' ? (
                  <Alert tone="warning">
                    {a.awaitingSecondReview ? t('wb.awaitingSecond') : t('wb.enhancedNote')}
                  </Alert>
                ) : null}
                {a.status === 'CHANGES_REQUESTED' ? (
                  <Alert tone="info">{t('wb.waitingMerchant')}</Alert>
                ) : null}
                {a.status === 'IN_REVIEW' && !mine && a.assignedTo ? (
                  <Alert tone="info">{t('wb.assignedOther', { name: a.assignedTo })}</Alert>
                ) : null}
                {decided ? (
                  <Alert tone={a.status === 'APPROVED' ? 'success' : 'danger'}>
                    {a.status === 'APPROVED' ? t('wb.decidedApproved') : t('wb.decidedRejected')}
                  </Alert>
                ) : null}
                {a.rejectionReason ? <div className="dd-pre">{a.rejectionReason}</div> : null}

                {claimable ? (
                  <Button loading={cmd.busy} onClick={() => void act('claim', {}, false)}>
                    {t('wb.claim')}
                  </Button>
                ) : null}
                {deciding ? (
                  <div className="dd-stack">
                    {incomplete.length ? (
                      <Alert tone="warning">{t('wb.cannotApprove')}</Alert>
                    ) : null}
                    <Button
                      onClick={() => {
                        cmd.clear();
                        setDialog('approve');
                      }}
                      disabled={
                        incomplete.length > 0 ||
                        (a.riskTier === 'ENHANCED' && a.firstApproverUserId === me?.id)
                      }
                    >
                      {a.riskTier === 'ENHANCED' && !a.firstApproverUserId
                        ? t('wb.firstApprove')
                        : t('wb.approve')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        cmd.clear();
                        setDialog('changes');
                      }}
                    >
                      {t('wb.requestChanges')}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        cmd.clear();
                        setDialog('reject');
                      }}
                    >
                      {t('wb.reject')}
                    </Button>
                    <Button
                      variant="ghost"
                      loading={cmd.busy}
                      onClick={() => void act('release', {}, false)}
                    >
                      {t('wb.release')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <div className="dd-stack">
                <h2 className="dd-title">{t('wb.riskAndTrust')}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    cmd.clear();
                    setTier(a.riskTier === 'ENHANCED' ? 'STANDARD' : 'ENHANCED');
                    setDialog('risk');
                  }}
                >
                  {t('wb.setRisk')}
                </Button>
                {canManage ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        cmd.clear();
                        setLevel(d.trustLevel);
                        setDialog('trust');
                      }}
                    >
                      {t('wb.setTrust')}
                    </Button>
                    {d.organizationStatus === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          cmd.clear();
                          setDialog('suspend');
                        }}
                      >
                        {t('wb.suspend')}
                      </Button>
                    ) : null}
                    {d.organizationStatus === 'SUSPENDED' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          cmd.clear();
                          setDialog('reactivate');
                        }}
                      >
                        {t('wb.reactivate')}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </Card>
          </aside>
        </div>

        <Modal
          open={dialog !== null}
          onClose={() => setDialog(null)}
          title={dialog ? dialogTitle[dialog] : ''}
          closeLabel={t('common.close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={dialog === 'reject' || dialog === 'suspend' ? 'danger' : 'primary'}
                loading={cmd.busy}
                disabled={!dialogValid}
                onClick={() => void submitDialog()}
              >
                {t('common.confirm')}
              </Button>
            </>
          }
        >
          <div className="dd-stack">
            {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
            {dialog === 'approve' ? (
              <>
                {a.riskTier === 'ENHANCED' && !a.firstApproverUserId ? (
                  <Alert tone="warning">{t('wb.firstApproveNote')}</Alert>
                ) : (
                  <p className="dd-muted">{t('wb.approveNote')}</p>
                )}
                <Field label={t('wb.optionalNote')} htmlFor="d-note">
                  <Textarea id="d-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </>
            ) : null}
            {dialog === 'changes' ? (
              <>
                <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="dd-label">{t('wb.sectionsToFix')}</legend>
                  {APPLICATION_SECTIONS.map((s) => (
                    <Checkbox
                      key={s}
                      label={t(`section.${s}` as never)}
                      checked={sections.includes(s)}
                      onChange={() => toggle(sections, s, setSections)}
                    />
                  ))}
                </fieldset>
                {reviewDocs.length ? (
                  <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="dd-label">{t('wb.documentsToReplace')}</legend>
                    {reviewDocs.map((x) => (
                      <Checkbox
                        key={x.id}
                        label={<span className="dd-ltr">{x.fileName}</span>}
                        checked={docIds.includes(x.id)}
                        onChange={() => toggle(docIds, x.id, setDocIds)}
                      />
                    ))}
                  </fieldset>
                ) : null}
                <Field label={t('wb.messageEn')} htmlFor="d-msg">
                  <Textarea
                    id="d-msg"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </Field>
                <Field label={t('wb.messageAr')} htmlFor="d-msg-ar">
                  <Textarea
                    id="d-msg-ar"
                    dir="rtl"
                    value={messageAr}
                    onChange={(e) => setMessageAr(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {dialog === 'reject' ? (
              <>
                <Field label={t('wb.reasonEn')} htmlFor="d-rej">
                  <Textarea
                    id="d-rej"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </Field>
                <Field label={t('wb.reasonAr')} htmlFor="d-rej-ar">
                  <Textarea
                    id="d-rej-ar"
                    dir="rtl"
                    value={reasonAr}
                    onChange={(e) => setReasonAr(e.target.value)}
                  />
                </Field>
                <Checkbox
                  label={t('wb.appealable')}
                  checked={appealable}
                  onChange={(e) => setAppealable(e.target.checked)}
                />
              </>
            ) : null}
            {dialog === 'risk' ? (
              <Field label={t('merchants.risk')} htmlFor="d-tier">
                <Select id="d-tier" value={tier} onChange={(e) => setTier(e.target.value)}>
                  {RISK_TIERS.map((x) => (
                    <option key={x} value={x}>
                      {t(`risk.${x}` as never)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {dialog === 'trust' ? (
              <Field label={t('merchants.trust')} htmlFor="d-level">
                <Select id="d-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                  {TRUST_LEVELS.map((x) => (
                    <option key={x} value={x}>
                      {t(`trust.${x}` as never)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {dialog === 'suspend' ? <Alert tone="danger">{t('wb.suspendWarning')}</Alert> : null}
            {dialog === 'risk' ||
            dialog === 'trust' ||
            dialog === 'suspend' ||
            dialog === 'reactivate' ? (
              <Field label={t('common.reason')} htmlFor="d-reason">
                <Textarea
                  id="d-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
        </Modal>
      </div>
    </RequirePermission>
  );
}
