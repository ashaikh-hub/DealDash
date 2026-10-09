export {
  AuthProvider,
  useAuth,
  errorCodeOf,
  type AuthContextValue,
  type AuthState,
} from './auth-context';
export { AppShell } from './app-shell';
export { LoginPanel } from './login-panel';
export { ShellHome } from './shell-home';
export { PlaceholderPage } from './placeholder-page';
export { PwaRegister } from './pwa';
export {
  useApi,
  useResource,
  type ApiResult,
  type Resource,
  type UploadedFile,
  type CallOptions,
} from './api';
export { RequireAuth, RequirePermission, errorMessage, fieldErrors } from './gates';
export { Icon, type IconName } from './deals/icons';
export { DealCardView, DealDetailView, SaveButton, categoryIcon } from './deals/deal-views';
export {
  dateLabel,
  directionsUrl,
  fieldLabel,
  historyReason,
  formatDistance,
  openStatus,
  pickText,
  timeLeftLabel,
  visibleTermLines,
  type OpenStatus,
} from './deals/format';
export { QrCode } from './hot/qr';
export {
  ActivityPanel,
  CasesPanel,
  ConflictsPanel,
  InboxPanel,
  LoyaltyWorkspace,
  OperationsWorkspace,
  type InboxItem,
  type OpsScope,
  type OpsTab,
} from './operations/operations-views';
export {
  LIFECYCLE_TONE,
  PlanUsageWorkspace,
  SubscriptionAdminWorkspace,
  type AmendmentView,
  type ContractView,
  type PlanRow,
  type SubscriptionAdminTab,
  type SubscriptionSummary,
  type UsageLine,
} from './subscription/subscription-views';
export {
  CommercialInputsEditor,
  CommercialPanel,
  CommercialSummary,
  commercialTone,
} from './commercial/commercial-views';
export {
  Countdown,
  countdownTone,
  formatRemaining,
  useServerNow,
  useServerOffset,
} from './hot/countdown';
export {
  HotCardView,
  HotDetailView,
  ReservationTicket,
  type ReserveOutcome,
} from './hot/hot-views';
export { newIdempotencyKey } from '@dealdash/api-client';
export {
  HoldCountdown,
  OrderSummary,
  SavingsLine,
  VoucherCardView,
  VoucherDetailView,
  WALLET_TONE,
  WalletRowView,
  WalletTicket,
} from './vouchers/voucher-views';
export {
  AlertRow,
  CommandCentreWorkspace,
  IntegrationsPanel,
  IntegrationTable,
  PerformanceWorkspace,
  PreferencesPanel,
  SupportTimeline,
  TargetCard,
  metricValue,
  useVisLabel,
  type AlertView,
  type CommandCentreTab,
  type PerformanceTab,
  type TargetView,
} from './visibility/visibility-views';
export { AdminBillingWorkspace, BillingWorkspace, DocumentTable, type AdminBillingTab, type BillingAccount, type BillingTab, type FinanceDoc } from './billing/billing-views';
export { AdminAiWorkspace, AiAssistantPanel, AiDraftsList, AnswerView, type AiAnswer } from './ai/ai-views';
export {
  BudgetMeter,
  Points,
  RewardEntryRow,
  RewardItemCard,
  RewardSummaryCard,
  WATCH_TONE,
  WatchCardView,
  WatchDetailView,
  WatchMonitorView,
  WatchStatusChip,
} from './watch/watch-views';
