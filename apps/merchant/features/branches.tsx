'use client';

import { useMemo, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth, useResource } from '@dealdash/app-shell';
import { createTranslator } from '@dealdash/localization';
import { WEEKDAYS } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  StatusChip,
} from '@dealdash/ui';
import {
  branchInputSchema,
  hoursProblems,
  type BranchSummaryView,
  type WeeklyHours,
} from '@dealdash/validation';
import { useCommand, validateWith } from './forms';

type Interval = { open: string; close: string };
type DayState = { closed: boolean; intervals: Interval[] };
type HoursState = Record<(typeof WEEKDAYS)[number], DayState>;

const defaultHours = (): HoursState =>
  Object.fromEntries(
    WEEKDAYS.map((d) => [d, { closed: false, intervals: [{ open: '09:00', close: '22:00' }] }]),
  ) as HoursState;

function fromServer(hours: unknown): HoursState {
  const base = defaultHours();
  if (!hours || typeof hours !== 'object') return base;
  for (const d of WEEKDAYS) {
    const day = (hours as Record<string, { closed?: boolean; intervals?: Interval[] }>)[d];
    if (!day) continue;
    base[d] = day.closed
      ? { closed: true, intervals: [{ open: '09:00', close: '22:00' }] }
      : {
          closed: false,
          intervals: day.intervals?.length ? day.intervals : [{ open: '09:00', close: '22:00' }],
        };
  }
  return base;
}

const toServer = (h: HoursState): WeeklyHours =>
  Object.fromEntries(
    WEEKDAYS.map((d) => [
      d,
      h[d].closed ? { closed: true } : { closed: false, intervals: h[d].intervals },
    ]),
  ) as WeeklyHours;

function HoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: HoursState;
  onChange: (v: HoursState) => void;
  disabled?: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const setDay = (d: (typeof WEEKDAYS)[number], patch: Partial<DayState>) =>
    onChange({ ...value, [d]: { ...value[d], ...patch } });
  return (
    <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="dd-label">{t('hours.title')}</legend>
      {WEEKDAYS.map((d) => {
        const day = value[d];
        return (
          <div key={d} className="dd-hours-row">
            <span>{t(`day.${d}` as never)}</span>
            <Checkbox
              label={t('hours.open')}
              checked={!day.closed}
              disabled={disabled}
              onChange={(e) => setDay(d, { closed: !e.target.checked })}
            />
            <div className="dd-stack" style={{ gap: 6 }}>
              {day.closed ? (
                <span className="dd-muted">{t('hours.closed')}</span>
              ) : (
                day.intervals.map((iv, i) => (
                  <div key={i} className="dd-inline-fields" dir="ltr">
                    <Input
                      type="time"
                      aria-label={`${t(`day.${d}` as never)} ${t('hours.from')} ${i + 1}`}
                      value={iv.open}
                      disabled={disabled}
                      onChange={(e) =>
                        setDay(d, {
                          intervals: day.intervals.map((x, j) =>
                            j === i ? { ...x, open: e.target.value } : x,
                          ),
                        })
                      }
                      style={{ inlineSize: 130 }}
                    />
                    <span aria-hidden="true">–</span>
                    <Input
                      type="time"
                      aria-label={`${t(`day.${d}` as never)} ${t('hours.to')} ${i + 1}`}
                      value={iv.close}
                      disabled={disabled}
                      onChange={(e) =>
                        setDay(d, {
                          intervals: day.intervals.map((x, j) =>
                            j === i ? { ...x, close: e.target.value } : x,
                          ),
                        })
                      }
                      style={{ inlineSize: 130 }}
                    />
                    {day.intervals.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() =>
                          setDay(d, { intervals: day.intervals.filter((_, j) => j !== i) })
                        }
                      >
                        {t('hours.removeInterval')}
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
              {!day.closed && day.intervals.length < 3 ? (
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      setDay(d, {
                        intervals: [...day.intervals, { open: '16:00', close: '23:00' }],
                      })
                    }
                  >
                    {t('hours.addInterval')}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

interface BranchForm {
  nameEn: string;
  nameAr: string;
  addressEn: string;
  addressAr: string;
  city: string;
  latitude: string;
  longitude: string;
  phone: string;
}
const emptyForm = (): BranchForm => ({
  nameEn: '',
  nameAr: '',
  addressEn: '',
  addressAr: '',
  city: 'Riyadh',
  latitude: '',
  longitude: '',
  phone: '',
});

function BranchEditor({
  orgId,
  branch,
  editable,
  onClose,
  onSaved,
}: {
  orgId: string;
  branch: BranchSummaryView | null;
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const cmd = useCommand();
  const [form, setForm] = useState<BranchForm>(
    branch
      ? {
          nameEn: branch.nameEn,
          nameAr: branch.nameAr,
          addressEn: branch.addressEn,
          addressAr: branch.addressAr,
          city: branch.city,
          latitude: String(branch.latitude ?? ''),
          longitude: String(branch.longitude ?? ''),
          phone: branch.phone ?? '',
        }
      : emptyForm(),
  );
  const [hours, setHours] = useState<HoursState>(fromServer(branch?.hours));
  const set = (k: keyof BranchForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const payload = {
      ...form,
      latitude: form.latitude === '' ? Number.NaN : Number(form.latitude),
      longitude: form.longitude === '' ? Number.NaN : Number(form.longitude),
      phone: form.phone.trim() || undefined,
      hours: toServer(hours),
    };
    const v = validateWith(branchInputSchema, payload, locale);
    if (!v.ok) return cmd.fail(t('form.fixErrors'), v.fields);
    const problems = hoursProblems(payload.hours);
    if (problems.length) return cmd.fail(t('hours.invalid'));
    const res = await cmd.exec(() =>
      branch
        ? call('PATCH', `/v1/merchants/${orgId}/branches/${branch.id}`, { body: v.data })
        : call('POST', `/v1/merchants/${orgId}/branches`, { body: v.data, idempotent: true }),
    );
    if (res.ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={branch ? t('branches.edit') : t('branches.add')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={cmd.busy} disabled={!editable} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
        <div className="dd-grid dd-grid--2">
          <Field label={t('branches.nameEn')} htmlFor="b-nameEn" error={cmd.fields.nameEn}>
            <Input
              id="b-nameEn"
              value={form.nameEn}
              onChange={set('nameEn')}
              invalid={!!cmd.fields.nameEn}
            />
          </Field>
          <Field label={t('branches.nameAr')} htmlFor="b-nameAr" error={cmd.fields.nameAr}>
            <Input
              id="b-nameAr"
              dir="rtl"
              value={form.nameAr}
              onChange={set('nameAr')}
              invalid={!!cmd.fields.nameAr}
            />
          </Field>
          <Field label={t('branches.addressEn')} htmlFor="b-addrEn" error={cmd.fields.addressEn}>
            <Input
              id="b-addrEn"
              value={form.addressEn}
              onChange={set('addressEn')}
              invalid={!!cmd.fields.addressEn}
            />
          </Field>
          <Field label={t('branches.addressAr')} htmlFor="b-addrAr" error={cmd.fields.addressAr}>
            <Input
              id="b-addrAr"
              dir="rtl"
              value={form.addressAr}
              onChange={set('addressAr')}
              invalid={!!cmd.fields.addressAr}
            />
          </Field>
          <Field label={t('branches.city')} htmlFor="b-city" error={cmd.fields.city}>
            <Input
              id="b-city"
              value={form.city}
              onChange={set('city')}
              invalid={!!cmd.fields.city}
            />
          </Field>
          <Field label={t('branches.phone')} htmlFor="b-phone" error={cmd.fields.phone}>
            <Input
              id="b-phone"
              dir="ltr"
              inputMode="tel"
              placeholder="+966110000000"
              value={form.phone}
              onChange={set('phone')}
              invalid={!!cmd.fields.phone}
            />
          </Field>
          <Field
            label={t('branches.latitude')}
            htmlFor="b-lat"
            error={cmd.fields.latitude}
            help={t('branches.locationHelp')}
          >
            <Input
              id="b-lat"
              dir="ltr"
              inputMode="decimal"
              placeholder="24.7136"
              value={form.latitude}
              onChange={set('latitude')}
              invalid={!!cmd.fields.latitude}
            />
          </Field>
          <Field label={t('branches.longitude')} htmlFor="b-lng" error={cmd.fields.longitude}>
            <Input
              id="b-lng"
              dir="ltr"
              inputMode="decimal"
              placeholder="46.6753"
              value={form.longitude}
              onChange={set('longitude')}
              invalid={!!cmd.fields.longitude}
            />
          </Field>
        </div>
        <HoursEditor value={hours} onChange={setHours} disabled={!editable} />
      </div>
    </Modal>
  );
}

/**
 * Branch list and editor. `editable=false` shows a read-only list (for example while the application is under review).
 * Branch-scoped roles never reach this page (they use the staff app); the API enforces the same rules.
 */
export function BranchesManager({
  orgId,
  branches,
  editable,
  onChanged,
  canManage = true,
}: {
  orgId: string;
  branches: BranchSummaryView[];
  editable: boolean;
  onChanged: () => void;
  canManage?: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const cmd = useCommand();
  const [editing, setEditing] = useState<BranchSummaryView | 'new' | null>(null);

  async function toggle(b: BranchSummaryView) {
    const res = await cmd.exec(() =>
      call('POST', `/v1/merchants/${orgId}/branches/${b.id}/status`, {
        body: { status: b.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE' },
      }),
    );
    if (res.ok) onChanged();
  }

  return (
    <div className="dd-stack">
      {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
      {!editable ? <Alert tone="info">{t('branches.locked')}</Alert> : null}
      {branches.length === 0 ? (
        <EmptyState title={t('branches.empty')} description={t('branches.emptyHint')} />
      ) : (
        <div className="dd-grid dd-grid--2">
          {branches.map((b) => (
            <Card key={b.id}>
              <div className="dd-stack">
                <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                  <h3 className="dd-title">{locale === 'ar' ? b.nameAr : b.nameEn}</h3>
                  <StatusChip tone={b.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {b.status === 'ACTIVE' ? t('status.active') : t('branches.closed')}
                  </StatusChip>
                </div>
                <div className="dd-muted">{locale === 'ar' ? b.addressAr : b.addressEn}</div>
                <div className="dd-caption dd-ltr">
                  {b.latitude !== null ? `${b.latitude}, ${b.longitude}` : t('branches.noLocation')}
                  {b.phone ? ` · ${b.phone}` : ''}
                </div>
                {!b.hours ? <StatusChip tone="warning">{t('branches.noHours')}</StatusChip> : null}
                {canManage && editable ? (
                  <div className="dd-row">
                    <Button size="sm" variant="outline" onClick={() => setEditing(b)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={cmd.busy}
                      onClick={() => void toggle(b)}
                    >
                      {b.status === 'ACTIVE' ? t('branches.close') : t('branches.reopen')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      {canManage && editable ? (
        <div>
          <Button onClick={() => setEditing('new')}>{t('branches.add')}</Button>
        </div>
      ) : null}
      {editing ? (
        <BranchEditor
          orgId={orgId}
          branch={editing === 'new' ? null : editing}
          editable={editable}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** Standalone Branches page (active merchants). */
export function BranchesPage() {
  const { me, locale } = useAuth();
  const t = createTranslator(locale);
  const orgId = me?.activeMembership?.organizationId ?? null;
  const resource = useResource<
    Array<{
      id: string;
      nameEn: string;
      nameAr: string;
      addressEn: string;
      addressAr: string;
      city: string;
      latitude: number | null;
      longitude: number | null;
      phone?: string | null;
      status: string;
      hours?: unknown;
      holidayHours?: unknown;
    }>
  >(orgId ? `/v1/merchants/${orgId}/branches` : null);
  const canManage = me?.permissions.includes('merchant.branch.manage') ?? false;
  const branches = useMemo<BranchSummaryView[]>(
    () =>
      (resource.data ?? []).map((b) => ({
        ...b,
        phone: b.phone ?? null,
        hours: b.hours ?? null,
        holidayHours: b.holidayHours ?? null,
      })),
    [resource.data],
  );

  return (
    <RequirePermission any={['merchant.branch.read']}>
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('nav.branches')}</h1>
        {resource.loading && !resource.data ? (
          <LoadingState label={t('state.loading')} />
        ) : resource.errors.length ? (
          <Alert tone="danger">{errorMessage(locale, resource.errors)}</Alert>
        ) : orgId ? (
          <BranchesManager
            orgId={orgId}
            branches={branches}
            editable
            canManage={canManage}
            onChanged={() => void resource.reload()}
          />
        ) : null}
      </div>
    </RequirePermission>
  );
}
