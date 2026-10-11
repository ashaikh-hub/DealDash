import { z } from 'zod';

/**
 * Stage 9: launch controls. A controlled pilot can be limited to named merchants / partners, and every market has emergency stops
 * for NEW customer exposure and NEW campaigns. Stops never touch what customers already hold (issued vouchers, held reservations,
 * earned points); they only refuse new actions. Defaults are open (no pilot list, no stop), so nothing changes until DealDash acts.
 */
export const LAUNCH_ACTIONS = [
  'NEW_PURCHASES',
  'NEW_RESERVATIONS',
  'NEW_VIEWS',
  'NEW_CAMPAIGNS',
] as const;
export type LaunchAction = (typeof LAUNCH_ACTIONS)[number];

const stops = z.object({
  NEW_PURCHASES: z.boolean().default(false),
  NEW_RESERVATIONS: z.boolean().default(false),
  NEW_VIEWS: z.boolean().default(false),
  NEW_CAMPAIGNS: z.boolean().default(false),
});

export const launchControlsSchema = z.object({
  pilot: z.object({
    /** OPEN: every enabled merchant / partner. ALLOWLIST: only the listed business accounts take new exposure or launch campaigns. */
    mode: z.enum(['OPEN', 'ALLOWLIST']),
    merchantOrganizationIds: z.array(z.string().uuid()).max(500),
    partnerOrganizationIds: z.array(z.string().uuid()).max(200),
  }),
  /** Emergency stops per market code (e.g. SA). A missing market has no stop. */
  stops: z.record(z.string().length(2), stops),
});
export type LaunchControls = z.infer<typeof launchControlsSchema>;

export const DEFAULT_LAUNCH_CONTROLS: LaunchControls = {
  pilot: { mode: 'OPEN', merchantOrganizationIds: [], partnerOrganizationIds: [] },
  stops: {},
};

/**
 * Stage 9 (B7): the configurations edited through the structured, approved editor. Each value change is a change request decided by
 * a different person; scalar controls carry their allowed range. Anything not listed here is not editable from the controls screen.
 */
export const GOVERNED_SCALARS = {
  'redemption.manual_attempts_per_minute': { group: 'REDEMPTION', min: 1, max: 60 },
  'redemption.reversal_window_hours': { group: 'REDEMPTION', min: 0, max: 168 },
  'reservation.hold_minutes': { group: 'INVENTORY', min: 5, max: 1440 },
  'reservation.max_active': { group: 'INVENTORY', min: 1, max: 20 },
  'vouchers.checkout_hold_minutes': { group: 'INVENTORY', min: 2, max: 60 },
  'auth.otp.max_attempts': { group: 'SECURITY', min: 3, max: 10 },
  'auth.otp.max_requests_per_hour': { group: 'SECURITY', min: 3, max: 30 },
  'auth.password.max_failed_attempts': { group: 'SECURITY', min: 3, max: 10 },
} as const satisfies Record<string, { group: string; min: number; max: number }>;
export type GovernedScalarKey = keyof typeof GOVERNED_SCALARS;
