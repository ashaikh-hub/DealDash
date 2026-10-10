'use client';

import { useState } from 'react';
import { useAuth, useResource } from '@dealdash/app-shell';
import { formatDateTime } from '@dealdash/localization';
import { ROLE_CODES } from '@dealdash/types';
import { Button, Card, Field, Input, Select } from '@dealdash/ui';
import { Chip, Loaded, PartnerPage, k, pbase, useCmd, useT } from './utils';

interface TeamView {
  users: Array<{
    membershipId: string;
    name: string | null;
    email: string | null;
    roleCode: string;
    scoped: boolean;
    assignments: number;
    status: string;
    lastActiveAt: string | null;
    isMe: boolean;
  }>;
  invitations: Array<{
    id: string;
    name: string;
    email: string | null;
    roleCode: string;
    status: string;
    expiresAt: string;
  }>;
}
const PARTNER_ROLES = ROLE_CODES.filter((r) => r.startsWith('PARTNER_'));

/** Users and access: invitations, roles, activation and market scope (the shared scoped role assignments). */
export function PartnerUsersPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.users.title')}
      intro={t('pt.users.intro')}
      any={['partner.users.manage']}
      testId="pt-users"
    >
      {(orgId) => <UsersInner orgId={orgId} />}
    </PartnerPage>
  );
}

function UsersInner({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const res = useResource<TeamView>(`${pbase(orgId)}/users`);
  const markets = useResource<Array<{ code: string; nameEn: string; nameAr: string }>>(
    `${pbase(orgId)}/markets`,
  );
  const cmd = useCmd();
  const [inv, setInv] = useState({ name: '', email: '', roleCode: 'PARTNER_ANALYST' });
  const [scope, setScope] = useState({ membershipId: '', market: '' });
  const invite = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/users/invitations`,
      inv,
      t('pt.users.invited'),
    );
    if (r.ok) {
      setInv({ name: '', email: '', roleCode: inv.roleCode });
      await res.reload();
    }
  };
  const act = async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown) => {
    const r = await cmd.run(method, path, body, t('pt.saved'));
    if (r.ok) await res.reload();
  };
  const applyScope = async () => {
    const u = res.data?.users.find((x) => x.membershipId === scope.membershipId);
    if (!u || !scope.market) return;
    const s1 = await cmd.run('POST', `/v1/orgs/${orgId}/members/${u.membershipId}/scoped`, {
      scoped: true,
    });
    if (!s1.ok) return;
    await act(`/v1/orgs/${orgId}/assignments`, 'POST', {
      membershipId: u.membershipId,
      roleCode: u.roleCode,
      scope: { kind: 'COUNTRY', ref: scope.market },
    });
  };
  return (
    <div className="dd-stack" style={{ gap: 16 }}>
      {cmd.banner}
      <Card>
        <h2 className="dd-title">{t('pt.users.invite')}</h2>
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
          data-testid="pt-invite-form"
        >
          <Field label={t('pt.name')} htmlFor="inv-name" error={cmd.fields.name}>
            <Input
              id="inv-name"
              value={inv.name}
              onChange={(e) => setInv({ ...inv, name: e.target.value })}
            />
          </Field>
          <Field label={t('pt.email')} htmlFor="inv-email" error={cmd.fields.email}>
            <Input
              id="inv-email"
              dir="ltr"
              value={inv.email}
              onChange={(e) => setInv({ ...inv, email: e.target.value })}
            />
          </Field>
          <Field label={t('pt.role')} htmlFor="inv-role">
            <Select
              id="inv-role"
              value={inv.roleCode}
              onChange={(e) => setInv({ ...inv, roleCode: e.target.value })}
            >
              {PARTNER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(k('role', r))}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          onClick={() => void invite()}
          loading={cmd.busy}
          data-testid="pt-invite-send"
          style={{ marginBlockStart: 8 }}
        >
          {t('pt.users.send')}
        </Button>
      </Card>

      <Card>
        <Loaded res={res}>
          {(d) => (
            <div className="dd-stack" style={{ gap: 12 }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="dd-table" data-testid="pt-user-table">
                  <thead>
                    <tr>
                      <th>{t('pt.name')}</th>
                      <th>{t('pt.role')}</th>
                      <th>{t('pt.status')}</th>
                      <th>{t('pt.users.lastActive')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.users.map((u) => (
                      <tr key={u.membershipId}>
                        <td>
                          {u.name ?? u.email}{' '}
                          {u.isMe ? <span className="dd-muted">({t('pt.users.you')})</span> : null}
                          <div className="dd-muted dd-ltr" style={{ fontSize: 12 }}>
                            {u.email}
                          </div>
                        </td>
                        <td>
                          {u.isMe ? (
                            t(k('role', u.roleCode))
                          ) : (
                            <Select
                              aria-label={t('pt.users.changeRole')}
                              value={u.roleCode}
                              onChange={(e) =>
                                void act(`${pbase(orgId)}/users/${u.membershipId}/role`, 'PATCH', {
                                  roleCode: e.target.value,
                                })
                              }
                            >
                              {PARTNER_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {t(k('role', r))}
                                </option>
                              ))}
                            </Select>
                          )}
                          <div className="dd-muted" style={{ fontSize: 12 }}>
                            {u.scoped
                              ? t('pt.users.scoped', { n: String(u.assignments) })
                              : t('pt.users.orgWide')}
                          </div>
                        </td>
                        <td>
                          <Chip
                            v={u.status === 'ACTIVE' ? 'OK' : 'SUSPENDED'}
                            label={
                              u.status === 'ACTIVE' ? t('pt.users.active') : t('pt.users.inactive')
                            }
                          />
                        </td>
                        <td className="dd-muted">
                          {u.lastActiveAt ? formatDateTime(locale, u.lastActiveAt) : '—'}
                        </td>
                        <td>
                          {u.isMe ? null : u.status === 'ACTIVE' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void act(
                                  `${pbase(orgId)}/users/${u.membershipId}/deactivate`,
                                  'POST',
                                  { reason: t('pt.users.deactivate') },
                                )
                              }
                            >
                              {t('pt.users.deactivate')}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                void act(
                                  `${pbase(orgId)}/users/${u.membershipId}/reactivate`,
                                  'POST',
                                  { reason: t('pt.users.reactivate') },
                                )
                              }
                            >
                              {t('pt.users.reactivate')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.invitations.length ? (
                <div className="dd-stack" style={{ gap: 6 }} data-testid="pt-invitations">
                  <strong>{t('pt.users.pending')}</strong>
                  {d.invitations.map((i) => (
                    <div
                      key={i.id}
                      className="dd-row"
                      style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}
                    >
                      <span>
                        {i.name} · <span className="dd-ltr">{i.email}</span> ·{' '}
                        {t(k('role', i.roleCode))}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void act(`${pbase(orgId)}/users/invitations/${i.id}`, 'DELETE', undefined)
                        }
                      >
                        {t('pt.users.revoke')}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Loaded>
      </Card>

      <Card>
        <h2 className="dd-title">{t('pt.users.scopeTitle')}</h2>
        <p className="dd-muted">{t('pt.users.scopeHelp')}</p>
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <Field label={t('pt.name')} htmlFor="sc-user">
            <Select
              id="sc-user"
              value={scope.membershipId}
              onChange={(e) => setScope({ ...scope, membershipId: e.target.value })}
            >
              <option value="">—</option>
              {(res.data?.users ?? [])
                .filter((u) => !u.isMe)
                .map((u) => (
                  <option key={u.membershipId} value={u.membershipId}>
                    {u.name ?? u.email}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('pt.market')} htmlFor="sc-market">
            <Select
              id="sc-market"
              value={scope.market}
              onChange={(e) => setScope({ ...scope, market: e.target.value })}
            >
              <option value="">—</option>
              {(markets.data ?? []).map((m) => (
                <option key={m.code} value={m.code}>
                  {locale === 'ar' ? m.nameAr : m.nameEn}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={() => void applyScope()}
          disabled={!scope.membershipId || !scope.market}
          style={{ marginBlockStart: 8 }}
        >
          {t('pt.users.scopeApply')}
        </Button>
      </Card>
    </div>
  );
}
