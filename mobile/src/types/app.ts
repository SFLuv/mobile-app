export interface AppUser {
  id: string;
  name: string;
  primaryWalletAddress?: string;
  contactEmail?: string;
  contactPhone?: string;
  isAdmin: boolean;
  isMerchant: boolean;
  isOrganizer: boolean;
  isImprover: boolean;
  isProposer: boolean;
  isVoter: boolean;
  isIssuer: boolean;
  isSupervisor: boolean;
  isAffiliate: boolean;
  paypalEthAddress: string;
  lastRedemption: number;
  acceptedPrivacyPolicy: boolean;
  acceptedPrivacyPolicyAt?: string | null;
  privacyPolicyVersion: string;
  mailingListOptIn: boolean;
  mailingListOptInAt?: string | null;
  mailingListPolicyVersion: string;
  /**
   * What this person said they were signing up as, answered once at signup.
   * Not interchangeable with `isMerchant`, which is recomputed from approved
   * listings: a merchant whose first location is still being reviewed is
   * `accountType: "merchant"` with `isMerchant: false`. Undefined on a backend
   * that predates the question, which is why nothing keys off "not merchant".
   */
  accountType?: "regular" | "merchant";
  /** Volunteer email list — distinct from `mailingListOptIn`. Undefined = unknown. */
  volunteerListOptIn?: boolean;
}

export type AppImproverStatus = "pending" | "approved" | "rejected";

export interface AppImprover {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  primaryRewardsAccount: string;
  activeCredentials: string[];
  status: AppImproverStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AppUserPolicyStatus {
  userId: string;
  active: boolean;
  acceptedPrivacyPolicy: boolean;
  acceptedPrivacyPolicyAt?: string | null;
  privacyPolicyVersion: string;
  mailingListOptIn: boolean;
  mailingListOptInAt?: string | null;
  mailingListPolicyVersion: string;
}

export interface AppWallet {
  id?: number;
  owner: string;
  name: string;
  isEoa: boolean;
  isHidden: boolean;
  isRedeemer: boolean;
  isMinter: boolean;
  eoaAddress: string;
  smartAddress?: string;
  smartIndex?: number;
}

export interface AppContact {
  id: number;
  owner: string;
  name: string;
  address: string;
  isFavorite: boolean;
}

/** One continuous stretch a location is open, in minutes from midnight. */
export interface AppLocationHoursInterval {
  openMinute: number;
  closeMinute: number;
}

/**
 * One day's opening times. `isClosed` and an empty `intervals` are distinct
 * states: a shop shut on Sunday is not the same as one whose Sunday we never
 * learned.
 */
export interface AppLocationDayHours {
  weekday: number;
  isClosed: boolean;
  intervals: AppLocationHoursInterval[];
}

export interface AppLocation {
  id: number;
  googleId: string;
  name: string;
  payToAddress?: string;
  tipToAddress?: string;
  description: string;
  type: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  phone: string;
  email: string;
  website: string;
  imageUrl: string;
  /** Uploaded map-pin mark. Empty when the merchant has not set one. */
  iconUrl: string;
  rating: number;
  mapsPage: string;
  openingHours: string[];
  /** Structured week, Monday first. Backs the open/closed indicator. */
  hours: AppLocationDayHours[];
}

export interface AppOwnedLocation extends AppLocation {
  ownerId: string;
  /** Tri-state: true approved, false rejected, null still awaiting review. */
  approval?: boolean | null;
  adminPhone: string;
  adminEmail: string;
  /** The Location Approval Form's single Contact field. */
  contactName?: string;
  /** "How did you hear about SFLuv", already resolved past any Other answer. */
  referralSource?: string;
  /** Null on any listing filled in before the form asked. Not a no. */
  acceptsTips?: boolean | null;
  hasStaffTablet?: boolean | null;
  /** Superseded by contactName; still read so an older listing keeps its name. */
  contactFirstname: string;
  contactLastname: string;
  contactPhone: string;
  posSystem: string;
  soleProprietorship: string;
  tippingPolicy: string;
  tippingDivision: string;
  tableCoverage: string;
  serviceStations: number;
  tabletModel: string;
  messagingService: string;
  reference: string;
}

export interface AppMerchantModeDevice {
  id: string;
  userId: string;
  locationId: number;
  locationName: string;
  /** The location's payment wallet as it stands now, not as it stood at enrolment. */
  walletAddress: string;
  locationActive: boolean;
  locationApproved: boolean;
  displayName: string;
  platform: string;
  appVersion: string;
  merchantModeEnabled: boolean;
  enabledAt?: string | null;
  disabledAt?: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppMerchantModeStatus {
  userId: string;
  isMerchant: boolean;
  passcodeSet: boolean;
  device?: AppMerchantModeDevice | null;
  /**
   * Set when the server has just turned merchant mode off for this device —
   * the shop closed, lost approval, or lost its payment wallet. Shown once,
   * then the app returns to the normal wallet.
   */
  forcedExitReason?: string;
}

/** A shop this device can be put to work at. */
export interface AppMerchantModeLocation {
  id: number;
  name: string;
  street: string;
  city: string;
  walletAddress: string;
  tippingWalletAddress: string;
}

export interface AppWalletOwnerLookup {
  found: boolean;
  userId?: string;
  isMerchant: boolean;
  merchantName?: string;
  walletName?: string;
  address: string;
  matchedPrimaryWallet: boolean;
  matchedPaymentWallet: boolean;
  payToAddress?: string;
  tipToAddress?: string;
}

export interface AppTransaction {
  id: string;
  chainId?: number;
  hash: string;
  amount: string;
  amountFormatted: string;
  timestamp: number;
  from: string;
  to: string;
  memo?: string;
  direction: "send" | "receive";
}

export interface AppClientConfig {
  schemaVersion: number;
  configVersion: string;
  environment: string;
  activeChainId: number;
  chainName: string;
  rpcURL: string;
  tokenAddress: string;
  tokenDecimals: number;
  tokenSymbol: string;
  explorerURL?: string;
  appOrigin: string;
  alias: string;
  honeyTokenAddress?: string;
  honeyDecimals?: number;
  byusdTokenAddress?: string;
  byusdDecimals?: number;
  zapperAddress?: string;
  faucetAddress?: string;
  backingAssets: string[];
  maxSmartAccountScan: number;
  wallet: {
    entryPoint: string;
    accountFactory: string;
    paymasterAddress: string;
    paymasterType: "cw-safe";
    backendURL: string;
    backendKind: "cw-engine";
  };
  features: {
    migrationBanner: boolean;
    sendsEnabled: boolean;
    redemptionsEnabled: boolean;
    workflowPayoutsEnabled: boolean;
    merchantPaymentsEnabled: boolean;
    volunteerEventsEnabled: boolean;
  };
  migration: {
    state: string;
    message: string;
    cutoverStartedAt?: string | null;
  };
}

export interface AppClientVersionPolicy {
  schemaVersion: number;
  serverTime: string;
  configVersion: string;
  platform: string;
  status: "ok" | "update_recommended" | "update_required" | "maintenance" | "unsupported_platform";
  minimum: { version: string; build: number };
  recommended: { version: string; build: number };
  current: { version: string; build: number };
  forceUpdate: boolean;
  maintenance: boolean;
  updateUrl: string;
  message: string;
  features: {
    dynamicConfigRequired: boolean;
    celoRequired: boolean;
  };
}

export interface VerifiedEmail {
  id: string;
  userId: string;
  email: string;
  status: "verified" | "pending" | "expired";
  verifiedAt?: string | null;
  verificationSentAt?: string | null;
  verificationTokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AppCredentialType = string;
export type AppCredentialVisibility = "public" | "private" | "unlisted";

export interface AppGlobalCredentialType {
  value: string;
  label: string;
  visibility: AppCredentialVisibility;
  badgeContentType?: string | null;
  badgeDataBase64?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AppCredentialRequest {
  id: string;
  userId: string;
  credentialType: AppCredentialType;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  requesterName: string;
  requesterFirstName: string;
  requesterLastName: string;
  requesterEmail: string;
}

export type AppWorkflowRecurrence = "one_time" | "daily" | "weekly" | "monthly";
export type AppWorkflowPhotoAspectRatio = "vertical" | "square" | "horizontal";

export interface AppWorkflowDropdownOption {
  value: string;
  label: string;
  requiresWrittenResponse: boolean;
  requiresPhotoAttachment?: boolean;
  cameraCaptureOnly?: boolean;
  photoInstructions?: string;
  notifyEmailCount?: number;
  sendPicturesWithEmail?: boolean;
}

export interface AppWorkflowWorkItem {
  id: string;
  stepId: string;
  itemOrder: number;
  title: string;
  description: string;
  optional: boolean;
  requiresPhoto: boolean;
  cameraCaptureOnly: boolean;
  photoRequiredCount: number;
  photoAllowAnyCount: boolean;
  photoAspectRatio: AppWorkflowPhotoAspectRatio;
  requiresWrittenResponse: boolean;
  requiresDropdown: boolean;
  dropdownOptions: AppWorkflowDropdownOption[];
  dropdownRequiresWrittenResponse: Record<string, boolean>;
}

export interface AppWorkflowSubmissionPhoto {
  id: string;
  workflowId: string;
  stepId: string;
  itemId: string;
  submissionId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: number;
}

export interface AppWorkflowStepItemResponse {
  itemId: string;
  photoUrls?: string[];
  photoIds?: string[];
  photos?: AppWorkflowSubmissionPhoto[];
  writtenResponse?: string;
  dropdownValue?: string;
}

export interface AppWorkflowStepSubmission {
  id: string;
  workflowId: string;
  stepId: string;
  improverId: string;
  stepNotPossible: boolean;
  stepNotPossibleDetails?: string | null;
  itemResponses: AppWorkflowStepItemResponse[];
  submittedAt: number;
  updatedAt: number;
}

export interface AppWorkflowRole {
  id: string;
  workflowId: string;
  title: string;
  requiredCredentials: AppCredentialType[];
}

export interface AppWorkflowStep {
  id: string;
  workflowId: string;
  stepOrder: number;
  title: string;
  description: string;
  bounty: number;
  allowStepNotPossible: boolean;
  roleId?: string | null;
  assignedImproverId?: string | null;
  assignedImproverName?: string | null;
  status: "locked" | "available" | "in_progress" | "completed" | "paid_out";
  startedAt?: number | null;
  completedAt?: number | null;
  payoutError?: string | null;
  payoutLastTryAt?: number | null;
  retryRequestedAt?: number | null;
  retryRequestedBy?: string | null;
  submission?: AppWorkflowStepSubmission | null;
  workItems: AppWorkflowWorkItem[];
}

export interface AppWorkflowVotes {
  approve: number;
  deny: number;
  votesCast: number;
  totalVoters: number;
  quorumReached: boolean;
  quorumThreshold: number;
  quorumReachedAt?: number | null;
  finalizeAt?: number | null;
  finalizedAt?: number | null;
  decision?: "approve" | "deny" | "admin_approve" | null;
  myDecision?: "approve" | "deny" | null;
}

export interface AppWorkflowSupervisorDataField {
  key: string;
  value: string;
}

export interface AppWorkflow {
  id: string;
  seriesId: string;
  workflowStateId?: string | null;
  proposerId: string;
  title: string;
  description: string;
  recurrence: AppWorkflowRecurrence;
  recurrenceEndAt?: number | null;
  startAt: number;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "in_progress"
    | "completed"
    | "paid_out"
    | "blocked"
    | "expired"
    | "failed"
    | "skipped"
    | "deleted";
  isStartBlocked: boolean;
  blockedByWorkflowId?: string | null;
  totalBounty: number;
  weeklyBountyRequirement: number;
  budgetWeeklyDeducted: number;
  budgetOneTimeDeducted: number;
  voteQuorumReachedAt?: number | null;
  voteFinalizeAt?: number | null;
  voteFinalizedAt?: number | null;
  voteFinalizedByUserId?: string | null;
  voteDecision?: "approve" | "deny" | "admin_approve" | null;
  supervisorRequired: boolean;
  supervisorUserId?: string | null;
  supervisorBounty: number;
  supervisorDataFields?: AppWorkflowSupervisorDataField[];
  supervisorPaidOutAt?: number | null;
  supervisorPayoutError?: string | null;
  supervisorPayoutLastTryAt?: number | null;
  supervisorRetryRequestedAt?: number | null;
  supervisorRetryRequestedBy?: string | null;
  supervisorTitle?: string | null;
  supervisorOrganization?: string | null;
  createdAt: number;
  updatedAt: number;
  roles: AppWorkflowRole[];
  steps: AppWorkflowStep[];
  votes: AppWorkflowVotes;
}

export interface AppImproverWorkflowStepSummary {
  id: string;
  stepOrder: number;
  title: string;
  status: AppWorkflowStep["status"];
}

export interface AppImproverWorkflowListItem {
  id: string;
  seriesId: string;
  workflowStateId?: string | null;
  proposerId: string;
  title: string;
  description: string;
  recurrence: AppWorkflowRecurrence;
  recurrenceEndAt?: number | null;
  startAt: number;
  status: AppWorkflow["status"];
  isStartBlocked: boolean;
  blockedByWorkflowId?: string | null;
  totalBounty: number;
  weeklyBountyRequirement: number;
  createdAt: number;
  updatedAt: number;
  voteDecision?: AppWorkflow["voteDecision"];
  approvedAt?: number | null;
  isManager: boolean;
  isManagerEligible: boolean;
  hasClaimedStep: boolean;
  hasActiveClaimedStep: boolean;
  assignedSteps: AppImproverWorkflowStepSummary[];
  claimableStep?: AppImproverWorkflowStepSummary | null;
}

export interface AppImproverWorkflowFeed {
  activeCredentials: AppCredentialType[];
  workflows: AppImproverWorkflowListItem[];
  total: number;
  page: number;
  count: number;
}

export interface AppImproverAbsencePeriod {
  id: string;
  improverId: string;
  seriesId: string;
  stepOrder: number;
  absentFrom: number;
  absentUntil: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppImproverAbsencePeriodCreateResult {
  absence: AppImproverAbsencePeriod;
  releasedCount: number;
  skippedCount: number;
}

export interface AppImproverAbsencePeriodDeleteResult {
  id: string;
}

export interface AppImproverWorkflowSeriesUnclaimResult {
  seriesId: string;
  stepOrder: number;
  releasedCount: number;
  skippedCount: number;
}

export type AppVolunteerOrganizerType = "sfluv" | "affiliate";

export interface AppVolunteerOrganizer {
  type: AppVolunteerOrganizerType;
  organizationId?: number | null;
  name: string;
  logoUrl?: string | null;
}

export interface AppVolunteerCoverPhoto {
  url: string;
  width?: number | null;
  height?: number | null;
}

export type AppVolunteerRecurrenceFrequency = "daily" | "weekly" | "monthly";
export type AppVolunteerMonthlyMode = "day_of_month" | "day_of_week";

export interface AppVolunteerRecurrence {
  frequency: AppVolunteerRecurrenceFrequency;
  interval: number;
  weekdays?: string[];
  monthlyMode?: AppVolunteerMonthlyMode | null;
  dayOfMonth?: number | null;
  weekOfMonth?: number | null;
  weekday?: string | null;
  /** Server-rendered human string, e.g. "First Thursday of every month". */
  summary: string;
}

export type AppVolunteerSignupMode = "none" | "external" | "internal";
export type AppVolunteerSignupClosedReason =
  | "full"
  | "ended"
  | "cancelled"
  | "not_open_yet";

export interface AppVolunteerSignupInfo {
  mode: AppVolunteerSignupMode;
  url?: string | null;
  open: boolean;
  closedReason?: AppVolunteerSignupClosedReason | null;
}

export interface AppVolunteerQrStatus {
  live: boolean;
  liveAt?: string | null;
}

export type AppVolunteerEventStatus = "scheduled" | "live" | "ended" | "cancelled";

/**
 * Volunteer events point at real rows in the shared locations table, so the
 * address arrives structured rather than as free text.
 */
export interface AppVolunteerLocation {
  id?: number | null;
  name?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface AppVolunteerViewerState {
  signedUp: boolean;
  signupId?: string | null;
  redeemed: boolean;
}

export interface AppVolunteerEvent {
  id: string;
  seriesId?: string | null;
  /** Non-unique, id remains authoritative. Used to build shareable web links. */
  slug?: string | null;
  title: string;
  description: string;
  coverPhotos: AppVolunteerCoverPhoto[];
  organizer: AppVolunteerOrganizer;
  startAt: string;
  endAt: string;
  timezone?: string | null;
  recurrence?: AppVolunteerRecurrence | null;
  maxParticipants?: number | null;
  signupCount?: number | null;
  spotsRemaining?: number | null;
  rewardAmountSfluv: number;
  signup: AppVolunteerSignupInfo;
  qr: AppVolunteerQrStatus;
  status: AppVolunteerEventStatus;
  location?: AppVolunteerLocation | null;
  viewer?: AppVolunteerViewerState | null;
}

export interface AppVolunteerOrganizerFacet extends AppVolunteerOrganizer {
  eventCount?: number | null;
}

export interface AppVolunteerEventPage {
  events: AppVolunteerEvent[];
  page: number;
  count: number;
  hasMore: boolean;
  total?: number | null;
  organizers: AppVolunteerOrganizerFacet[];
}

export type AppVolunteerEventWindow = "upcoming" | "past" | "all";

export interface AppVolunteerEventQuery {
  page?: number;
  count?: number;
  search?: string;
  /** "sfluv", "affiliate", or "org:<id>". */
  organizer?: string;
  when?: AppVolunteerEventWindow;
  openSignups?: boolean;
}

export interface AppVolunteerSignupInput {
  volunteerListOptIn?: boolean;
}

export interface AppVolunteerSignupResult {
  signupId: string;
  status: string;
  spotsRemaining?: number | null;
  /** Server's post-signup truth for the volunteer email list. Undefined = unstated. */
  volunteerListOptIn?: boolean;
  /**
   * What actually happened to the email-list subscription. A verified account
   * email joins immediately; an unverified one still needs a confirmation mail.
   * Driving copy off this means the app never claims the wrong one.
   */
  volunteerList?: "active" | "pending_confirmation" | "none";
}

/**
 * Server-side because the backend sends the reminder — it needs the value at a
 * time the phone may not be running, so this cannot be a device preference.
 */
export interface AppVolunteerReminderPreferences {
  enabled: boolean;
  hoursBefore: number;
}

export type AppVolunteerSignupFailureReason =
  | "full"
  | "already_signed_up"
  | "closed"
  | "not_internal";

/**
 * Derived from live state rather than stored rows: an entry exists for exactly
 * as long as its condition holds, so there is nothing to dismiss or delete.
 * `seen` is the only part the client controls; resolution removes it on its own.
 */
export interface AppImproverNotification {
  key: string;
  type: string;
  title: string;
  body: string;
  createdAt: number;
  seen: boolean;
  seenAt?: number | null;
  workflowId?: string | null;
  workflowTitle?: string | null;
  stepId?: string | null;
  stepTitle?: string | null;
  isManager: boolean;
  amountSfluv?: number | null;
  payoutError?: string | null;
  /**
   * Where tapping this notification goes, decided server-side. Absent means
   * the notification is text only. `url` exists because some destinations —
   * a partner's signup page, a form we do not host — cannot be mapped from
   * `type` by any client build.
   */
  action?: AppNotificationAction | null;
}

export type AppNotificationAction =
  | { kind: "tax" }
  | { kind: "improver" }
  | { kind: "volunteer" }
  | { kind: "volunteer-event"; eventId: string }
  | { kind: "url"; url: string };

export interface AppImproverNotificationFeed {
  notifications: AppImproverNotification[];
  /** Computed server-side over the whole feed — do not derive from the array. */
  unseenCount: number;
  hasUnseen: boolean;
  total: number;
}

export interface AppWorkflowPhotoUpload {
  fileName: string;
  contentType: string;
  dataBase64: string;
}

export interface AppWorkflowStepCompletionItemInput {
  itemId: string;
  photoIds?: string[];
  photoUploads?: AppWorkflowPhotoUpload[];
  writtenResponse?: string;
  dropdownValue?: string;
}

export interface AppWorkflowStepCompletionInput {
  stepNotPossible?: boolean;
  stepNotPossibleDetails?: string;
  items: AppWorkflowStepCompletionItemInput[];
}

export interface PonderSubscription {
  id: number;
  address: string;
  type: string;
  token?: string;
  email?: string;
  active?: boolean;
  preferenceEnabled?: boolean;
  deviceRegistered?: boolean;
}

export type AppAccountDeletionStatus =
  | "active"
  | "scheduled_for_deletion"
  | "ready_for_manual_purge";

export interface AppAccountDeletionCounts {
  wallets: number;
  contacts: number;
  locations: number;
  locationHours: number;
  locationWallets: number;
  ponderSubscriptions: number;
  verifiedEmails: number;
  memos: number;
}

export interface AppAccountDeletionPreview {
  userId: string;
  status: AppAccountDeletionStatus;
  deleteDate?: string;
  requestedAt?: string;
  canCancel: boolean;
  primaryWalletAddress: string;
  walletAddresses: string[];
  counts: AppAccountDeletionCounts;
  purgeEnabled: boolean;
}

export interface AppAccountDeletionStatusResponse {
  userId: string;
  status: AppAccountDeletionStatus;
  deleteDate?: string;
  requestedAt?: string;
  canceledAt?: string;
  completedAt?: string;
  canCancel: boolean;
  purgeEnabled: boolean;
  purgeEnabledBy?: string;
}

export interface MerchantPlaceCandidate {
  googleId: string;
  name: string;
  addressLine: string;
  rating: number;
  lat: number;
  lng: number;
  types: string[];
}

export interface MerchantPlaceDetails extends AppLocation {}

/**
 * One location's application, in the shape the Location Approval Form collects
 * it. Mirrors the web app's three steps — Public Information, Contact, Payment
 * System — because the two submit to the same endpoint and an answer collected
 * on one platform is read back on the other.
 *
 * The single-sheet draft this replaced carried sole_proprietorship, tipping
 * policy and division, table coverage, service stations, tablet model and
 * messaging service. Those columns still exist and still hold what the
 * merchants already on the map told us, but nothing collects them now.
 */
export interface MerchantApplicationDraft {
  // Public Information
  place: MerchantPlaceDetails | null;
  /** Typed by the merchant only where Google has no name for the place. */
  locationName: string;
  /** Likewise the category: Google's own is used whenever it has one. */
  businessType: string;
  description: string;
  /** Optional, and shown on the map. Need not match the contact phone. */
  publicPhone: string;

  // Contact — internal only, never published
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** "How did you hear about SFLuv"; an Other answer arrives already resolved. */
  referralSource: string;

  // Payment System
  posSystem: string;
  /**
   * Decides whether approval mints this location a tipping wallet, so it is
   * nullable: null is "unanswered", which the form does not allow through but
   * the type has to be able to express before the step is filled in.
   */
  acceptsTips: boolean | null;
  hasStaffTablet: boolean | null;
}
/** One line of the merchant-mode day: a payment, its tip, or one without the other. */
export type MerchantDayRow = {
  at: number;
  /** Base units. Negative on a refund. */
  paymentBase: string;
  tipBase: string;
  from: string;
  paymentHash?: string;
  tipHash?: string;
  refund: boolean;
};

/**
 * The merchant-mode home screen in one payload. Totals are computed server-side
 * so every till agrees, and so the figures cannot drift with the app version.
 */
export type MerchantToday = {
  businessDate: string;
  timeZone: string;
  paymentsBase: string;
  tipsBase: string;
  tokenDecimals: number;
  transactions: MerchantDayRow[];
  /** False when no tipping wallet is configured, or it failed the ownership check. */
  tipsWalletConfigured: boolean;
};


/**
 * What happened when a reward QR was scanned.
 *
 * "escrowed" is a success, not a failure: the code was consumed and the money
 * is the volunteer's, but it waits on a W-9. Treating it as an error would tell
 * someone their reward failed when it did not.
 */
export type RedeemOutcome =
  | { status: "paid" }
  | { status: "escrowed"; amountSfluv: string; taxYear: number; message: string }
  /**
   * Refused, not failed. Past the limit with a hold already open, the backend
   * hands the redemption code back — so this is "do this, then scan again"
   * rather than a lost reward.
   */
  | { status: "blocked"; amountSfluv: string; taxYear: number; message: string };

/** One held or owed payout, as shown in the tax panel. */
export interface AppW9Item {
  source: string;
  sourceLabel: string;
  amountSfluv: string;
  state: string;
  escrowedAt?: string | null;
  expiresAt?: string | null;
}

/**
 * A person's tax position: whether a form is owed, how much is waiting on it,
 * and how long the automatic window has left.
 */
export interface AppW9Status {
  taxYear: number;
  required: boolean;
  filingStatus: string;
  cleared: boolean;
  thresholdSfluv: string;
  earnedSfluv: string;
  escrowedSfluv: string;
  escrowedCount: number;
  /** When the oldest hold leaves the automatic window. After it, releasing needs an admin. */
  escrowExpiresAt?: string | null;
  backPaySfluv: string;
  backPayCount: number;
  formUrl?: string;
  items: AppW9Item[];

  /**
   * The warning this person has reached and not yet answered, if any. Drives
   * which tier modal shows. Null once they file, because clearing a filing
   * deletes the notices behind it.
   */
  tier: AppW9Tier | null;
  tierAcknowledged: boolean;
  /** A payout was actually refused — not merely held. */
  blocked: boolean;
  /**
   * Raw base units, so the progress meter never has to parse a formatted
   * amount back into a number to draw it.
   */
  earnedBase: string;
  thresholdBase: string;
}

/**
 * The four rungs of the escalation. The first two arrive while money is still
 * being paid; the last two arrive after it has stopped.
 */
export type AppW9Tier = "notice_400" | "warning_500" | "escrow_600" | "blocked";
