import { Buffer } from "buffer";
import { ethers } from "ethers";
import { mobileConfig } from "../config";
import {
  AppAccountDeletionPreview,
  AppAccountDeletionStatusResponse,
  AppContact,
  AppCredentialRequest,
  AppGlobalCredentialType,
  AppImprover,
  AppImproverAbsencePeriod,
  AppImproverAbsencePeriodCreateResult,
  AppImproverAbsencePeriodDeleteResult,
  AppImproverWorkflowFeed,
  AppImproverWorkflowListItem,
  AppImproverWorkflowSeriesUnclaimResult,
  AppLocation,
  AppOwnedLocation,
  AppTransaction,
  AppUser,
  AppUserPolicyStatus,
  AppWallet,
  AppWalletOwnerLookup,
  AppWorkflow,
  AppWorkflowPhotoUpload,
  AppWorkflowStepCompletionInput,
  MerchantApplicationDraft,
  PonderSubscription,
  VerifiedEmail,
} from "../types/app";

export class AppBackendAuthError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AppBackendAuthError";
    this.status = status;
  }
}

export class AppBackendRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AppBackendRequestError";
    this.status = status;
  }
}

export class AppBackendPolicyRequiredError extends AppBackendAuthError {
  readonly policyStatus?: AppUserPolicyStatus;

  constructor(message: string, status?: number, policyStatus?: AppUserPolicyStatus) {
    super(message, status);
    this.name = "AppBackendPolicyRequiredError";
    this.policyStatus = policyStatus;
  }
}

type GetUserResponse = {
  user: {
    id: string;
    is_admin: boolean;
    is_merchant: boolean;
    is_organizer: boolean;
    is_improver: boolean;
    is_proposer: boolean;
    is_voter: boolean;
    is_issuer: boolean;
    is_supervisor: boolean;
    is_affiliate: boolean;
    contact_email?: string;
    contact_phone?: string;
    contact_name?: string;
    primary_wallet_address?: string;
    paypal_eth: string;
    last_redemption: number;
    accepted_privacy_policy: boolean;
    accepted_privacy_policy_at?: string | null;
    privacy_policy_version: string;
    mailing_list_opt_in: boolean;
    mailing_list_opt_in_at?: string | null;
    mailing_list_policy_version: string;
  };
  wallets: Array<{
    id?: number;
    owner: string;
    name: string;
    is_eoa: boolean;
    is_hidden: boolean;
    is_redeemer: boolean;
    is_minter: boolean;
    eoa_address: string;
    smart_address?: string | null;
    smart_index?: number | null;
  }>;
  contacts: Array<{
    id: number;
    owner: string;
    name: string;
    address: string;
    is_favorite: boolean;
  }>;
  locations: Array<Record<string, unknown>>;
  improver?: ImproverResponse | null;
};

type ImproverResponse = {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  primary_rewards_account: string;
  active_credentials: string[];
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

type PublicLocationsResponse = {
  locations: Array<Record<string, unknown>>;
};

type TransactionsResponse = {
  transactions: Array<{
    id: string;
    hash: string;
    amount: string;
    timestamp: number;
    from: string;
    to: string;
    memo?: string;
  }>;
  total: number;
};

type VerifiedEmailResponse = Array<{
  id: string;
  user_id: string;
  email: string;
  status: "verified" | "pending" | "expired";
  verified_at?: string | null;
  verification_sent_at?: string | null;
  verification_token_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}>;

type GlobalCredentialTypeResponse = Array<{
  value: string;
  label: string;
  visibility?: "public" | "private" | "unlisted" | null;
  badge_content_type?: string | null;
  badge_data_base64?: string | null;
  created_at: string;
  updated_at?: string | null;
}>;

type CredentialRequestResponse = Array<{
  id: string;
  user_id: string;
  credential_type: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  created_at: string;
  updated_at: string;
  requester_name: string;
  requester_first_name: string;
  requester_last_name: string;
  requester_email: string;
}>;

type WorkflowResponse = {
  id: string;
  series_id: string;
  workflow_state_id?: string | null;
  proposer_id: string;
  title: string;
  description: string;
  recurrence: "one_time" | "daily" | "weekly" | "monthly";
  recurrence_end_at?: number | null;
  start_at: number;
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
  is_start_blocked: boolean;
  blocked_by_workflow_id?: string | null;
  total_bounty: number;
  weekly_bounty_requirement: number;
  budget_weekly_deducted: number;
  budget_one_time_deducted: number;
  vote_quorum_reached_at?: number | null;
  vote_finalize_at?: number | null;
  vote_finalized_at?: number | null;
  vote_finalized_by_user_id?: string | null;
  vote_decision?: "approve" | "deny" | "admin_approve" | null;
  supervisor_required: boolean;
  supervisor_user_id?: string | null;
  supervisor_bounty: number;
  supervisor_data_fields?: Array<{ key: string; value: string }> | null;
  supervisor_paid_out_at?: number | null;
  supervisor_payout_error?: string | null;
  supervisor_payout_last_try_at?: number | null;
  supervisor_retry_requested_at?: number | null;
  supervisor_retry_requested_by?: string | null;
  supervisor_title?: string | null;
  supervisor_organization?: string | null;
  created_at: number;
  updated_at: number;
  roles: Array<{
    id: string;
    workflow_id: string;
    title: string;
    required_credentials: string[];
  }>;
  steps: Array<{
    id: string;
    workflow_id: string;
    step_order: number;
    title: string;
    description: string;
    bounty: number;
    allow_step_not_possible: boolean;
    role_id?: string | null;
    assigned_improver_id?: string | null;
    assigned_improver_name?: string | null;
    status: "locked" | "available" | "in_progress" | "completed" | "paid_out";
    started_at?: number | null;
    completed_at?: number | null;
    payout_error?: string | null;
    payout_last_try_at?: number | null;
    retry_requested_at?: number | null;
    retry_requested_by?: string | null;
    submission?: {
      id: string;
      workflow_id: string;
      step_id: string;
      improver_id: string;
      step_not_possible: boolean;
      step_not_possible_details?: string | null;
      item_responses: Array<{
        item_id: string;
        photo_urls?: string[];
        photo_ids?: string[];
        photos?: Array<{
          id: string;
          workflow_id: string;
          step_id: string;
          item_id: string;
          submission_id: string;
          file_name: string;
          content_type: string;
          size_bytes: number;
          created_at: number;
        }>;
        written_response?: string | null;
        dropdown_value?: string | null;
      }>;
      submitted_at: number;
      updated_at: number;
    } | null;
    work_items: Array<{
      id: string;
      step_id: string;
      item_order: number;
      title: string;
      description: string;
      optional: boolean;
      requires_photo: boolean;
      camera_capture_only: boolean;
      photo_required_count: number;
      photo_allow_any_count: boolean;
      photo_aspect_ratio: "vertical" | "square" | "horizontal";
      requires_written_response: boolean;
      requires_dropdown: boolean;
      dropdown_options: Array<{
        value: string;
        label: string;
        requires_written_response: boolean;
        requires_photo_attachment?: boolean;
        camera_capture_only?: boolean;
        photo_instructions?: string;
        notify_email_count?: number;
        send_pictures_with_email?: boolean;
      }>;
      dropdown_requires_written_response?: Record<string, boolean>;
    }>;
  }>;
  votes: {
    approve: number;
    deny: number;
    votes_cast: number;
    total_voters: number;
    quorum_reached: boolean;
    quorum_threshold: number;
    quorum_reached_at?: number | null;
    finalize_at?: number | null;
    finalized_at?: number | null;
    decision?: "approve" | "deny" | "admin_approve" | null;
    my_decision?: "approve" | "deny" | null;
  };
};

type ImproverWorkflowStepSummaryResponse = {
  id: string;
  step_order: number;
  title: string;
  status: WorkflowResponse["steps"][number]["status"];
};

type ImproverWorkflowListItemResponse = {
  id: string;
  series_id: string;
  workflow_state_id?: string | null;
  proposer_id: string;
  title: string;
  description: string;
  recurrence: WorkflowResponse["recurrence"];
  recurrence_end_at?: number | null;
  start_at: number;
  status: WorkflowResponse["status"];
  is_start_blocked: boolean;
  blocked_by_workflow_id?: string | null;
  total_bounty: number;
  weekly_bounty_requirement: number;
  created_at: number;
  updated_at: number;
  vote_decision?: WorkflowResponse["vote_decision"];
  approved_at?: number | null;
  is_manager: boolean;
  is_manager_eligible: boolean;
  has_claimed_step: boolean;
  has_active_claimed_step: boolean;
  assigned_steps?: ImproverWorkflowStepSummaryResponse[] | null;
  claimable_step?: ImproverWorkflowStepSummaryResponse | null;
};

type ImproverWorkflowFeedResponse = {
  active_credentials: string[];
  workflows: ImproverWorkflowListItemResponse[];
  total?: number;
  page?: number;
  count?: number;
};

type ImproverAbsencePeriodResponse = Array<{
  id: string;
  improver_id: string;
  series_id: string;
  step_order: number;
  absent_from: number;
  absent_until: number;
  created_at: number;
  updated_at: number;
}>;

type ImproverAbsencePeriodCreateResponse = {
  absence: {
    id: string;
    improver_id: string;
    series_id: string;
    step_order: number;
    absent_from: number;
    absent_until: number;
    created_at: number;
    updated_at: number;
  };
  released_count: number;
  skipped_count: number;
};

type ImproverAbsencePeriodDeleteResponse = {
  id: string;
};

type ImproverWorkflowSeriesUnclaimResponse = {
  series_id: string;
  step_order: number;
  released_count: number;
  skipped_count: number;
};

type PonderEntryResponse = {
  id: number;
  address: string;
  type?: string;
  data?: string;
  token?: string;
  active?: boolean;
  preference_enabled?: boolean;
  device_registered?: boolean;
};

type PonderResponse = PonderEntryResponse[] | null;

type PushNotificationSyncOptions = {
  preferenceEnabled?: boolean;
  deviceRegistered?: boolean;
};

type WalletsResponse = Array<{
  id?: number;
  owner: string;
  name: string;
  is_eoa: boolean;
  is_hidden: boolean;
  is_redeemer: boolean;
  is_minter: boolean;
  eoa_address: string;
  smart_address?: string | null;
  smart_index?: number | null;
}>;

type WalletLookupResponse = {
  found?: boolean;
  user_id?: string;
  is_merchant?: boolean;
  merchant_name?: string;
  wallet_name?: string;
  address?: string;
  matched_primary_wallet?: boolean;
  matched_payment_wallet?: boolean;
  pay_to_address?: string;
  tip_to_address?: string;
};

type AccountDeletionPreviewResponse = {
  user_id: string;
  status: "active" | "scheduled_for_deletion" | "ready_for_manual_purge";
  delete_date?: string | null;
  requested_at?: string | null;
  can_cancel: boolean;
  primary_wallet_address: string;
  wallet_addresses: string[];
  counts: {
    wallets: number;
    contacts: number;
    locations: number;
    location_hours: number;
    location_wallets: number;
    ponder_subscriptions: number;
    verified_emails: number;
    memos: number;
  };
  purge_enabled: boolean;
};

type AccountDeletionStatusResponse = {
  user_id: string;
  status: "active" | "scheduled_for_deletion" | "ready_for_manual_purge";
  delete_date?: string | null;
  requested_at?: string | null;
  canceled_at?: string | null;
  completed_at?: string | null;
  can_cancel: boolean;
  purge_enabled: boolean;
  purge_enabled_by?: string;
};

type UserPolicyStatusResponse = {
  user_id: string;
  active: boolean;
  accepted_privacy_policy: boolean;
  accepted_privacy_policy_at?: string | null;
  privacy_policy_version: string;
  mailing_list_opt_in: boolean;
  mailing_list_opt_in_at?: string | null;
  mailing_list_policy_version: string;
};

const POLICY_REQUIRED_HEADER = "X-SFLUV-Auth-Reason";
const POLICY_REQUIRED_REASON = "privacy-policy-required";
const APP_BACKEND_REQUEST_TIMEOUT_MS = 25_000;

function endpoint(path: string): string {
  return `${mobileConfig.appBackendURL.replace(/\/+$/, "")}${path}`;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutID = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeoutID);
  }
}

async function readResponseDetail(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.trim();
  } catch {
    return "";
  }
}

async function throwRequestError(response: Response, fallbackMessage: string): Promise<never> {
  const detail = await readResponseDetail(response);
  const message = detail ? `${fallbackMessage} (${response.status}): ${detail}` : `${fallbackMessage} (${response.status}).`;
  throw new AppBackendRequestError(message, response.status);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapPonderSubscription(
  entry: PonderEntryResponse,
  fallbackType: "merchant" | "push",
  id: number,
): PonderSubscription {
  const type = asString(entry.type, fallbackType);
  const data = asString(entry.data);
  const token = asString(entry.token);
  return {
    id,
    address: entry.address,
    type,
    email: type === "merchant" && data ? data : undefined,
    token: type === "push" && token ? token : undefined,
    active: typeof entry.active === "boolean" ? entry.active : undefined,
    preferenceEnabled:
      typeof entry.preference_enabled === "boolean" ? entry.preference_enabled : undefined,
    deviceRegistered:
      typeof entry.device_registered === "boolean" ? entry.device_registered : undefined,
  };
}

function mapUser(input: GetUserResponse["user"]): AppUser {
  const rawPrimaryWalletAddress = asString(input.primary_wallet_address).trim();
  return {
    id: input.id,
    name: input.contact_name || "SFLUV User",
    primaryWalletAddress: ethers.utils.isAddress(rawPrimaryWalletAddress)
      ? ethers.utils.getAddress(rawPrimaryWalletAddress)
      : undefined,
    contactEmail: input.contact_email,
    contactPhone: input.contact_phone,
    isAdmin: input.is_admin,
    isMerchant: input.is_merchant,
    isOrganizer: input.is_organizer,
    isImprover: input.is_improver,
    isProposer: input.is_proposer,
    isVoter: input.is_voter,
    isIssuer: input.is_issuer,
    isSupervisor: input.is_supervisor,
    isAffiliate: input.is_affiliate,
    paypalEthAddress: input.paypal_eth,
    lastRedemption: input.last_redemption,
    acceptedPrivacyPolicy: input.accepted_privacy_policy === true,
    acceptedPrivacyPolicyAt:
      typeof input.accepted_privacy_policy_at === "string"
        ? input.accepted_privacy_policy_at
        : undefined,
    privacyPolicyVersion: asString(input.privacy_policy_version),
    mailingListOptIn: input.mailing_list_opt_in === true,
    mailingListOptInAt:
      typeof input.mailing_list_opt_in_at === "string"
        ? input.mailing_list_opt_in_at
        : undefined,
    mailingListPolicyVersion: asString(input.mailing_list_policy_version),
  };
}

function mapUserPolicyStatus(input: UserPolicyStatusResponse): AppUserPolicyStatus {
  return {
    userId: input.user_id,
    active: input.active === true,
    acceptedPrivacyPolicy: input.accepted_privacy_policy === true,
    acceptedPrivacyPolicyAt:
      typeof input.accepted_privacy_policy_at === "string"
        ? input.accepted_privacy_policy_at
        : undefined,
    privacyPolicyVersion: asString(input.privacy_policy_version),
    mailingListOptIn: input.mailing_list_opt_in === true,
    mailingListOptInAt:
      typeof input.mailing_list_opt_in_at === "string"
        ? input.mailing_list_opt_in_at
        : undefined,
    mailingListPolicyVersion: asString(input.mailing_list_policy_version),
  };
}

function mapImprover(input: ImproverResponse): AppImprover {
  return {
    userId: input.user_id,
    firstName: input.first_name,
    lastName: input.last_name,
    email: input.email,
    primaryRewardsAccount: input.primary_rewards_account,
    activeCredentials: Array.isArray(input.active_credentials) ? input.active_credentials : [],
    status: input.status,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
  };
}

function normalizeCredentialVisibility(
  value: unknown,
): AppGlobalCredentialType["visibility"] {
  return value === "private" || value === "unlisted" ? value : "public";
}

function mapGlobalCredentialType(
  input: GlobalCredentialTypeResponse[number],
): AppGlobalCredentialType {
  return {
    value: input.value,
    label: input.label,
    visibility: normalizeCredentialVisibility(input.visibility),
    badgeContentType:
      typeof input.badge_content_type === "string" ? input.badge_content_type : undefined,
    badgeDataBase64:
      typeof input.badge_data_base64 === "string" ? input.badge_data_base64 : undefined,
    createdAt: input.created_at,
    updatedAt: typeof input.updated_at === "string" ? input.updated_at : undefined,
  };
}

function mapCredentialRequest(
  input: CredentialRequestResponse[number],
): AppCredentialRequest {
  return {
    id: input.id,
    userId: input.user_id,
    credentialType: input.credential_type,
    status: input.status,
    requestedAt: input.requested_at,
    resolvedAt: typeof input.resolved_at === "string" ? input.resolved_at : undefined,
    resolvedBy: typeof input.resolved_by === "string" ? input.resolved_by : undefined,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
    requesterName: input.requester_name,
    requesterFirstName: input.requester_first_name,
    requesterLastName: input.requester_last_name,
    requesterEmail: input.requester_email,
  };
}

function mapWorkflowSubmissionPhoto(
  input: NonNullable<
    NonNullable<
      NonNullable<WorkflowResponse["steps"][number]["submission"]>["item_responses"][number]["photos"]
    >[number]
  >,
) {
  return {
    id: input.id,
    workflowId: input.workflow_id,
    stepId: input.step_id,
    itemId: input.item_id,
    submissionId: input.submission_id,
    fileName: input.file_name,
    contentType: input.content_type,
    sizeBytes: input.size_bytes,
    createdAt: input.created_at,
  };
}

function mapWorkflowStepItemResponse(
  input: NonNullable<
    NonNullable<WorkflowResponse["steps"][number]["submission"]>["item_responses"]
  >[number],
) {
  return {
    itemId: input.item_id,
    photoUrls: Array.isArray(input.photo_urls) ? input.photo_urls : undefined,
    photoIds: Array.isArray(input.photo_ids) ? input.photo_ids : undefined,
    photos: Array.isArray(input.photos)
      ? input.photos.map(mapWorkflowSubmissionPhoto)
      : undefined,
    writtenResponse:
      typeof input.written_response === "string" ? input.written_response : undefined,
    dropdownValue:
      typeof input.dropdown_value === "string" ? input.dropdown_value : undefined,
  };
}

function mapWorkflowStepSubmission(
  input: NonNullable<WorkflowResponse["steps"][number]["submission"]>,
) {
  return {
    id: input.id,
    workflowId: input.workflow_id,
    stepId: input.step_id,
    improverId: input.improver_id,
    stepNotPossible: input.step_not_possible === true,
    stepNotPossibleDetails:
      typeof input.step_not_possible_details === "string"
        ? input.step_not_possible_details
        : undefined,
    itemResponses: Array.isArray(input.item_responses)
      ? input.item_responses.map(mapWorkflowStepItemResponse)
      : [],
    submittedAt: input.submitted_at,
    updatedAt: input.updated_at,
  };
}

function mapWorkflowDropdownOption(
  input: WorkflowResponse["steps"][number]["work_items"][number]["dropdown_options"][number],
) {
  return {
    value: input.value,
    label: input.label,
    requiresWrittenResponse: input.requires_written_response === true,
    requiresPhotoAttachment: input.requires_photo_attachment === true,
    cameraCaptureOnly: input.camera_capture_only === true,
    photoInstructions:
      typeof input.photo_instructions === "string" ? input.photo_instructions : undefined,
    notifyEmailCount:
      typeof input.notify_email_count === "number" ? input.notify_email_count : undefined,
    sendPicturesWithEmail: input.send_pictures_with_email === true,
  };
}

function normalizePhotoAspectRatio(
  value: unknown,
): "vertical" | "square" | "horizontal" {
  return value === "vertical" || value === "horizontal" ? value : "square";
}

function mapWorkflowWorkItem(
  input: WorkflowResponse["steps"][number]["work_items"][number],
) {
  return {
    id: input.id,
    stepId: input.step_id,
    itemOrder: input.item_order,
    title: input.title,
    description: input.description,
    optional: input.optional === true,
    requiresPhoto: input.requires_photo === true,
    cameraCaptureOnly: input.camera_capture_only === true,
    photoRequiredCount: input.photo_required_count,
    photoAllowAnyCount: input.photo_allow_any_count === true,
    photoAspectRatio: normalizePhotoAspectRatio(input.photo_aspect_ratio),
    requiresWrittenResponse: input.requires_written_response === true,
    requiresDropdown: input.requires_dropdown === true,
    dropdownOptions: Array.isArray(input.dropdown_options)
      ? input.dropdown_options.map(mapWorkflowDropdownOption)
      : [],
    dropdownRequiresWrittenResponse:
      input.dropdown_requires_written_response &&
      typeof input.dropdown_requires_written_response === "object"
        ? input.dropdown_requires_written_response
        : {},
  };
}

function mapWorkflowStep(input: WorkflowResponse["steps"][number]) {
  return {
    id: input.id,
    workflowId: input.workflow_id,
    stepOrder: input.step_order,
    title: input.title,
    description: input.description,
    bounty: input.bounty,
    allowStepNotPossible: input.allow_step_not_possible === true,
    roleId: typeof input.role_id === "string" ? input.role_id : undefined,
    assignedImproverId:
      typeof input.assigned_improver_id === "string" ? input.assigned_improver_id : undefined,
    assignedImproverName:
      typeof input.assigned_improver_name === "string"
        ? input.assigned_improver_name
        : undefined,
    status: input.status,
    startedAt: typeof input.started_at === "number" ? input.started_at : undefined,
    completedAt:
      typeof input.completed_at === "number" ? input.completed_at : undefined,
    payoutError:
      typeof input.payout_error === "string" ? input.payout_error : undefined,
    payoutLastTryAt:
      typeof input.payout_last_try_at === "number" ? input.payout_last_try_at : undefined,
    retryRequestedAt:
      typeof input.retry_requested_at === "number"
        ? input.retry_requested_at
        : undefined,
    retryRequestedBy:
      typeof input.retry_requested_by === "string" ? input.retry_requested_by : undefined,
    submission: input.submission ? mapWorkflowStepSubmission(input.submission) : undefined,
    workItems: Array.isArray(input.work_items)
      ? input.work_items.map(mapWorkflowWorkItem)
      : [],
  };
}

function mapWorkflowVotes(input: WorkflowResponse["votes"]) {
  return {
    approve: input.approve,
    deny: input.deny,
    votesCast: input.votes_cast,
    totalVoters: input.total_voters,
    quorumReached: input.quorum_reached === true,
    quorumThreshold: input.quorum_threshold,
    quorumReachedAt:
      typeof input.quorum_reached_at === "number" ? input.quorum_reached_at : undefined,
    finalizeAt:
      typeof input.finalize_at === "number" ? input.finalize_at : undefined,
    finalizedAt:
      typeof input.finalized_at === "number" ? input.finalized_at : undefined,
    decision: input.decision,
    myDecision: input.my_decision,
  };
}

function mapWorkflow(input: WorkflowResponse): AppWorkflow {
  return {
    id: input.id,
    seriesId: input.series_id,
    workflowStateId:
      typeof input.workflow_state_id === "string" ? input.workflow_state_id : undefined,
    proposerId: input.proposer_id,
    title: input.title,
    description: input.description,
    recurrence: input.recurrence,
    recurrenceEndAt:
      typeof input.recurrence_end_at === "number" ? input.recurrence_end_at : undefined,
    startAt: input.start_at,
    status: input.status,
    isStartBlocked: input.is_start_blocked === true,
    blockedByWorkflowId:
      typeof input.blocked_by_workflow_id === "string"
        ? input.blocked_by_workflow_id
        : undefined,
    totalBounty: input.total_bounty,
    weeklyBountyRequirement: input.weekly_bounty_requirement,
    budgetWeeklyDeducted: input.budget_weekly_deducted,
    budgetOneTimeDeducted: input.budget_one_time_deducted,
    voteQuorumReachedAt:
      typeof input.vote_quorum_reached_at === "number"
        ? input.vote_quorum_reached_at
        : undefined,
    voteFinalizeAt:
      typeof input.vote_finalize_at === "number" ? input.vote_finalize_at : undefined,
    voteFinalizedAt:
      typeof input.vote_finalized_at === "number" ? input.vote_finalized_at : undefined,
    voteFinalizedByUserId:
      typeof input.vote_finalized_by_user_id === "string"
        ? input.vote_finalized_by_user_id
        : undefined,
    voteDecision: input.vote_decision,
    supervisorRequired: input.supervisor_required === true,
    supervisorUserId:
      typeof input.supervisor_user_id === "string" ? input.supervisor_user_id : undefined,
    supervisorBounty: input.supervisor_bounty,
    supervisorDataFields: Array.isArray(input.supervisor_data_fields)
      ? input.supervisor_data_fields.map((field) => ({
          key: field.key,
          value: field.value,
        }))
      : [],
    supervisorPaidOutAt:
      typeof input.supervisor_paid_out_at === "number"
        ? input.supervisor_paid_out_at
        : undefined,
    supervisorPayoutError:
      typeof input.supervisor_payout_error === "string"
        ? input.supervisor_payout_error
        : undefined,
    supervisorPayoutLastTryAt:
      typeof input.supervisor_payout_last_try_at === "number"
        ? input.supervisor_payout_last_try_at
        : undefined,
    supervisorRetryRequestedAt:
      typeof input.supervisor_retry_requested_at === "number"
        ? input.supervisor_retry_requested_at
        : undefined,
    supervisorRetryRequestedBy:
      typeof input.supervisor_retry_requested_by === "string"
        ? input.supervisor_retry_requested_by
        : undefined,
    supervisorTitle:
      typeof input.supervisor_title === "string" ? input.supervisor_title : undefined,
    supervisorOrganization:
      typeof input.supervisor_organization === "string"
        ? input.supervisor_organization
        : undefined,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
    roles: Array.isArray(input.roles)
      ? input.roles.map((role) => ({
          id: role.id,
          workflowId: role.workflow_id,
          title: role.title,
          requiredCredentials: Array.isArray(role.required_credentials)
            ? role.required_credentials
            : [],
        }))
      : [],
    steps: Array.isArray(input.steps) ? input.steps.map(mapWorkflowStep) : [],
    votes: mapWorkflowVotes(input.votes),
  };
}

function mapImproverWorkflowStepSummary(
  input: ImproverWorkflowStepSummaryResponse,
): AppImproverWorkflowListItem["assignedSteps"][number] {
  return {
    id: input.id,
    stepOrder: input.step_order,
    title: input.title,
    status: input.status,
  };
}

function mapImproverWorkflowListItem(
  input: ImproverWorkflowListItemResponse,
): AppImproverWorkflowListItem {
  return {
    id: input.id,
    seriesId: input.series_id,
    workflowStateId:
      typeof input.workflow_state_id === "string" ? input.workflow_state_id : undefined,
    proposerId: input.proposer_id,
    title: input.title,
    description: input.description,
    recurrence: input.recurrence,
    recurrenceEndAt:
      typeof input.recurrence_end_at === "number" ? input.recurrence_end_at : undefined,
    startAt: input.start_at,
    status: input.status,
    isStartBlocked: input.is_start_blocked === true,
    blockedByWorkflowId:
      typeof input.blocked_by_workflow_id === "string"
        ? input.blocked_by_workflow_id
        : undefined,
    totalBounty: input.total_bounty,
    weeklyBountyRequirement: input.weekly_bounty_requirement,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
    voteDecision: input.vote_decision,
    approvedAt: typeof input.approved_at === "number" ? input.approved_at : undefined,
    isManager: input.is_manager === true,
    isManagerEligible: input.is_manager_eligible === true,
    hasClaimedStep: input.has_claimed_step === true,
    hasActiveClaimedStep: input.has_active_claimed_step === true,
    assignedSteps: Array.isArray(input.assigned_steps)
      ? input.assigned_steps.map(mapImproverWorkflowStepSummary)
      : [],
    claimableStep: input.claimable_step
      ? mapImproverWorkflowStepSummary(input.claimable_step)
      : null,
  };
}

function mapImproverAbsencePeriod(
  input: ImproverAbsencePeriodResponse[number],
): AppImproverAbsencePeriod {
  return {
    id: input.id,
    improverId: input.improver_id,
    seriesId: input.series_id,
    stepOrder: input.step_order,
    absentFrom: input.absent_from,
    absentUntil: input.absent_until,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
  };
}

function mapWallet(input: WalletsResponse[number]): AppWallet {
  return {
    id: typeof input.id === "number" ? input.id : undefined,
    owner: input.owner,
    name: input.name,
    isEoa: input.is_eoa,
    isHidden: input.is_hidden,
    isRedeemer: input.is_redeemer,
    isMinter: input.is_minter,
    eoaAddress: ethers.utils.getAddress(input.eoa_address),
    smartAddress: input.smart_address ? ethers.utils.getAddress(input.smart_address) : undefined,
    smartIndex: typeof input.smart_index === "number" ? input.smart_index : undefined,
  };
}

function mapContact(input: GetUserResponse["contacts"][number]): AppContact {
  return {
    id: input.id,
    owner: input.owner,
    name: input.name,
    address: ethers.utils.getAddress(input.address),
    isFavorite: input.is_favorite,
  };
}

function mapLocation(input: Record<string, unknown>): AppLocation {
  const rawPayToAddress = asString(input.pay_to_address).trim();
  const rawTipToAddress = asString(input.tip_to_address).trim();
  return {
    id: asNumber(input.id),
    googleId: asString(input.google_id),
    name: asString(input.name),
    payToAddress: ethers.utils.isAddress(rawPayToAddress) ? ethers.utils.getAddress(rawPayToAddress) : undefined,
    tipToAddress: ethers.utils.isAddress(rawTipToAddress) ? ethers.utils.getAddress(rawTipToAddress) : undefined,
    description: asString(input.description),
    type: asString(input.type),
    street: asString(input.street),
    city: asString(input.city),
    state: asString(input.state),
    zip: asString(input.zip),
    lat: asNumber(input.lat),
    lng: asNumber(input.lng),
    phone: asString(input.phone),
    email: asString(input.email),
    website: asString(input.website),
    imageUrl: asString(input.image_url),
    rating: asNumber(input.rating),
    mapsPage: asString(input.maps_page),
    openingHours: Array.isArray(input.opening_hours) ? input.opening_hours.map((value) => asString(value)) : [],
  };
}

function mapOwnedLocation(input: Record<string, unknown>): AppOwnedLocation {
  return {
    ...mapLocation(input),
    ownerId: asString(input.owner_id),
    approval: typeof input.approval === "boolean" ? input.approval : null,
    adminPhone: asString(input.admin_phone),
    adminEmail: asString(input.admin_email),
    contactFirstname: asString(input.contact_firstname),
    contactLastname: asString(input.contact_lastname),
    contactPhone: asString(input.contact_phone),
    posSystem: asString(input.pos_system),
    soleProprietorship: asString(input.sole_proprietorship),
    tippingPolicy: asString(input.tipping_policy),
    tippingDivision: asString(input.tipping_division),
    tableCoverage: asString(input.table_coverage),
    serviceStations: asNumber(input.service_stations),
    tabletModel: asString(input.tablet_model),
    messagingService: asString(input.messaging_service),
    reference: asString(input.reference),
  };
}

function mapWalletOwnerLookup(input: WalletLookupResponse, fallbackAddress: string): AppWalletOwnerLookup | null {
  if (!input.found) {
    return null;
  }

  const normalizedMatchedAddress = asString(input.address).trim();
  const rawPayToAddress = asString(input.pay_to_address).trim();
  const rawTipToAddress = asString(input.tip_to_address).trim();

  return {
    found: true,
    userId: asString(input.user_id) || undefined,
    isMerchant: Boolean(input.is_merchant),
    merchantName: asString(input.merchant_name) || undefined,
    walletName: asString(input.wallet_name) || undefined,
    address: ethers.utils.isAddress(normalizedMatchedAddress)
      ? ethers.utils.getAddress(normalizedMatchedAddress)
      : fallbackAddress,
    matchedPrimaryWallet: input.matched_primary_wallet === true,
    matchedPaymentWallet: input.matched_payment_wallet === true,
    payToAddress: ethers.utils.isAddress(rawPayToAddress) ? ethers.utils.getAddress(rawPayToAddress) : undefined,
    tipToAddress: ethers.utils.isAddress(rawTipToAddress) ? ethers.utils.getAddress(rawTipToAddress) : undefined,
  };
}

function mapAccountDeletionPreview(input: AccountDeletionPreviewResponse): AppAccountDeletionPreview {
  return {
    userId: input.user_id,
    status: input.status,
    deleteDate: input.delete_date || undefined,
    requestedAt: input.requested_at || undefined,
    canCancel: input.can_cancel,
    primaryWalletAddress: input.primary_wallet_address,
    walletAddresses: Array.isArray(input.wallet_addresses) ? input.wallet_addresses : [],
    counts: {
      wallets: asNumber(input.counts?.wallets),
      contacts: asNumber(input.counts?.contacts),
      locations: asNumber(input.counts?.locations),
      locationHours: asNumber(input.counts?.location_hours),
      locationWallets: asNumber(input.counts?.location_wallets),
      ponderSubscriptions: asNumber(input.counts?.ponder_subscriptions),
      verifiedEmails: asNumber(input.counts?.verified_emails),
      memos: asNumber(input.counts?.memos),
    },
    purgeEnabled: input.purge_enabled === true,
  };
}

function mapAccountDeletionStatus(input: AccountDeletionStatusResponse): AppAccountDeletionStatusResponse {
  return {
    userId: input.user_id,
    status: input.status,
    deleteDate: input.delete_date || undefined,
    requestedAt: input.requested_at || undefined,
    canceledAt: input.canceled_at || undefined,
    completedAt: input.completed_at || undefined,
    canCancel: input.can_cancel,
    purgeEnabled: input.purge_enabled === true,
    purgeEnabledBy: typeof input.purge_enabled_by === "string" ? input.purge_enabled_by : undefined,
  };
}

function formatTokenAmount(raw: string): string {
  try {
    const formatted = ethers.utils.formatUnits(raw, mobileConfig.tokenDecimals);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmed = fraction.replace(/0+$/, "");
    if (!trimmed) {
      return whole;
    }
    return `${whole}.${trimmed.slice(0, 4)}`;
  } catch {
    return "0";
  }
}

export class AppBackendClient {
  constructor(private readonly getAccessToken: () => Promise<string | null>) {}

  private async rawAuthFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AppBackendAuthError("Privy could not provide a backend access token. Please sign out and sign in again.");
    }
    const extraHeaders = (options.headers || {}) as Record<string, string>;
    const headers: Record<string, string> = {
      ...extraHeaders,
      "Access-Token": accessToken,
    };
    let response: Response;
    try {
      response = await fetchWithTimeout(
        endpoint(path),
        { ...options, headers },
        APP_BACKEND_REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      throw new AppBackendRequestError(
        `Unable to reach the shared app backend at ${mobileConfig.appBackendURL}. ${(error as Error)?.message ?? ""}`.trim(),
      );
    }

    return response;
  }

  private async authFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const response = await this.rawAuthFetch(path, options);
    if (response.status === 401 || response.status === 403) {
      if (
        response.status === 403 &&
        response.headers.get(POLICY_REQUIRED_HEADER) === POLICY_REQUIRED_REASON
      ) {
        let policyStatus: AppUserPolicyStatus | undefined;
        try {
          policyStatus = (await this.getUserPolicyStatus()) ?? undefined;
        } catch {
          policyStatus = undefined;
        }
        const detail = await readResponseDetail(response);
        const message = detail
          ? `Shared app backend requires privacy policy acceptance (${response.status}): ${detail}`
          : "Shared app backend requires privacy policy acceptance before this request can continue.";
        throw new AppBackendPolicyRequiredError(message, response.status, policyStatus);
      }

      const detail = await readResponseDetail(response);
      const message = detail
        ? `Shared app backend rejected this Privy session (${response.status}): ${detail}`
        : "Shared app backend rejected this Privy session. Please sign out and sign in again.";
      throw new AppBackendAuthError(message, response.status);
    }

    return response;
  }

  async ensureUser(): Promise<{
    user: AppUser;
    wallets: AppWallet[];
    contacts: AppContact[];
    locations: AppOwnedLocation[];
    improver: AppImprover | null;
  }> {
    let policyStatus = await this.getUserPolicyStatus();
    if (policyStatus === null) {
      const created = await this.rawAuthFetch("/users", { method: "POST" });
      if (!created.ok) {
        await throwRequestError(created, "Unable to create user profile in the shared app backend");
      }
      policyStatus = await this.getUserPolicyStatus();
    }
    if (policyStatus && !policyStatus.acceptedPrivacyPolicy) {
      throw new AppBackendPolicyRequiredError(
        "You need to accept the privacy policy before using the shared app features.",
        403,
        policyStatus,
      );
    }

    const response = await this.authFetch("/users");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load user profile from the shared app backend");
    }

    const body = (await response.json()) as GetUserResponse;
    return {
      user: mapUser(body.user),
      wallets: Array.isArray(body.wallets) ? body.wallets.map(mapWallet) : [],
      contacts: Array.isArray(body.contacts) ? body.contacts.map(mapContact) : [],
      locations: Array.isArray(body.locations) ? body.locations.map(mapOwnedLocation) : [],
      improver: body.improver ? mapImprover(body.improver) : null,
    };
  }

  async getUserPolicyStatus(): Promise<AppUserPolicyStatus | null> {
    const response = await this.rawAuthFetch("/users/policy-status");
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      await throwRequestError(response, "Unable to load the shared app privacy-policy status");
    }
    const body = (await response.json()) as UserPolicyStatusResponse;
    return mapUserPolicyStatus(body);
  }

  async acceptUserPolicies(mailingListOptIn: boolean): Promise<AppUserPolicyStatus> {
    const response = await this.rawAuthFetch("/users/policies/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accepted_privacy_policy: true,
        mailing_list_opt_in: mailingListOptIn,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to save the shared app privacy-policy preferences");
    }
    const body = (await response.json()) as UserPolicyStatusResponse;
    return mapUserPolicyStatus(body);
  }

  async getDeleteAccountStatus(): Promise<AppAccountDeletionStatusResponse | null> {
    const response = await this.rawAuthFetch("/users/delete-account/status");
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      await throwRequestError(response, "Unable to load account deletion status from the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionStatusResponse;
    return mapAccountDeletionStatus(body);
  }

  async getDeleteAccountPreview(): Promise<AppAccountDeletionPreview> {
    const response = await this.authFetch("/users/delete-account/preview");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load account deletion preview from the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionPreviewResponse;
    return mapAccountDeletionPreview(body);
  }

  async deleteAccount(): Promise<AppAccountDeletionStatusResponse> {
    const response = await this.authFetch("/users/delete-account", {
      method: "POST",
    });
    if (response.status !== 202) {
      await throwRequestError(response, "Unable to schedule account deletion in the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionStatusResponse;
    return mapAccountDeletionStatus(body);
  }

  async cancelDeleteAccount(): Promise<AppAccountDeletionStatusResponse> {
    const response = await this.rawAuthFetch("/users/delete-account/cancel", {
      method: "POST",
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to reactivate this account in the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionStatusResponse;
    return mapAccountDeletionStatus(body);
  }

  async storeAppleOAuthCredential(input: {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresInSeconds?: number;
    refreshTokenExpiresInSeconds?: number;
    scopes?: string[];
    providerSubject?: string;
    providerEmail?: string;
    isPrivateRelay?: boolean;
  }): Promise<void> {
    const response = await this.authFetch("/users/oauth/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: input.accessToken,
        refresh_token: input.refreshToken ?? "",
        access_token_expires_in_seconds: input.accessTokenExpiresInSeconds ?? 0,
        refresh_token_expires_in_seconds: input.refreshTokenExpiresInSeconds ?? 0,
        scopes: Array.isArray(input.scopes) ? input.scopes : [],
        provider_subject: input.providerSubject ?? "",
        provider_email: input.providerEmail ?? "",
        is_private_relay: input.isPrivateRelay === true,
      }),
    });

    if (!response.ok) {
      await throwRequestError(response, "Unable to store Apple OAuth credentials in the shared app backend");
    }
  }

  async updateUserInfo(input: {
    name?: string;
    email?: string;
    phone?: string;
  }): Promise<void> {
    const response = await this.authFetch("/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_name: input.name?.trim() || undefined,
        contact_email: input.email?.trim() || undefined,
        contact_phone: input.phone?.trim() || undefined,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update your user profile");
    }
  }

  async requestImproverStatus(input: {
    firstName: string;
    lastName: string;
    email: string;
  }): Promise<AppImprover> {
    const response = await this.authFetch("/improvers/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        email: input.email.trim(),
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to request improver status");
    }
    const body = (await response.json()) as ImproverResponse;
    return mapImprover(body);
  }

  async getCredentialTypes(): Promise<AppGlobalCredentialType[]> {
    const response = await this.authFetch("/credentials/types");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load credential types");
    }
    const body = (await response.json()) as GlobalCredentialTypeResponse;
    return Array.isArray(body) ? body.map(mapGlobalCredentialType) : [];
  }

  async getImproverWorkflows(
    scope?: "assigned" | "claimed" | "mine" | "board" | "claimable",
  ): Promise<AppImproverWorkflowFeed> {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    const response = await this.authFetch(`/improvers/workflows${query}`);
    if (!response.ok) {
      await throwRequestError(response, "Unable to load improver workflows");
    }
    const body = (await response.json()) as ImproverWorkflowFeedResponse;
    return {
      activeCredentials: Array.isArray(body.active_credentials)
        ? body.active_credentials
        : [],
      workflows: Array.isArray(body.workflows) ? body.workflows.map(mapImproverWorkflowListItem) : [],
      total:
        typeof body.total === "number"
          ? body.total
          : Array.isArray(body.workflows)
            ? body.workflows.length
            : 0,
      page: typeof body.page === "number" ? body.page : 0,
      count:
        typeof body.count === "number"
          ? body.count
          : Array.isArray(body.workflows)
            ? body.workflows.length
            : 0,
    };
  }

  async getImproverUnpaidWorkflows(): Promise<AppWorkflow[]> {
    const response = await this.authFetch("/improvers/unpaid-workflows");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load unpaid workflows");
    }
    const body = (await response.json()) as WorkflowResponse[];
    return Array.isArray(body) ? body.map(mapWorkflow) : [];
  }

  async updateImproverPrimaryRewardsAccount(
    primaryRewardsAccount: string,
  ): Promise<AppImprover> {
    const response = await this.authFetch("/improvers/primary-rewards-account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_rewards_account: primaryRewardsAccount.trim(),
      }),
    });
    if (!response.ok) {
      await throwRequestError(
        response,
        "Unable to update your improver rewards wallet",
      );
    }
    const body = (await response.json()) as ImproverResponse;
    return mapImprover(body);
  }

  async getImproverCredentialRequests(): Promise<AppCredentialRequest[]> {
    const response = await this.authFetch("/improvers/credential-requests");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load credential requests");
    }
    const body = (await response.json()) as CredentialRequestResponse;
    return Array.isArray(body) ? body.map(mapCredentialRequest) : [];
  }

  async createImproverCredentialRequest(
    credentialType: string,
    allowUnlisted = false,
  ): Promise<AppCredentialRequest> {
    const response = await this.authFetch("/improvers/credential-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credential_type: credentialType.trim(),
        allow_unlisted: allowUnlisted,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to submit credential request");
    }
    const body = (await response.json()) as CredentialRequestResponse[number];
    return mapCredentialRequest(body);
  }

  async getImproverAbsencePeriods(): Promise<AppImproverAbsencePeriod[]> {
    const response = await this.authFetch("/improvers/workflows/absence-periods");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load improver absence coverage");
    }
    const body = (await response.json()) as ImproverAbsencePeriodResponse;
    return Array.isArray(body) ? body.map(mapImproverAbsencePeriod) : [];
  }

  async createImproverAbsencePeriod(input: {
    seriesId: string;
    stepOrder: number;
    absentFrom: string;
    absentUntil: string;
  }): Promise<AppImproverAbsencePeriodCreateResult> {
    const response = await this.authFetch("/improvers/workflows/absence-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        series_id: input.seriesId,
        step_order: input.stepOrder,
        absent_from: input.absentFrom,
        absent_until: input.absentUntil,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to create improver absence period");
    }
    const body = (await response.json()) as ImproverAbsencePeriodCreateResponse;
    return {
      absence: mapImproverAbsencePeriod(body.absence),
      releasedCount: body.released_count,
      skippedCount: body.skipped_count,
    };
  }

  async updateImproverAbsencePeriod(
    absenceId: string,
    input: { absentFrom: string; absentUntil: string },
  ): Promise<AppImproverAbsencePeriodCreateResult> {
    const response = await this.authFetch(
      `/improvers/workflows/absence-periods/${encodeURIComponent(absenceId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          absent_from: input.absentFrom,
          absent_until: input.absentUntil,
        }),
      },
    );
    if (!response.ok) {
      await throwRequestError(response, "Unable to update improver absence period");
    }
    const body = (await response.json()) as ImproverAbsencePeriodCreateResponse;
    return {
      absence: mapImproverAbsencePeriod(body.absence),
      releasedCount: body.released_count,
      skippedCount: body.skipped_count,
    };
  }

  async deleteImproverAbsencePeriod(
    absenceId: string,
  ): Promise<AppImproverAbsencePeriodDeleteResult> {
    const response = await this.authFetch(
      `/improvers/workflows/absence-periods/${encodeURIComponent(absenceId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      await throwRequestError(response, "Unable to delete improver absence period");
    }
    const body = (await response.json()) as ImproverAbsencePeriodDeleteResponse;
    return { id: body.id };
  }

  async unclaimImproverWorkflowSeries(
    seriesId: string,
    stepOrder: number,
  ): Promise<AppImproverWorkflowSeriesUnclaimResult> {
    const response = await this.authFetch("/improvers/workflow-series/unclaim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        series_id: seriesId,
        step_order: stepOrder,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to unclaim this workflow series");
    }
    const body = (await response.json()) as ImproverWorkflowSeriesUnclaimResponse;
    return {
      seriesId: body.series_id,
      stepOrder: body.step_order,
      releasedCount: body.released_count,
      skippedCount: body.skipped_count,
    };
  }

  async claimWorkflowStep(workflowId: string, stepId: string): Promise<AppWorkflow> {
    const response = await this.authFetch(
      `/improvers/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}/claim`,
      { method: "POST" },
    );
    if (!response.ok) {
      await throwRequestError(response, "Unable to claim this workflow step");
    }
    const body = (await response.json()) as WorkflowResponse;
    return mapWorkflow(body);
  }

  async startWorkflowStep(workflowId: string, stepId: string): Promise<AppWorkflow> {
    const response = await this.authFetch(
      `/improvers/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}/start`,
      { method: "POST" },
    );
    if (!response.ok) {
      await throwRequestError(response, "Unable to start this workflow step");
    }
    const body = (await response.json()) as WorkflowResponse;
    return mapWorkflow(body);
  }

  async completeWorkflowStep(
    workflowId: string,
    stepId: string,
    input: AppWorkflowStepCompletionInput,
  ): Promise<AppWorkflow> {
    const normalizedItems = Array.isArray(input.items)
      ? input.items.map((item) => ({
          item_id: item.itemId,
          photo_ids: Array.isArray(item.photoIds) ? item.photoIds : undefined,
          photo_uploads: Array.isArray(item.photoUploads)
            ? item.photoUploads.map((upload: AppWorkflowPhotoUpload) => ({
                file_name: upload.fileName,
                content_type: upload.contentType,
                data_base64: upload.dataBase64,
              }))
            : undefined,
          written_response: item.writtenResponse?.trim() || undefined,
          dropdown_value: item.dropdownValue?.trim() || undefined,
        }))
      : [];

    const response = await this.authFetch(
      `/improvers/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step_not_possible: input.stepNotPossible === true,
          step_not_possible_details: input.stepNotPossibleDetails?.trim() || undefined,
          items: normalizedItems,
        }),
      },
    );
    if (!response.ok) {
      await throwRequestError(response, "Unable to complete this workflow step");
    }
    const body = (await response.json()) as WorkflowResponse;
    return mapWorkflow(body);
  }

  async requestWorkflowStepPayoutRetry(
    workflowId: string,
    stepId: string,
  ): Promise<AppWorkflow> {
    const response = await this.authFetch(
      `/improvers/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}/payout-request`,
      { method: "POST" },
    );
    if (!response.ok) {
      await throwRequestError(response, "Unable to request payout retry");
    }
    const body = (await response.json()) as WorkflowResponse;
    return mapWorkflow(body);
  }

  async getWorkflow(workflowId: string): Promise<AppWorkflow> {
    const response = await this.authFetch(`/workflows/${encodeURIComponent(workflowId)}`);
    if (!response.ok) {
      await throwRequestError(response, "Unable to load workflow details");
    }
    const body = (await response.json()) as WorkflowResponse;
    return mapWorkflow(body);
  }

  async getWorkflowPhotoDataUri(photoId: string): Promise<string | null> {
    const response = await this.authFetch(`/workflow-photos/${encodeURIComponent(photoId)}`);
    if (!response.ok) {
      await throwRequestError(response, "Unable to load workflow photo");
    }
    const contentType = response.headers.get("content-type")?.trim() || "";
    if (!contentType.startsWith("image/")) {
      return null;
    }
    const payload = await response.arrayBuffer();
    const base64 = Buffer.from(payload).toString("base64");
    return `data:${contentType};base64,${base64}`;
  }

  async getWallets(): Promise<AppWallet[]> {
    const response = await this.authFetch("/wallets");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load wallets from the shared app backend");
    }
    const body = (await response.json()) as WalletsResponse;
    return Array.isArray(body) ? body.map(mapWallet) : [];
  }

  async addWallet(wallet: AppWallet): Promise<void> {
    const response = await this.authFetch("/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: wallet.id ?? 0,
        owner: wallet.owner,
        name: wallet.name,
        is_eoa: wallet.isEoa,
        is_hidden: wallet.isHidden,
        is_redeemer: wallet.isRedeemer,
        is_minter: wallet.isMinter,
        eoa_address: wallet.eoaAddress,
        smart_address: wallet.smartAddress ?? null,
        smart_index: typeof wallet.smartIndex === "number" ? wallet.smartIndex : null,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to add wallet to the shared app backend");
    }
  }

  async updateWallet(wallet: AppWallet): Promise<void> {
    if (typeof wallet.id !== "number") {
      throw new Error("Wallet ID is required to update wallet settings.");
    }

    const response = await this.authFetch("/wallets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: wallet.id,
        owner: wallet.owner,
        name: wallet.name,
        is_hidden: wallet.isHidden,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update wallet settings in the shared app backend");
    }
  }

  async ensureLegacyWallets(ownerAddress: string, candidates: Array<{ smartIndex: number; accountAddress: string }>): Promise<void> {
    const normalizedOwner = ethers.utils.getAddress(ownerAddress);
    const existing = await this.getWallets();
    const existingKeys = new Set(
      existing
        .filter((wallet) => !wallet.isEoa && wallet.smartAddress && typeof wallet.smartIndex === "number")
        .map((wallet) => `${wallet.smartIndex}:${wallet.smartAddress?.toLowerCase()}`),
    );

    for (const candidate of candidates) {
      const normalizedSmart = ethers.utils.getAddress(candidate.accountAddress);
      const key = `${candidate.smartIndex}:${normalizedSmart.toLowerCase()}`;
      if (existingKeys.has(key)) {
        continue;
      }

      await this.addWallet({
        id: 0,
        owner: "",
        name: `Wallet ${candidate.smartIndex + 1}`,
        isEoa: false,
        isHidden: false,
        isRedeemer: false,
        isMinter: false,
        eoaAddress: normalizedOwner,
        smartAddress: normalizedSmart,
        smartIndex: candidate.smartIndex,
      });
      existingKeys.add(key);
    }
  }

  async updatePrimaryWallet(address: string): Promise<string> {
    const normalizedAddress = ethers.utils.getAddress(address);
    const response = await this.authFetch("/users/primary-wallet", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_wallet_address: normalizedAddress,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update primary wallet in the shared app backend");
    }
    const body = (await response.json()) as GetUserResponse["user"];
    const rawPrimaryWalletAddress = asString(body.primary_wallet_address).trim();
    if (!ethers.utils.isAddress(rawPrimaryWalletAddress)) {
      throw new Error("Shared app backend returned an invalid primary wallet.");
    }
    return ethers.utils.getAddress(rawPrimaryWalletAddress);
  }

  async getContacts(): Promise<AppContact[]> {
    const response = await this.authFetch("/contacts");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load contacts from the shared app backend");
    }
    const body = (await response.json()) as GetUserResponse["contacts"];
    return Array.isArray(body) ? body.map(mapContact) : [];
  }

  async addContact(name: string, address: string): Promise<AppContact> {
    const response = await this.authFetch("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: "",
        name,
        address,
        is_favorite: false,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to add contact in the shared app backend");
    }
    const body = (await response.json()) as GetUserResponse["contacts"][number];
    return mapContact(body);
  }

  async toggleFavorite(contact: AppContact): Promise<void> {
    const response = await this.authFetch("/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: contact.id,
        owner: contact.owner,
        name: contact.name,
        address: contact.address,
        is_favorite: !contact.isFavorite,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update contact in the shared app backend");
    }
  }

  async updateContact(contact: AppContact): Promise<void> {
    const response = await this.authFetch("/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: contact.id,
        owner: contact.owner,
        name: contact.name,
        address: contact.address,
        is_favorite: contact.isFavorite,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update contact in the shared app backend");
    }
  }

  async deleteContact(contactID: number): Promise<void> {
    const response = await this.authFetch(`/contacts?id=${contactID}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to delete contact from the shared app backend");
    }
  }

  async getPublicLocations(): Promise<AppLocation[]> {
    const response = await fetch(endpoint("/locations"));
    if (!response.ok) {
      throw new Error("Unable to load merchant map.");
    }
    const body = (await response.json()) as PublicLocationsResponse;
    return Array.isArray(body.locations) ? body.locations.map(mapLocation) : [];
  }

  async lookupWalletOwner(address: string): Promise<AppWalletOwnerLookup | null> {
    const normalizedAddress = ethers.utils.getAddress(address);
    const response = await this.authFetch(`/wallets/lookup/${encodeURIComponent(normalizedAddress)}`);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as WalletLookupResponse;
    return mapWalletOwnerLookup(body, normalizedAddress);
  }

  async redeemCode(code: string, address: string): Promise<void> {
    const response = await fetch(endpoint("/redeem"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        address,
      }),
    });

    if (response.ok) {
      return;
    }

    const rawBody = (await response.text()).trim();
    try {
      const parsed = JSON.parse(rawBody) as { reason?: string; error?: string };
      if (parsed.reason === "w9_required" || parsed.error === "w9_required") {
        throw new Error("A W9 form is required before this reward can be redeemed.");
      }
      if (parsed.reason === "w9_pending" || parsed.error === "w9_pending") {
        throw new Error("Your W9 form is still being processed. Try this QR code again once it is approved.");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "A W9 form is required before this reward can be redeemed." ||
          error.message === "Your W9 form is still being processed. Try this QR code again once it is approved.")
      ) {
        throw error;
      }
    }

    switch (rawBody) {
      case "code not started":
        throw new Error("This perk is not active yet.");
      case "code expired":
        throw new Error("This perk has expired.");
      case "code redeemed":
        throw new Error("This QR code has already been redeemed.");
      case "user redeemed":
        throw new Error("You have already redeemed this perk.");
      default:
        throw new Error("Unable to redeem this QR code right now.");
    }
  }

  async getVerifiedEmails(): Promise<VerifiedEmail[]> {
    const response = await this.authFetch("/users/verified-emails");
    if (!response.ok) {
      throw new Error("Unable to load verified emails.");
    }
    const body = (await response.json()) as VerifiedEmailResponse;
    return body.map((entry) => ({
      id: entry.id,
      userId: entry.user_id,
      email: entry.email,
      status: entry.status,
      verifiedAt: entry.verified_at,
      verificationSentAt: entry.verification_sent_at,
      verificationTokenExpiresAt: entry.verification_token_expires_at,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    }));
  }

  async requestVerifiedEmail(email: string): Promise<VerifiedEmail> {
    const response = await this.authFetch("/users/verified-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to request email verification");
    }
    const body = (await response.json()) as VerifiedEmailResponse[number];
    return {
      id: body.id,
      userId: body.user_id,
      email: body.email,
      status: body.status,
      verifiedAt: body.verified_at,
      verificationSentAt: body.verification_sent_at,
      verificationTokenExpiresAt: body.verification_token_expires_at,
      createdAt: body.created_at,
      updatedAt: body.updated_at,
    };
  }

  async resendVerifiedEmail(emailId: string): Promise<VerifiedEmail> {
    const response = await this.authFetch(
      `/users/verified-emails/${encodeURIComponent(emailId)}/resend`,
      { method: "POST" },
    );
    if (!response.ok) {
      await throwRequestError(response, "Unable to resend email verification");
    }
    const body = (await response.json()) as VerifiedEmailResponse[number];
    return {
      id: body.id,
      userId: body.user_id,
      email: body.email,
      status: body.status,
      verifiedAt: body.verified_at,
      verificationSentAt: body.verification_sent_at,
      verificationTokenExpiresAt: body.verification_token_expires_at,
      createdAt: body.created_at,
      updatedAt: body.updated_at,
    };
  }

  async getNotificationSubscriptions(): Promise<PonderSubscription[]> {
    const [merchantResponse, pushResponse] = await Promise.all([
      this.authFetch("/ponder"),
      this.authFetch("/ponder/push"),
    ]);
    if (!merchantResponse.ok || !pushResponse.ok) {
      throw new Error("Unable to load wallet notifications.");
    }
    const merchantBody = (await merchantResponse.json()) as PonderResponse;
    const pushBody = (await pushResponse.json()) as PonderResponse;
    const merchantEntries = Array.isArray(merchantBody) ? merchantBody : [];
    const pushEntries = Array.isArray(pushBody) ? pushBody : [];

    const merchantSubscriptions = merchantEntries.map((entry) =>
      mapPonderSubscription(entry, "merchant", entry.id),
    );
    const pushSubscriptions = pushEntries.map((entry) =>
      mapPonderSubscription(entry, "push", -Math.abs(entry.id)),
    );

    return [...merchantSubscriptions, ...pushSubscriptions];
  }

  async getPushNotificationRegistrations(token?: string): Promise<PonderSubscription[]> {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const response = await this.authFetch(`/ponder/push${query}`);
    if (!response.ok) {
      await throwRequestError(response, "Unable to load push notification state");
    }
    const body = (await response.json()) as PonderResponse;
    const entries = Array.isArray(body) ? body : [];
    return entries.map((entry) => mapPonderSubscription(entry, "push", -Math.abs(entry.id)));
  }

  async enableNotification(email: string, address: string): Promise<void> {
    const response = await this.authFetch("/ponder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, address }),
    });
    if (!response.ok) {
      throw new Error("Unable to enable notifications.");
    }
  }

  async disableNotification(id: number): Promise<void> {
    const isPushSubscription = id < 0;
    const normalizedID = Math.abs(id);
    const endpoint = isPushSubscription ? "/ponder/push" : "/ponder";
    const response = await this.authFetch(`${endpoint}?id=${normalizedID}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error("Unable to disable notifications.");
    }
  }

  async syncPushNotifications(
    token: string,
    addresses: string[],
    options: PushNotificationSyncOptions = {},
  ): Promise<void> {
    const body: {
      token: string;
      addresses: string[];
      preference_enabled?: boolean;
      device_registered?: boolean;
    } = { token, addresses };
    if (typeof options.preferenceEnabled === "boolean") {
      body.preference_enabled = options.preferenceEnabled;
    }
    if (typeof options.deviceRegistered === "boolean") {
      body.device_registered = options.deviceRegistered;
    }

    const response = await this.authFetch("/ponder/push", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error("Unable to sync push notifications.");
    }
  }

  async getTransactions(address: string, page = 0, count = 30): Promise<AppTransaction[]> {
    const response = await this.authFetch(
      `/transactions?address=${encodeURIComponent(address)}&page=${page}&count=${count}&desc=true`,
    );
    if (!response.ok) {
      throw new Error("Unable to load transaction history.");
    }
    const body = (await response.json()) as TransactionsResponse;
    return (body.transactions || []).map((tx) => ({
      id: tx.id,
      hash: tx.hash,
      amount: tx.amount,
      amountFormatted: formatTokenAmount(tx.amount),
      timestamp: tx.timestamp,
      from: tx.from,
      to: tx.to,
      memo: tx.memo,
      direction: tx.from.toLowerCase() === address.toLowerCase() ? "send" : "receive",
    }));
  }

  async lookupMerchantWalletLabel(address: string): Promise<string | null> {
    const normalizedAddress = ethers.utils.getAddress(address);
    const response = await this.authFetch(`/wallets/lookup/${encodeURIComponent(normalizedAddress)}`);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as WalletLookupResponse;
    if (!body.found || !body.is_merchant) {
      return null;
    }
    const merchantName = (body.merchant_name || body.wallet_name || "").trim();
    return merchantName || null;
  }

  async saveTransactionMemo(txHash: string, memo: string): Promise<void> {
    const trimmed = memo.trim();
    if (!trimmed) {
      return;
    }
    const response = await this.authFetch("/transactions/memo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx_hash: txHash, memo: trimmed }),
    });
    if (!response.ok) {
      throw new Error("Unable to save transaction memo.");
    }
  }

  async submitMerchantApplication(draft: MerchantApplicationDraft): Promise<void> {
    if (!draft.place) {
      throw new Error("Select your business location first.");
    }

    const response = await this.authFetch("/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 0,
        google_id: draft.place.googleId,
        owner_id: "",
        name: draft.place.name,
        description: draft.description.trim(),
        type: draft.place.type,
        street: draft.place.street,
        city: draft.place.city,
        state: draft.place.state,
        zip: draft.place.zip,
        lat: draft.place.lat,
        lng: draft.place.lng,
        phone: draft.businessPhone.trim(),
        email: draft.businessEmail.trim(),
        admin_phone: draft.primaryContactPhone.trim(),
        admin_email: draft.primaryContactEmail.trim(),
        website: draft.place.website,
        image_url: draft.place.imageUrl,
        rating: draft.place.rating,
        maps_page: draft.place.mapsPage,
        opening_hours: draft.place.openingHours,
        contact_firstname: draft.primaryContactFirstName.trim(),
        contact_lastname: draft.primaryContactLastName.trim(),
        contact_phone: draft.primaryContactPhone.trim(),
        pos_system: draft.posSystem.trim(),
        sole_proprietorship: draft.soleProprietorship.trim(),
        tipping_policy: draft.tippingPolicy.trim(),
        tipping_division: draft.tippingDivision.trim(),
        table_coverage: draft.tableCoverage.trim(),
        service_stations: Number(draft.serviceStations || "0"),
        tablet_model: draft.tabletModel.trim(),
        messaging_service: draft.messagingService.trim(),
        reference: draft.reference.trim(),
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to submit merchant application.");
    }
  }
}
