'use client';

import { useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth, useResource } from '@dealdash/app-shell';
import { createTranslator, formatDateTime } from '@dealdash/localization';
import { MERCHANT_INVITABLE_ROLES } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  StatusChip,
  Table,
  Textarea,
} from '@dealdash/ui';
import { teamInviteSchema, type InvitationView, type TeamUserView } from '@dealdash/validation';
import { useCommand, validateWith } from './forms';

interface TeamData {
  users: TeamUserView[];
  invitations: InvitationView[];
}
interface BranchLite {
  id: string;
  nameEn: string;
  nameAr: string;
  status: string;
}

const ROLE_OPTIONS = [...MERCHANT_INVITABLE_ROLES] as const;

export function TeamPage() {
  const { me, locale, apiUrl } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = me?.activeMembership?.organizationId ?? null;
  const team = useResource<TeamData>(orgId ? `/v1/merchants/${orgId}/team` : null);
  const branches = useResource<BranchLite[]>(orgId ? `/v1/merchants/${orgId}/branches` : null);
  const cmd = useCommand();
  const isOwner = me?.activeMembership?.roleCode === 'MERCHANT_OWNER';
  const isDev = process.env.NODE_ENV !== 'production';

  const [invite, setInvite] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    mobile: '',
    roleCode: 'MERCHANT_ADMIN' as (typeof ROLE_OPTIONS)[number],
    branchId: '',
  });
  const [devLink, setDevLink] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    user: TeamUserView;
    action: 'role' | 'deactivate';
  } | null>(null);
  const [newRole, setNewRole] = useState<string>('MERCHANT_ADMIN');
  const [newBranch, setNewBranch] = useState('');
  const [reason, setReason] = useState('');

  const activeBranches = (branches.data ?? []).filter((b) => b.status === 'ACTIVE');
  const isStaff = form.roleCode === 'MERCHANT_STAFF';

  async function sendInvite() {
    const payload = {
      name: form.name,
      roleCode: form.roleCode,
      email: isStaff ? undefined : form.email.trim() || undefined,
      mobile: isStaff ? form.mobile.trim() || undefined : undefined,
      branchId: isStaff ? form.branchId || undefined : undefined,
    };
    const v = validateWith(teamInviteSchema, payload, locale);
    if (!v.ok) return cmd.fail(t('form.fixErrors'), v.fields);
    const res = await cmd.exec(() =>
      call('POST', `/v1/merchants/${orgId}/team/invitations`, { body: v.data, idempotent: true }),
    );
    if (!res.ok) return;
    setInvite(false);
    setForm({ name: '', email: '', mobile: '', roleCode: 'MERCHANT_ADMIN', branchId: '' });
    await team.reload();
    if (isDev) {
      try {
        const target = v.data.email ?? v.data.mobile ?? '';
        const url = v.data.email
          ? `/v1/dev/last-email?to=${encodeURIComponent(target)}&template=merchant.invite`
          : `/v1/dev/last-sms?to=${encodeURIComponent(target)}`;
        const r = await fetch(apiUrl + url);
        const json = (await r.json()) as { data?: { link?: string | null; body?: string } | null };
        setDevLink(json.data?.link ?? /(https?:\/\/\S+)/.exec(json.data?.body ?? '')?.[1] ?? null);
      } catch {
        setDevLink(null);
      }
    }
  }

  async function applyTarget() {
    if (!target) return;
    const base = `/v1/merchants/${orgId}/team/${target.user.membershipId}`;
    const res = await cmd.exec(() =>
      target.action === 'role'
        ? call('PATCH', `${base}/role`, {
            body: {
              roleCode: newRole,
              branchId:
                newRole === 'MERCHANT_STAFF'
                  ? newBranch || target.user.branchId || undefined
                  : undefined,
            },
          })
        : call('POST', `${base}/deactivate`, { body: { reason } }),
    );
    if (res.ok) {
      setTarget(null);
      setReason('');
      await team.reload();
    }
  }

  async function simple(path: string, method: 'POST' | 'DELETE') {
    const res = await cmd.exec(() => call(method, `/v1/merchants/${orgId}/team/${path}`));
    if (res.ok) await team.reload();
  }

  const roleLabel = (code: string) => t(`role.${code}` as never);

  return (
    <RequirePermission any={['merchant.users.manage']}>
      <div className="dd-stack">
        <div className="dd-row" style={{ justifyContent: 'space-between' }}>
          <h1 className="dd-title-xl">{t('nav.team')}</h1>
          <Button
            onClick={() => {
              cmd.clear();
              setInvite(true);
            }}
          >
            {t('team.invite')}
          </Button>
        </div>
        {cmd.error && !invite && !target ? <Alert tone="danger">{cmd.error}</Alert> : null}
        {devLink ? (
          <Alert tone="info" title={t('team.devLink')}>
            <span className="dd-ltr" style={{ overflowWrap: 'anywhere' }}>
              {devLink}
            </span>
          </Alert>
        ) : null}
        {team.loading && !team.data ? (
          <LoadingState label={t('state.loading')} />
        ) : team.errors.length ? (
          <Alert tone="danger">{errorMessage(locale, team.errors)}</Alert>
        ) : (
          <>
            <Card>
              <div className="dd-stack">
                <h2 className="dd-title">{t('team.members')}</h2>
                <Table
                  columns={[
                    { key: 'name', header: t('team.name') },
                    {
                      key: 'contact',
                      header: t('team.contact'),
                      render: (u) => <span className="dd-ltr">{u.email ?? u.mobile ?? '-'}</span>,
                    },
                    { key: 'role', header: t('team.role'), render: (u) => roleLabel(u.roleCode) },
                    {
                      key: 'branch',
                      header: t('team.branch'),
                      render: (u) => u.branchName ?? t('team.allBranches'),
                    },
                    {
                      key: 'status',
                      header: t('team.status'),
                      render: (u) => (
                        <StatusChip tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>
                          {u.status === 'ACTIVE' ? t('status.active') : t('team.deactivated')}
                        </StatusChip>
                      ),
                    },
                    {
                      key: 'actions',
                      header: '',
                      render: (u) => (
                        <span className="dd-row">
                          {u.status === 'ACTIVE' ? (
                            <>
                              {isOwner || u.roleCode !== 'MERCHANT_OWNER' ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    cmd.clear();
                                    setNewRole(u.roleCode);
                                    setNewBranch(u.branchId ?? '');
                                    setTarget({ user: u, action: 'role' });
                                  }}
                                >
                                  {t('team.changeRole')}
                                </Button>
                              ) : null}
                              {isOwner || u.roleCode !== 'MERCHANT_OWNER' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    cmd.clear();
                                    setTarget({ user: u, action: 'deactivate' });
                                  }}
                                >
                                  {t('team.deactivate')}
                                </Button>
                              ) : null}
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void simple(`${u.membershipId}/reactivate`, 'POST')}
                            >
                              {t('team.reactivate')}
                            </Button>
                          )}
                        </span>
                      ),
                    },
                  ]}
                  rows={
                    (team.data?.users ?? []) as unknown as Array<
                      TeamUserView & Record<string, unknown>
                    >
                  }
                  rowKey={(u) => u.membershipId}
                  empty={<EmptyState title={t('team.empty')} />}
                />
              </div>
            </Card>
            {team.data?.invitations.length ? (
              <Card>
                <div className="dd-stack">
                  <h2 className="dd-title">{t('team.pending')}</h2>
                  <Table
                    columns={[
                      { key: 'name', header: t('team.name') },
                      {
                        key: 'contact',
                        header: t('team.contact'),
                        render: (i) => <span className="dd-ltr">{i.email ?? i.mobile ?? '-'}</span>,
                      },
                      { key: 'role', header: t('team.role'), render: (i) => roleLabel(i.roleCode) },
                      {
                        key: 'expires',
                        header: t('team.expires'),
                        render: (i) => formatDateTime(locale, i.expiresAt),
                      },
                      {
                        key: 'status',
                        header: t('team.status'),
                        render: (i) => (
                          <StatusChip tone={i.status === 'PENDING' ? 'info' : 'warning'}>
                            {t(`invStatus.${i.status}` as never)}
                          </StatusChip>
                        ),
                      },
                      {
                        key: 'actions',
                        header: '',
                        render: (i) => (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void simple(`invitations/${i.id}`, 'DELETE')}
                          >
                            {t('team.revoke')}
                          </Button>
                        ),
                      },
                    ]}
                    rows={
                      team.data.invitations as unknown as Array<
                        InvitationView & Record<string, unknown>
                      >
                    }
                    rowKey={(i) => i.id}
                  />
                </div>
              </Card>
            ) : null}
          </>
        )}

        <Modal
          open={invite}
          onClose={() => setInvite(false)}
          title={t('team.invite')}
          closeLabel={t('common.close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setInvite(false)}>
                {t('common.cancel')}
              </Button>
              <Button loading={cmd.busy} onClick={() => void sendInvite()}>
                {t('team.sendInvite')}
              </Button>
            </>
          }
        >
          <div className="dd-stack">
            {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
            <Field label={t('team.name')} htmlFor="inv-name" error={cmd.fields.name}>
              <Input
                id="inv-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                invalid={!!cmd.fields.name}
              />
            </Field>
            <Field label={t('team.role')} htmlFor="inv-role">
              <Select
                id="inv-role"
                value={form.roleCode}
                onChange={(e) =>
                  setForm({ ...form, roleCode: e.target.value as (typeof ROLE_OPTIONS)[number] })
                }
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>
            {isStaff ? (
              <>
                <Field
                  label={t('rep.mobile')}
                  htmlFor="inv-mobile"
                  error={cmd.fields.mobile}
                  help={t('team.staffHelp')}
                >
                  <Input
                    id="inv-mobile"
                    dir="ltr"
                    inputMode="tel"
                    placeholder="+966500000000"
                    value={form.mobile}
                    onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                    invalid={!!cmd.fields.mobile}
                  />
                </Field>
                <Field label={t('team.branch')} htmlFor="inv-branch" error={cmd.fields.branchId}>
                  <Select
                    id="inv-branch"
                    value={form.branchId}
                    onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                    invalid={!!cmd.fields.branchId}
                  >
                    <option value="">{t('team.chooseBranch')}</option>
                    {activeBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {locale === 'ar' ? b.nameAr : b.nameEn}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : (
              <Field label={t('auth.email')} htmlFor="inv-email" error={cmd.fields.email}>
                <Input
                  id="inv-email"
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  invalid={!!cmd.fields.email}
                />
              </Field>
            )}
          </div>
        </Modal>

        <Modal
          open={!!target}
          onClose={() => setTarget(null)}
          title={target?.action === 'role' ? t('team.changeRole') : t('team.deactivate')}
          closeLabel={t('common.close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={target?.action === 'deactivate' ? 'danger' : 'primary'}
                loading={cmd.busy}
                disabled={target?.action === 'deactivate' && !reason.trim()}
                onClick={() => void applyTarget()}
              >
                {t('common.confirm')}
              </Button>
            </>
          }
        >
          <div className="dd-stack">
            {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
            <strong>{target?.user.name}</strong>
            {target?.action === 'role' ? (
              <>
                <Field label={t('team.role')} htmlFor="tr-role">
                  <Select id="tr-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    {([...ROLE_OPTIONS, 'MERCHANT_OWNER'] as const).map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {newRole === 'MERCHANT_STAFF' ? (
                  <Field label={t('team.branch')} htmlFor="tr-branch">
                    <Select
                      id="tr-branch"
                      value={newBranch}
                      onChange={(e) => setNewBranch(e.target.value)}
                    >
                      <option value="">{t('team.chooseBranch')}</option>
                      {activeBranches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {locale === 'ar' ? b.nameAr : b.nameEn}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </>
            ) : (
              <>
                <p className="dd-muted">{t('team.deactivateHelp')}</p>
                <Field label={t('common.reason')} htmlFor="td-reason">
                  <Textarea
                    id="td-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
        </Modal>
      </div>
    </RequirePermission>
  );
}
