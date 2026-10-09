'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RequirePermission, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDateTime, withLocale } from '@dealdash/localization';
import type { ApplicationSection } from '@dealdash/types';
import { Alert, Card, KeyValue, Stepper, StatusChip, Timeline, type StepItem } from '@dealdash/ui';
import { ApplicationProvider, useApplication } from './application-context';
import {
  AgreementStep,
  BranchesStep,
  BusinessStep,
  CategoryStep,
  DocumentsStep,
  RepresentativeStep,
  ReviewStep,
  SettlementStep,
} from './onboarding-steps';

const STEPS = [
  { id: 'business', section: 'BUSINESS' },
  { id: 'category', section: 'CATEGORY' },
  { id: 'representative', section: 'REPRESENTATIVE' },
  { id: 'branches', section: 'BRANCHES' },
  { id: 'documents', section: 'DOCUMENTS' },
  { id: 'settlement', section: 'SETTLEMENT' },
  { id: 'agreement', section: 'AGREEMENT' },
  { id: 'review', section: 'VERIFICATION' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const statusTone = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_REVIEW: 'info',
  RESUBMITTED: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
} as const;

function Wizard() {
  const { app } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [current, setCurrent] = useState<StepId>('business');
  const flagged = useMemo(
    () => new Set<ApplicationSection>(app.application.requestedChanges?.sections ?? []),
    [app.application.requestedChanges],
  );

  const steps: StepItem[] = STEPS.map((s) => {
    const item = app.completeness.find((c) => c.section === s.section);
    const state: StepItem['state'] =
      s.id === current
        ? 'current'
        : flagged.has(s.section as ApplicationSection)
          ? 'attention'
          : item?.complete
            ? 'done'
            : 'todo';
    return {
      id: s.id,
      label: t(`step.${s.id}` as never),
      state,
      hint: flagged.has(s.section as ApplicationSection)
        ? t('onboarding.changesRequestedHint')
        : undefined,
    };
  });
  const index = STEPS.findIndex((s) => s.id === current);

  const body = {
    business: <BusinessStep />,
    category: <CategoryStep />,
    representative: <RepresentativeStep />,
    branches: <BranchesStep />,
    documents: <DocumentsStep />,
    settlement: <SettlementStep />,
    agreement: <AgreementStep />,
    review: <ReviewStep onJump={(id) => setCurrent(id as StepId)} />,
  }[current];

  const rc = app.application.requestedChanges;
  return (
    <div className="dd-stack">
      {rc ? (
        <Alert tone="warning" title={t('onboarding.changesRequested')}>
          <div className="dd-pre">
            {locale === 'ar' && rc.messageAr ? rc.messageAr : rc.message}
          </div>
        </Alert>
      ) : null}
      <div className="dd-split">
        <div className="dd-stack">
          <Card>
            <div className="dd-stack">
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="dd-title">{t(`step.${current}` as never)}</h2>
                <span className="dd-caption">
                  {t('onboarding.stepOf', { n: index + 1, total: STEPS.length })}
                </span>
              </div>
              <p className="dd-muted">{t(`stepHelp.${current}` as never)}</p>
              {body}
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                  className="dd-btn dd-btn--ghost"
                  disabled={index === 0}
                  onClick={() => setCurrent(STEPS[index - 1]!.id)}
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  className="dd-btn dd-btn--secondary"
                  disabled={index === STEPS.length - 1}
                  onClick={() => setCurrent(STEPS[index + 1]!.id)}
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
          </Card>
        </div>
        <aside className="dd-split__aside">
          <Card>
            <div className="dd-stack">
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <strong>{t('onboarding.reference')}</strong>
                <span className="dd-ltr">{app.application.reference}</span>
              </div>
              <StatusChip tone={statusTone[app.application.status]}>
                {t(`appStatus.${app.application.status}` as never)}
              </StatusChip>
              <Stepper
                steps={steps}
                label={t('onboarding.steps')}
                onSelect={(id) => setCurrent(id as StepId)}
              />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Read-only view once the application is with DealDash (or decided). */
function StatusView() {
  const { app } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const a = app.application;
  const b = app.business;
  const active = app.organizationStatus === 'ACTIVE';

  const message =
    a.status === 'APPROVED'
      ? active
        ? { tone: 'success' as const, text: t('status.approvedActive') }
        : { tone: 'warning' as const, text: t('status.approvedNeedsAgreement') }
      : a.status === 'REJECTED'
        ? { tone: 'danger' as const, text: t('status.rejected') }
        : { tone: 'info' as const, text: t('status.underReview') };

  return (
    <div className="dd-stack">
      <Alert tone={message.tone} title={t(`appStatus.${a.status}` as never)}>
        {message.text}
      </Alert>
      {a.status === 'REJECTED' ? (
        <Card>
          <div className="dd-stack">
            <h2 className="dd-title">{t('status.rejectionReason')}</h2>
            <div className="dd-pre">
              {locale === 'ar' && a.rejectionReasonAr ? a.rejectionReasonAr : a.rejectionReason}
            </div>
            <p className="dd-caption">
              {a.appealable ? t('status.appealable') : t('status.notAppealable')}
            </p>
          </div>
        </Card>
      ) : null}
      {active ? (
        <Link
          className="dd-btn dd-btn--primary"
          href={withLocale('/', locale)}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('status.goDashboard')}
        </Link>
      ) : null}
      <Card>
        <div className="dd-stack">
          <h2 className="dd-title">{t('status.summary')}</h2>
          <KeyValue
            items={[
              {
                label: t('onboarding.reference'),
                value: <span className="dd-ltr">{a.reference}</span>,
              },
              {
                label: t('status.submittedAt'),
                value: a.submittedAt ? formatDateTime(locale, a.submittedAt) : '-',
              },
              { label: t('status.version'), value: <span className="dd-ltr">{a.version}</span> },
              { label: t('biz.legalNameEn'), value: b.legalNameEn },
              { label: t('biz.legalNameAr'), value: b.legalNameAr },
              {
                label: t('biz.crNumber'),
                value: <span className="dd-ltr">{b.commercialRegistrationNumber}</span>,
              },
              {
                label: t('settle.iban'),
                value: <span className="dd-ltr">{app.settlement?.ibanMasked}</span>,
              },
            ]}
          />
        </div>
      </Card>
      <Card>
        <div className="dd-stack">
          <h2 className="dd-title">{t('status.timeline')}</h2>
          <Timeline
            label={t('status.timeline')}
            items={[
              { id: 'created', title: t('status.tCreated'), tone: 'neutral' },
              ...(a.submittedAt
                ? [
                    {
                      id: 'submitted',
                      title: t('status.tSubmitted'),
                      meta: formatDateTime(locale, a.submittedAt),
                      tone: 'info' as const,
                    },
                  ]
                : []),
              ...(a.status === 'IN_REVIEW'
                ? [{ id: 'review', title: t('status.tInReview'), tone: 'info' as const }]
                : []),
              ...(a.decidedAt
                ? [
                    {
                      id: 'decided',
                      title: t(`appStatus.${a.status}` as never),
                      meta: formatDateTime(locale, a.decidedAt),
                      tone: a.status === 'APPROVED' ? ('success' as const) : ('danger' as const),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </Card>
    </div>
  );
}

function Content() {
  const { app } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const a = app.application;
  // Editable: DRAFT or CHANGES_REQUESTED. Approved-but-unsigned merchants also need the agreement step.
  const needsSigning =
    a.status === 'APPROVED' && app.organizationStatus === 'DRAFT' && !app.agreement.acceptance;
  return (
    <div className="dd-stack">
      <h1 className="dd-title-xl">{t('nav.application')}</h1>
      {app.organizationStatus === 'SUSPENDED' ? (
        <Alert tone="danger">{t('status.suspendedBanner')}</Alert>
      ) : null}
      {app.editable ? <Wizard /> : needsSigning ? <AgreementStep /> : <StatusView />}
    </div>
  );
}

export function OnboardingPage() {
  return (
    <RequirePermission any={['merchant.application.manage']}>
      <ApplicationProvider>
        <Content />
      </ApplicationProvider>
    </RequirePermission>
  );
}
