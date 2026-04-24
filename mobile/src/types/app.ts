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
  rating: number;
  mapsPage: string;
  openingHours: string[];
}

export interface AppOwnedLocation extends AppLocation {
  ownerId: string;
  approval?: boolean | null;
  adminPhone: string;
  adminEmail: string;
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
  hash: string;
  amount: string;
  amountFormatted: string;
  timestamp: number;
  from: string;
  to: string;
  memo?: string;
  direction: "send" | "receive";
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

export interface AppImproverWorkflowFeed {
  activeCredentials: AppCredentialType[];
  workflows: AppWorkflow[];
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

export interface MerchantApplicationDraft {
  place: MerchantPlaceDetails | null;
  description: string;
  businessPhone: string;
  businessEmail: string;
  primaryContactEmail: string;
  primaryContactFirstName: string;
  primaryContactLastName: string;
  primaryContactPhone: string;
  posSystem: string;
  soleProprietorship: string;
  tippingPolicy: string;
  tippingDivision: string;
  tableCoverage: string;
  serviceStations: string;
  tabletModel: string;
  messagingService: string;
  reference: string;
}
