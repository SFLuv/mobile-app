import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Text } from "../components/AppText";
import { CameraView } from "expo-camera";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { DatePickerSheet } from "../components/DatePickerSheet";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { AppBackendClient, AppBackendRequestError } from "../services/appBackend";
import {
  AppCredentialRequest,
  AppCredentialType,
  AppGlobalCredentialType,
  AppImprover,
  AppImproverAbsencePeriod,
  AppImproverAbsencePeriodCreateResult,
  AppImproverWorkflowListItem,
  AppImproverWorkflowStepSummary,
  AppUser,
  AppWorkflowDropdownOption,
  AppWorkflow,
  AppWorkflowPhotoAspectRatio,
  AppWorkflowWorkItem,
  AppWorkflowStep,
  AppWorkflowStepCompletionInput,
  AppW9Status,
} from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { W9EscrowCard } from "../components/W9EscrowCard";
import { triggerClickHaptic } from "../utils/haptics";
import { useCameraAccess } from "../utils/phonePermissions";
import i18next, { t } from "../i18n";
import { dirIcon } from "../i18n/direction";

type Props = {
  user: AppUser | null;
  improver: AppImprover | null;
  tokenSymbol: string;
  w9Status?: AppW9Status | null;
  w9Busy?: boolean;
  onStartW9?: () => void;
  backendClient?: AppBackendClient | null;
  hapticsEnabled?: boolean;
  onRefreshProfile: () => Promise<void>;
  onImproverUpdated?: (improver: AppImprover) => void;
  requestedSection?: ImproverSection;
  requestedSectionNonce?: number;
  onCredentialDataUpdated?: (payload: {
    credentialTypes: AppGlobalCredentialType[];
    credentialRequests: AppCredentialRequest[];
  }) => void;
};

type ImproverSection = "workflows" | "credentials";

/** Built per call so labels follow the current language. */
const IMPROVER_SECTION_TABS = (): Array<{ value: ImproverSection; label: string }> => [
  { value: "workflows", label: t("improver.workflows") },
  { value: "credentials", label: t("improver.credentials") },
];
type WorkflowView = "my-workflows" | "workflow-board" | "unpaid-workflows";

type CompletionPhoto = {
  id: string;
  fileName: string;
  contentType: string;
  dataBase64: string;
  previewUri: string;
  sizeBytes: number;
};

type CompletionItemForm = {
  written: string;
  dropdown: string;
  photos: CompletionPhoto[];
};

type StepNotPossibleForm = {
  selected: boolean;
  details: string;
};

type WorkflowSeriesGroup = {
  key: string;
  seriesId: string;
  primaryStepOrder: number | null;
  primaryStepTitle: string | null;
  workflowTitle: string;
  recurrence: AppImproverWorkflowListItem["recurrence"];
  absence: AppImproverAbsencePeriod | null;
  canRevokeAbsence: boolean;
  workflows: AppImproverWorkflowListItem[];
};

type RecurringClaimOption = {
  key: string;
  seriesId: string;
  stepOrder: number;
  workflowTitle: string;
  stepTitle: string;
  recurrence: AppImproverWorkflowListItem["recurrence"];
  claimedCount: number;
};

type CameraTarget = {
  stepId: string;
  itemId: string;
  title: string;
  aspectRatio: AppWorkflowPhotoAspectRatio;
  maxCount: number | null;
};

type WorkflowSelectorOption = {
  value: WorkflowView;
  label: string;
};

/**
 * Prefers the server's own wording over the wrapped
 * "... (409): step already claimed" form, which reads like a stack trace.
 */
function describeClaimFailure(error: unknown): string {
  if (error instanceof AppBackendRequestError && error.detail) {
    const detail = error.detail.trim();
    if (detail && !detail.startsWith("{") && !detail.startsWith("<")) {
      return detail.charAt(0).toUpperCase() + detail.slice(1);
    }
  }
  return (error as Error)?.message || t("improver.unableToClaimThisWorkflow");
}

const MAX_MOBILE_WORKFLOW_PHOTO_BYTES = 4 * 1024 * 1024;
const IMPROVER_BACKGROUND_POLL_MS = 30000;
const OPTIONAL_IMAGE_PICKER: any = (() => {
  try {
    // Loaded lazily at runtime so the panel still compiles even if the package has not been installed yet.
    return require("expo-image-picker");
  } catch {
    return null;
  }
})();

type LoadOptions = {
  silent?: boolean;
};

type ImproverScreenCache = {
  userId: string | null;
  section: ImproverSection;
  workflowView: WorkflowView;
  includePastWorkflows: boolean;
  badgeSearch: string;
  boardSearch: string;
  myWorkflowsSearch: string;
  unpaidSearch: string;
  credentialSearch: string;
  requestFirstName: string;
  requestLastName: string;
  workflows: AppImproverWorkflowListItem[];
  unpaidWorkflows: AppWorkflow[];
  activeCredentials: AppCredentialType[];
  credentialTypes: AppGlobalCredentialType[];
  credentialRequests: AppCredentialRequest[];
  absencePeriods: AppImproverAbsencePeriod[];
  workflowDataLoaded: boolean;
  unpaidDataLoaded: boolean;
  credentialDataLoaded: boolean;
  absenceDataLoaded: boolean;
};

function createEmptyImproverScreenCache(userId: string | null): ImproverScreenCache {
  return {
    userId,
    section: "workflows",
    workflowView: "my-workflows",
    includePastWorkflows: false,
    badgeSearch: "",
    boardSearch: "",
    myWorkflowsSearch: "",
    unpaidSearch: "",
    credentialSearch: "",
    requestFirstName: "",
    requestLastName: "",
    workflows: [],
    unpaidWorkflows: [],
    activeCredentials: [],
    credentialTypes: [],
    credentialRequests: [],
    absencePeriods: [],
    workflowDataLoaded: false,
    unpaidDataLoaded: false,
    credentialDataLoaded: false,
    absenceDataLoaded: false,
  };
}

let improverScreenCache = createEmptyImproverScreenCache(null);

function getImproverScreenCache(userId: string | null): ImproverScreenCache {
  if (improverScreenCache.userId !== userId) {
    improverScreenCache = createEmptyImproverScreenCache(userId);
  }
  return improverScreenCache;
}

function formatStatusLabel(value?: string | null): string {
  if (!value) {
    return "";
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "paid_out") {
    return t("improver.finalized");
  }
  return value
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function getWorkflowDisplayStatus(workflow: Pick<AppWorkflow, "status" | "startAt">, nowUnix = Date.now() / 1000): string {
  const status = String(workflow.status || "").trim().toLowerCase();
  if (!status) {
    return "";
  }
  if ((status === "approved" || status === "blocked") && workflow.startAt > nowUnix) {
    return "upcoming";
  }
  return status;
}

function formatWorkflowDisplayStatus(workflow: Pick<AppWorkflow, "status" | "startAt">): string {
  return formatStatusLabel(getWorkflowDisplayStatus(workflow));
}

function buildCredentialLabelMap(credentialTypes: AppGlobalCredentialType[]): Record<string, string> {
  const labelMap: Record<string, string> = {
    dpw_certified: t("improver.dpwCertified"),
    sfluv_verifier: t("improver.sfluvVerifier"),
  };
  for (const credentialType of credentialTypes) {
    const value = credentialType.value.trim();
    const label = credentialType.label.trim();
    if (!value || !label) {
      continue;
    }
    labelMap[value] = label;
  }
  return labelMap;
}

function formatCredentialLabel(value: string, labelMap: Record<string, string>): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (labelMap[trimmed]) {
    return labelMap[trimmed];
  }
  return trimmed
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function buildCredentialBadgeUri(credentialType?: AppGlobalCredentialType | null): string | null {
  const contentType = credentialType?.badgeContentType?.trim();
  const base64 = credentialType?.badgeDataBase64?.trim();
  if (!contentType || !base64) {
    return null;
  }
  return `data:${contentType};base64,${base64}`;
}

function formatWorkItemRequirements(item: AppWorkflowWorkItem): string {
  const requirements: string[] = [];
  if (item.requiresPhoto) {
    const countLabel = item.photoAllowAnyCount
      ? t("improver.anyCount")
      : t("improver.photoCount", { count: Math.max(1, item.photoRequiredCount || 1) });
    const aspectLabel =
      item.photoAspectRatio === "vertical"
        ? t("improver.aspectVertical")
        : item.photoAspectRatio === "horizontal"
          ? t("improver.aspectHorizontal")
          : t("improver.aspectSquare");
    const sourceLabel = item.cameraCaptureOnly ? t("improver.liveCameraOnly") : t("improver.cameraOrUpload");
    requirements.push(t("improver.photoRequirement", { photos: countLabel, aspect: aspectLabel, source: sourceLabel }));
  }
  if (item.requiresWrittenResponse) {
    requirements.push(t("improver.writtenResponse"));
  }
  if (item.requiresDropdown) {
    requirements.push(t("improver.choice"));
  }
  return requirements.length > 0 ? requirements.join(" + ") : t("improver.noRequirement");
}

function getWorkflowPhotoAspectRatioValue(aspectRatio: AppWorkflowPhotoAspectRatio): number {
  if (aspectRatio === "vertical") {
    return 3 / 4;
  }
  if (aspectRatio === "horizontal") {
    return 4 / 3;
  }
  return 1;
}

function getCompletionItemErrorKey(stepId: string, itemId: string): string {
  return `${stepId}:${itemId}`;
}

function resolveWorkflowTone(
  workflow: Pick<AppWorkflow, "status" | "startAt">,
): "default" | "success" | "danger" | "warning" {
  const displayStatus = formatWorkflowDisplayStatus(workflow);
  if (workflow.status === "completed" || workflow.status === "paid_out") {
    return "success";
  }
  if (workflow.status === "failed" || workflow.status === "rejected") {
    return "danger";
  }
  if (workflow.status === "blocked" || displayStatus === "Upcoming") {
    return "warning";
  }
  return "default";
}

function resolveAssignedStep(workflow: AppWorkflow, userId?: string | null): AppWorkflowStep | null {
  if (!userId) {
    return null;
  }
  return (
    workflow.steps
      .filter((step) => step.assignedImproverId === userId)
      .sort((left, right) => left.stepOrder - right.stepOrder)[0] || null
  );
}

function getAssignedStepSummaries(workflow: AppImproverWorkflowListItem): AppImproverWorkflowStepSummary[] {
  return [...(workflow.assignedSteps || [])].sort((left, right) => left.stepOrder - right.stepOrder);
}

function getPrimaryAssignedStepSummary(workflow: AppImproverWorkflowListItem): AppImproverWorkflowStepSummary | null {
  return getAssignedStepSummaries(workflow)[0] || null;
}

function getInitialStepIndexForWorkflowCard(workflow: AppImproverWorkflowListItem): number {
  const assignedSteps = getAssignedStepSummaries(workflow);
  const preferred =
    assignedSteps.find(
      (step) => step.status === "available" || step.status === "in_progress" || step.status === "locked",
    ) ||
    assignedSteps[0] ||
    workflow.claimableStep ||
    null;
  return preferred ? Math.max(0, preferred.stepOrder - 1) : 0;
}

// A role can cover more than one step of the same workflow, so finishing one
// does not mean the improver is done. These two helpers are what make the rest
// of that work findable: the pager lands on it, and the step list says which
// numbers are theirs.
//
// Without them an improver assigned to steps 1 and 3 completed step 1, stayed
// looking at their own finished step, and had no way to know step 3 was also
// theirs short of paging through every step in the workflow.
function assignedStepOrders(workflow: AppWorkflow, userId?: string | null): number[] {
  if (!userId) {
    return [];
  }
  return [...workflow.steps]
    .filter((step) => step.assignedImproverId === userId)
    .map((step) => step.stepOrder)
    .sort((left, right) => left - right);
}

// The next step of theirs that is still open, after the one they just left.
// Returns -1 when there is nothing further, so the caller can stay put.
function nextActionableAssignedStepIndex(
  workflow: AppWorkflow,
  userId: string | null | undefined,
  afterStepOrder: number,
): number {
  if (!userId) {
    return -1;
  }
  const sortedSteps = [...workflow.steps].sort((left, right) => left.stepOrder - right.stepOrder);
  return sortedSteps.findIndex(
    (step) =>
      step.assignedImproverId === userId &&
      step.stepOrder > afterStepOrder &&
      (step.status === "available" || step.status === "in_progress" || step.status === "locked"),
  );
}

function isFullWorkflow(workflow: AppWorkflow | AppImproverWorkflowListItem): workflow is AppWorkflow {
  return Array.isArray((workflow as AppWorkflow).steps);
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }
  return next;
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}


function formatAbsenceFieldDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (month < 1 || month > 12) return value;
  return new Date(year, month - 1, day).toLocaleDateString(i18next.language, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toDateInputValueFromUnix(value: number, inclusiveEnd = false): string {
  const adjustedValue = inclusiveEnd ? Math.max(value - 1, 0) : value;
  const date = new Date(adjustedValue * 1000);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateFromUnix(value: number, inclusiveEnd = false): string {
  const adjustedValue = inclusiveEnd ? Math.max(value - 1, 0) : value;
  return new Date(adjustedValue * 1000).toLocaleDateString();
}

function formatWorkflowDate(value: number): string {
  return new Date(value * 1000).toLocaleString();
}

function slugifyFileName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "workflow_photo";
}

function estimateBase64Bytes(value: string): number {
  const normalized = value.replace(/=+$/, "");
  return Math.floor((normalized.length * 3) / 4);
}

function splitName(input?: string | null): { firstName: string; lastName: string } {
  const trimmed = (input || "").trim();
  if (!trimmed || trimmed === "SFLUV User") {
    return { firstName: "", lastName: "" };
  }
  const parts = trimmed
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }
  return {
    firstName: parts[0].toLowerCase() === "user" ? "" : parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function emptyItemForm(): CompletionItemForm {
  return {
    written: "",
    dropdown: "",
    photos: [],
  };
}

function emptyStepNotPossibleForm(): StepNotPossibleForm {
  return {
    selected: false,
    details: "",
  };
}

export function ImproverScreen({
  user,
  improver,
  tokenSymbol,
  w9Status,
  w9Busy,
  onStartW9,
  backendClient,
  hapticsEnabled = true,
  onRefreshProfile,
  onImproverUpdated,
  requestedSection,
  requestedSectionNonce,
  onCredentialDataUpdated,
}: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const refreshAccent = palette.primaryStrong;
  const refreshControlKey = `${isDark ? "dark" : "light"}:${refreshAccent}:${palette.surfaceStrong}`;
  const topInset = Math.max(Constants.statusBarHeight, Platform.OS === "ios" ? spacing.md : 0);
  // Clearance so the floating edit bar sits ABOVE the app's bottom tab dock
  // rather than overlapping it (the dock has no exposed inset to read).
  const bulkBarBottomInset = Platform.OS === "ios" ? 100 : 84;
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const userId = user?.id ?? null;
  const initialCache = getImproverScreenCache(userId);
  const initialSection =
    requestedSection && typeof requestedSectionNonce === "number" && requestedSectionNonce > 0
      ? requestedSection
      : initialCache.section;
  const [section, setSection] = useState<ImproverSection>(initialSection);
  const [workflowView, setWorkflowView] = useState<WorkflowView>(initialCache.workflowView);
  const [includePastWorkflows, setIncludePastWorkflows] = useState(initialCache.includePastWorkflows);
  const [workflowSelectorVisible, setWorkflowSelectorVisible] = useState(false);
  const [workflowEditMode, setWorkflowEditMode] = useState(false);
  const [selectedWorkflowKeys, setSelectedWorkflowKeys] = useState<string[]>([]);
  const [badgesVisible, setBadgesVisible] = useState(false);
  const [badgeSearch, setBadgeSearch] = useState(initialCache.badgeSearch);
  const [boardSearch, setBoardSearch] = useState(initialCache.boardSearch);
  const [myWorkflowsSearch, setMyWorkflowsSearch] = useState(initialCache.myWorkflowsSearch);
  const [unpaidSearch, setUnpaidSearch] = useState(initialCache.unpaidSearch);
  const [credentialSearch, setCredentialSearch] = useState(initialCache.credentialSearch);
  const [requestFirstName, setRequestFirstName] = useState(initialCache.requestFirstName);
  const [requestLastName, setRequestLastName] = useState(initialCache.requestLastName);
  const [absenceFrom, setAbsenceFrom] = useState("");
  const [absenceUntil, setAbsenceUntil] = useState("");
  const [absencePickerField, setAbsencePickerField] = useState<"from" | "until" | null>(null);
  // Absence coverage is its own screen (not a bar over the workflow list).
  const [absenceScreenVisible, setAbsenceScreenVisible] = useState(false);
  const [absenceAllWorkflows, setAbsenceAllWorkflows] = useState(false);
  const [revokeConfirmVisible, setRevokeConfirmVisible] = useState(false);
  const [workflows, setWorkflows] = useState<AppImproverWorkflowListItem[]>(initialCache.workflows);
  const [unpaidWorkflows, setUnpaidWorkflows] = useState<AppWorkflow[]>(initialCache.unpaidWorkflows);
  const [activeCredentials, setActiveCredentials] = useState<AppCredentialType[]>(initialCache.activeCredentials);
  const [credentialTypes, setCredentialTypes] = useState<AppGlobalCredentialType[]>(initialCache.credentialTypes);
  const [credentialRequests, setCredentialRequests] = useState<AppCredentialRequest[]>(initialCache.credentialRequests);
  const [absencePeriods, setAbsencePeriods] = useState<AppImproverAbsencePeriod[]>(initialCache.absencePeriods);
  const [workflowDataLoaded, setWorkflowDataLoaded] = useState(initialCache.workflowDataLoaded);
  const [workflowDataLoading, setWorkflowDataLoading] = useState(false);
  const [unpaidDataLoaded, setUnpaidDataLoaded] = useState(initialCache.unpaidDataLoaded);
  const [unpaidDataLoading, setUnpaidDataLoading] = useState(false);
  const [credentialDataLoaded, setCredentialDataLoaded] = useState(initialCache.credentialDataLoaded);
  const [credentialDataLoading, setCredentialDataLoading] = useState(false);
  const [absenceDataLoaded, setAbsenceDataLoaded] = useState(initialCache.absenceDataLoaded);
  const [absenceDataLoading, setAbsenceDataLoading] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<AppWorkflow | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailStepIndex, setDetailStepIndex] = useState(0);
  const [submissionDetailsOpen, setSubmissionDetailsOpen] = useState<Record<string, boolean>>({});
  const [completionForms, setCompletionForms] = useState<Record<string, Record<string, CompletionItemForm>>>({});
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [stepNotPossibleForms, setStepNotPossibleForms] = useState<Record<string, StepNotPossibleForm>>({});
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [workflowRefreshing, setWorkflowRefreshing] = useState(false);
  const [badgePreview, setBadgePreview] = useState<{ label: string; imageUri: string } | null>(null);
  const [imagePreviewHost, setImagePreviewHost] = useState<"detail" | "badges" | "credentials" | null>(null);
  const [photoPreviewUris, setPhotoPreviewUris] = useState<Record<string, string>>({});
  const [photoPreviewLoading, setPhotoPreviewLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState("");
  const { permission, access: cameraAccess, ask: askCamera } = useCameraAccess();
  const cameraRef = useRef<CameraView | null>(null);
  const detailScrollRef = useRef<ScrollView | null>(null);
  const detailScrollYRef = useRef(0);
  const pendingDetailScrollYRef = useRef<number | null>(null);
  const workflowDataRequestRef = useRef<Promise<void> | null>(null);
  const unpaidDataRequestRef = useRef<Promise<void> | null>(null);
  const credentialDataRequestRef = useRef<Promise<void> | null>(null);
  const absenceDataRequestRef = useRef<Promise<void> | null>(null);
  const cacheUserIdRef = useRef(userId);
  const skipCachePersistRef = useRef(false);
  const workflowViewAutoSelectedRef = useRef(false);
  const workflowViewManualSelectionRef = useRef(false);

  const canUsePanel = Boolean(user?.isImprover || user?.isAdmin);
  const imagePickerAvailable = Boolean(OPTIONAL_IMAGE_PICKER?.launchImageLibraryAsync);
  const labelMap = useMemo(() => buildCredentialLabelMap(credentialTypes), [credentialTypes]);
  const credentialSet = useMemo(() => new Set(activeCredentials), [activeCredentials]);
  const pendingCredentialSet = useMemo(
    () =>
      new Set(
        credentialRequests
          .filter((request) => request.status === "pending")
          .map((request) => request.credentialType),
      ),
    [credentialRequests],
  );

  useEffect(() => {
    if (!requestedSection || typeof requestedSectionNonce !== "number" || requestedSectionNonce <= 0) {
      return;
    }
    setSection(requestedSection);
    if (requestedSection === "credentials") {
      setBadgesVisible(false);
    }
  }, [requestedSection, requestedSectionNonce]);

  const closeImagePreview = useCallback(() => {
    setBadgePreview(null);
    setImagePreviewHost(null);
  }, []);

  const openImagePreview = useCallback(
    (preview: { label: string; imageUri: string }, host: "detail" | "badges" | "credentials") => {
      setImagePreviewHost(host);
      setBadgePreview(preview);
    },
    [],
  );

  const selectWorkflowView = useCallback((nextView: WorkflowView) => {
    workflowViewManualSelectionRef.current = true;
    setWorkflowView(nextView);
  }, []);

  useEffect(() => {
    const parsed = splitName(user?.name);
    if (!requestFirstName) {
      setRequestFirstName(parsed.firstName);
    }
    if (!requestLastName) {
      setRequestLastName(parsed.lastName);
    }
  }, [requestFirstName, requestLastName, user?.name]);

  useEffect(() => {
    if (cacheUserIdRef.current === userId) {
      return;
    }
    cacheUserIdRef.current = userId;
    const nextCache = getImproverScreenCache(userId);
    skipCachePersistRef.current = true;
    workflowViewAutoSelectedRef.current = false;
    workflowViewManualSelectionRef.current = false;
    setSection(nextCache.section);
    setWorkflowView(nextCache.workflowView);
    setIncludePastWorkflows(nextCache.includePastWorkflows);
    setBadgeSearch(nextCache.badgeSearch);
    setBoardSearch(nextCache.boardSearch);
    setMyWorkflowsSearch(nextCache.myWorkflowsSearch);
    setUnpaidSearch(nextCache.unpaidSearch);
    setCredentialSearch(nextCache.credentialSearch);
    setRequestFirstName(nextCache.requestFirstName);
    setRequestLastName(nextCache.requestLastName);
    setWorkflows(nextCache.workflows);
    setUnpaidWorkflows(nextCache.unpaidWorkflows);
    setActiveCredentials(nextCache.activeCredentials);
    setCredentialTypes(nextCache.credentialTypes);
    setCredentialRequests(nextCache.credentialRequests);
    setAbsencePeriods(nextCache.absencePeriods);
    setWorkflowDataLoaded(nextCache.workflowDataLoaded);
    setUnpaidDataLoaded(nextCache.unpaidDataLoaded);
    setCredentialDataLoaded(nextCache.credentialDataLoaded);
    setAbsenceDataLoaded(nextCache.absenceDataLoaded);
    setWorkflowDataLoading(false);
    setUnpaidDataLoading(false);
    setCredentialDataLoading(false);
    setAbsenceDataLoading(false);
    setWorkflowSelectorVisible(false);
    setWorkflowEditMode(false);
    setSelectedWorkflowKeys([]);
    setBadgesVisible(false);
    setBadgePreview(null);
    setImagePreviewHost(null);
    setSelectedWorkflow(null);
    setDetailVisible(false);
    setCompletionForms({});
    setStepErrors({});
    setItemErrors({});
    setStepNotPossibleForms({});
    setCameraTarget(null);
    detailScrollYRef.current = 0;
    pendingDetailScrollYRef.current = null;
    setCameraError(null);
    setWorkflowRefreshing(false);
    setError(null);
    setNotice(null);
    setActionKey("");
  }, [userId]);

  useEffect(() => {
    if (skipCachePersistRef.current) {
      skipCachePersistRef.current = false;
      return;
    }
    improverScreenCache = {
      userId,
      section,
      workflowView,
      includePastWorkflows,
      badgeSearch,
      boardSearch,
      myWorkflowsSearch,
      unpaidSearch,
      credentialSearch,
      requestFirstName,
      requestLastName,
      workflows,
      unpaidWorkflows,
      activeCredentials,
      credentialTypes,
      credentialRequests,
      absencePeriods,
      workflowDataLoaded,
      unpaidDataLoaded,
      credentialDataLoaded,
      absenceDataLoaded,
    };
  }, [
    absenceDataLoaded,
    absencePeriods,
    activeCredentials,
    badgeSearch,
    boardSearch,
    credentialDataLoaded,
    credentialRequests,
    credentialSearch,
    credentialTypes,
    includePastWorkflows,
    myWorkflowsSearch,
    requestFirstName,
    requestLastName,
    section,
    unpaidDataLoaded,
    unpaidSearch,
    unpaidWorkflows,
    userId,
    workflowDataLoaded,
    workflows,
    workflowView,
  ]);

  const loadWorkflowData = useCallback(
    async (force = false, options?: LoadOptions) => {
      if (!backendClient) {
        return;
      }
      const silent = options?.silent === true;
      if (workflowDataRequestRef.current && (!force || silent)) {
        return workflowDataRequestRef.current;
      }

      const request = (async () => {
        if (!silent) {
          setWorkflowDataLoading(true);
        }
        try {
          const feed = await backendClient.getImproverWorkflows();
          setWorkflows(feed.workflows);
          setActiveCredentials(feed.activeCredentials);
          if (!silent) {
            setError((current) => (current === "Unable to load workflows." ? null : current));
          }
        } catch (nextError) {
          if (!silent) {
            setError((nextError as Error)?.message || t("improver.unableToLoadWorkflows"));
          }
        } finally {
          setWorkflowDataLoaded(true);
          if (!silent) {
            setWorkflowDataLoading(false);
          }
          workflowDataRequestRef.current = null;
        }
      })();

      workflowDataRequestRef.current = request;
      return request;
    },
    [backendClient],
  );

  const loadAbsenceData = useCallback(
    async (force = false, options?: LoadOptions) => {
      if (!backendClient) {
        return;
      }
      const silent = options?.silent === true;
      if (absenceDataRequestRef.current && (!force || silent)) {
        return absenceDataRequestRef.current;
      }

      const request = (async () => {
        if (!silent) {
          setAbsenceDataLoading(true);
        }
        try {
          const nextAbsencePeriods = await backendClient.getImproverAbsencePeriods();
          setAbsencePeriods(nextAbsencePeriods);
          if (!silent) {
            setError((current) => (current === "Unable to load workflow absence." ? null : current));
          }
        } catch (nextError) {
          if (!silent) {
            setError((nextError as Error)?.message || t("improver.unableToLoadWorkflowAbsence"));
          }
        } finally {
          setAbsenceDataLoaded(true);
          if (!silent) {
            setAbsenceDataLoading(false);
          }
          absenceDataRequestRef.current = null;
        }
      })();

      absenceDataRequestRef.current = request;
      return request;
    },
    [backendClient],
  );

  const loadUnpaidData = useCallback(
    async (force = false, options?: LoadOptions) => {
      if (!backendClient) {
        return;
      }
      const silent = options?.silent === true;
      if (unpaidDataRequestRef.current && (!force || silent)) {
        return unpaidDataRequestRef.current;
      }

      const request = (async () => {
        if (!silent) {
          setUnpaidDataLoading(true);
        }
        try {
          const nextUnpaid = await backendClient.getImproverUnpaidWorkflows();
          setUnpaidWorkflows(nextUnpaid);
          if (!silent) {
            setError((current) => (current === "Unable to load unpaid workflows." ? null : current));
          }
        } catch (nextError) {
          if (!silent) {
            setError((nextError as Error)?.message || t("improver.unableToLoadUnpaidWorkflows"));
          }
        } finally {
          setUnpaidDataLoaded(true);
          if (!silent) {
            setUnpaidDataLoading(false);
          }
          unpaidDataRequestRef.current = null;
        }
      })();

      unpaidDataRequestRef.current = request;
      return request;
    },
    [backendClient],
  );

  const loadCredentialData = useCallback(
    async (force = false, options?: LoadOptions) => {
      if (!backendClient) {
        return;
      }
      const silent = options?.silent === true;
      if (credentialDataRequestRef.current && (!force || silent)) {
        return credentialDataRequestRef.current;
      }

      const request = (async () => {
        if (!silent) {
          setCredentialDataLoading(true);
        }
        try {
          const shouldLoadFeed = !workflowDataLoaded && activeCredentials.length === 0;
          const [loadedCredentialTypes, loadedCredentialRequests, workflowFeed] = await Promise.all([
            backendClient.getCredentialTypes(),
            backendClient.getImproverCredentialRequests(),
            shouldLoadFeed ? backendClient.getImproverWorkflows() : Promise.resolve(null),
          ]);
          setCredentialTypes(loadedCredentialTypes);
          setCredentialRequests(loadedCredentialRequests);
          onCredentialDataUpdated?.({
            credentialTypes: loadedCredentialTypes,
            credentialRequests: loadedCredentialRequests,
          });
          if (workflowFeed) {
            setWorkflows(workflowFeed.workflows);
            setActiveCredentials(workflowFeed.activeCredentials);
            setWorkflowDataLoaded(true);
          }
          if (!silent) {
            setError((current) => (current === "Unable to load credentials." ? null : current));
          }
        } catch (nextError) {
          if (!silent) {
            setError((nextError as Error)?.message || t("improver.unableToLoadCredentials"));
          }
        } finally {
          setCredentialDataLoaded(true);
          if (!silent) {
            setCredentialDataLoading(false);
          }
          credentialDataRequestRef.current = null;
        }
      })();

      credentialDataRequestRef.current = request;
      return request;
    },
    [activeCredentials.length, backendClient, onCredentialDataUpdated, workflowDataLoaded],
  );

  useEffect(() => {
    if (!backendClient || !canUsePanel) {
      return;
    }
    void loadWorkflowData(workflowDataLoaded, { silent: workflowDataLoaded });
  }, [backendClient, canUsePanel, loadWorkflowData, userId]);

  useEffect(() => {
    if (!canUsePanel) {
      return;
    }
    if (
      section === "workflows" &&
      (workflowView === "my-workflows" || workflowView === "workflow-board" || workflowEditMode || detailVisible)
    ) {
      void loadAbsenceData(absenceDataLoaded, { silent: absenceDataLoaded });
    }
    if (section === "credentials" || badgesVisible) {
      void loadCredentialData(credentialDataLoaded, { silent: credentialDataLoaded });
    }
    if (workflowSelectorVisible || (section === "workflows" && workflowView === "unpaid-workflows")) {
      void loadUnpaidData(unpaidDataLoaded, { silent: unpaidDataLoaded });
    }
  }, [
    badgesVisible,
    canUsePanel,
    detailVisible,
    loadAbsenceData,
    loadCredentialData,
    loadUnpaidData,
    section,
    workflowEditMode,
    workflowSelectorVisible,
    workflowView,
  ]);

  useEffect(() => {
    if (!backendClient || !canUsePanel) {
      return;
    }
    if (!workflowDataLoaded && !absenceDataLoaded && !credentialDataLoaded && !unpaidDataLoaded) {
      return;
    }

    const poll = () => {
      if (workflowDataLoaded) {
        void loadWorkflowData(true, { silent: true });
      }
      if (absenceDataLoaded) {
        void loadAbsenceData(true, { silent: true });
      }
      if (credentialDataLoaded) {
        void loadCredentialData(true, { silent: true });
      }
      if (unpaidDataLoaded) {
        void loadUnpaidData(true, { silent: true });
      }
    };

    const intervalId = setInterval(poll, IMPROVER_BACKGROUND_POLL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [
    absenceDataLoaded,
    backendClient,
    canUsePanel,
    credentialDataLoaded,
    loadAbsenceData,
    loadCredentialData,
    loadUnpaidData,
    loadWorkflowData,
    unpaidDataLoaded,
    workflowDataLoaded,
  ]);

  useEffect(() => {
    if (workflowView !== "my-workflows" && workflowEditMode) {
      setWorkflowEditMode(false);
      setSelectedWorkflowKeys([]);
    }
  }, [workflowEditMode, workflowView]);

  const closeBadges = useCallback(() => {
    setBadgesVisible(false);
    closeImagePreview();
  }, [closeImagePreview]);

  useEffect(() => {
    if (!badgesVisible && imagePreviewHost === "badges") {
      closeImagePreview();
    }
  }, [badgesVisible, closeImagePreview, imagePreviewHost]);

  const hasClaimedRoleInFullWorkflow = useCallback(
    (workflow: AppWorkflow) => workflow.steps.some((step) => step.assignedImproverId === user?.id),
    [user?.id],
  );

  const hasClaimedWorkflowCard = useCallback(
    (workflow: AppImproverWorkflowListItem) => workflow.hasClaimedStep || workflow.assignedSteps.length > 0,
    [],
  );

  const isWorkflowCardActiveForUser = useCallback(
    (workflow: AppImproverWorkflowListItem) =>
      workflow.hasActiveClaimedStep ||
      workflow.assignedSteps.some((step) => step.status === "available" || step.status === "in_progress"),
    [],
  );

  const isStepCoveredByAbsence = useCallback(
    (workflow: AppWorkflow, step: AppWorkflowStep) =>
      workflow.recurrence !== "one_time" &&
      absencePeriods.some(
        (period) =>
          period.seriesId === workflow.seriesId &&
          period.stepOrder === step.stepOrder &&
          workflow.startAt >= period.absentFrom &&
          workflow.startAt < period.absentUntil,
      ),
    [absencePeriods],
  );

  const canClaimStep = useCallback(
    (workflow: AppWorkflow, step: AppWorkflowStep) => {
      if (!user?.id) {
        return false;
      }
      if (step.assignedImproverId) {
        return false;
      }
      if (step.status !== "available" && step.status !== "locked") {
        return false;
      }
      if (hasClaimedRoleInFullWorkflow(workflow)) {
        return false;
      }
      if (isStepCoveredByAbsence(workflow, step)) {
        return false;
      }
      if (!step.roleId) {
        return false;
      }
      const role = workflow.roles.find((candidate) => candidate.id === step.roleId);
      if (!role) {
        return false;
      }
      return role.requiredCredentials.every((credential) => credentialSet.has(credential));
    },
    [credentialSet, hasClaimedRoleInFullWorkflow, isStepCoveredByAbsence, user?.id],
  );

  const myClaimedWorkflows = useMemo(
    () => workflows.filter((workflow) => hasClaimedWorkflowCard(workflow)),
    [hasClaimedWorkflowCard, workflows],
  );

  const myWorkflowGroups = useMemo<WorkflowSeriesGroup[]>(() => {
    if (!user?.id) {
      return [];
    }
    const groups = new Map<string, WorkflowSeriesGroup>();

    for (const workflow of myClaimedWorkflows) {
      // One group per assigned step (not just the first) so improvers can
      // request absence coverage for later steps too — including step 2+ while
      // it is still locked.
      const assignedSteps = getAssignedStepSummaries(workflow).filter((step) => step.status !== "paid_out");
      for (const assignedStep of assignedSteps) {
        const selectionKey = `${workflow.seriesId}:${assignedStep.stepOrder}`;
        const existing = groups.get(selectionKey);
        if (!existing) {
          groups.set(selectionKey, {
            key: selectionKey,
            seriesId: workflow.seriesId,
            primaryStepOrder: assignedStep.stepOrder,
            primaryStepTitle: assignedStep.title,
            workflowTitle: workflow.title,
            recurrence: workflow.recurrence,
            absence: null,
            canRevokeAbsence: false,
            workflows: [workflow],
          });
          continue;
        }

        groups.set(selectionKey, {
          ...existing,
          workflows: existing.workflows.some((candidate) => candidate.id === workflow.id)
            ? existing.workflows
            : [...existing.workflows, workflow].sort((left, right) => right.startAt - left.startAt),
        });
      }
    }

    return Array.from(groups.values())
      .map((group) => {
        const matchingAbsence = absencePeriods
          .filter(
            (period) =>
              period.seriesId === group.seriesId &&
              period.stepOrder === group.primaryStepOrder &&
              period.absentUntil * 1000 >= Date.now(),
          )
          .sort((left, right) => left.absentFrom - right.absentFrom)[0] || null;

        return {
          ...group,
          absence: matchingAbsence,
          canRevokeAbsence: Boolean(matchingAbsence),
          workflows: [...group.workflows].sort((left, right) => right.startAt - left.startAt),
        };
      })
      .sort((left, right) => {
        const leftActive = left.workflows.some((workflow) => isWorkflowCardActiveForUser(workflow));
        const rightActive = right.workflows.some((workflow) => isWorkflowCardActiveForUser(workflow));
        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1;
        }
        return (right.workflows[0]?.startAt || 0) - (left.workflows[0]?.startAt || 0);
      });
  }, [absencePeriods, isWorkflowCardActiveForUser, myClaimedWorkflows, user?.id]);

  const filteredMyWorkflowGroups = useMemo(() => {
    const search = myWorkflowsSearch.trim().toLowerCase();
    return myWorkflowGroups
      .filter((group) =>
        includePastWorkflows ||
        group.recurrence !== "one_time" ||
        group.workflows.some((workflow) => workflow.status !== "completed" && workflow.status !== "paid_out"),
      )
      .filter((group) => {
        if (!search) {
          return true;
        }
        return (
          group.workflowTitle.toLowerCase().includes(search) ||
          (group.primaryStepTitle || "").toLowerCase().includes(search)
        );
      });
  }, [includePastWorkflows, myWorkflowGroups, myWorkflowsSearch]);

  const workflowBoardWorkflows = useMemo(
    () =>
      workflows.filter((workflow) => {
        if (hasClaimedWorkflowCard(workflow)) {
          return false;
        }
        return Boolean(workflow.claimableStep);
      }),
    [hasClaimedWorkflowCard, workflows],
  );

  const filteredWorkflowBoard = useMemo(() => {
    const search = boardSearch.trim().toLowerCase();
    if (!search) {
      return workflowBoardWorkflows;
    }
    return workflowBoardWorkflows.filter((workflow) => workflow.title.toLowerCase().includes(search));
  }, [boardSearch, workflowBoardWorkflows]);

  const unpaidWorkflowCards = useMemo(
    () =>
      unpaidWorkflows.filter((workflow) =>
        workflow.steps.some(
          (step) => step.assignedImproverId === user?.id && step.status === "completed" && step.bounty > 0,
        ),
      ),
    [unpaidWorkflows, user?.id],
  );

  const filteredUnpaidWorkflowCards = useMemo(() => {
    const search = unpaidSearch.trim().toLowerCase();
    if (!search) {
      return unpaidWorkflowCards;
    }
    return unpaidWorkflowCards.filter((workflow) => workflow.title.toLowerCase().includes(search));
  }, [unpaidSearch, unpaidWorkflowCards]);

  const hasUnpaidWorkflowOption = unpaidDataLoaded && unpaidWorkflowCards.length > 0;
  const workflowSelectorOptions = useMemo<WorkflowSelectorOption[]>(
    () =>
      [
        { value: "my-workflows", label: t("improver.myWorkflows") },
        { value: "workflow-board", label: t("improver.workflowBoard") },
        ...(hasUnpaidWorkflowOption ? [{ value: "unpaid-workflows" as const, label: t("improver.unpaidWorkflows") }] : []),
      ],
    [hasUnpaidWorkflowOption],
  );

  useEffect(() => {
    if (workflowView === "unpaid-workflows" && !hasUnpaidWorkflowOption) {
      setWorkflowView("my-workflows");
    }
  }, [hasUnpaidWorkflowOption, workflowView]);

  useEffect(() => {
    if (
      !workflowDataLoaded ||
      workflowViewAutoSelectedRef.current ||
      workflowViewManualSelectionRef.current
    ) {
      return;
    }

    setWorkflowView(
      workflows.some((workflow) => isWorkflowCardActiveForUser(workflow)) ? "my-workflows" : "workflow-board",
    );
    workflowViewAutoSelectedRef.current = true;
  }, [isWorkflowCardActiveForUser, workflowDataLoaded, workflows]);

  useEffect(() => {
    setSelectedWorkflowKeys((current) =>
      current.filter((key) => myWorkflowGroups.some((group) => group.key === key && group.recurrence !== "one_time")),
    );
  }, [myWorkflowGroups]);

  const selectedWorkflowGroups = useMemo(
    () => myWorkflowGroups.filter((group) => selectedWorkflowKeys.includes(group.key)),
    [myWorkflowGroups, selectedWorkflowKeys],
  );

  const requestableCredentialTypes = useMemo(
    () =>
      credentialTypes.filter((credentialType) => {
        if (credentialType.visibility !== "public") {
          return false;
        }
        return !credentialSet.has(credentialType.value);
      }),
    [credentialSet, credentialTypes],
  );

  const credentialSuggestions = useMemo(() => {
    const search = credentialSearch.trim().toLowerCase();
    if (!search) {
      return [];
    }
    return requestableCredentialTypes
      .filter(
        (credentialType) =>
          credentialType.label.toLowerCase().includes(search) ||
          credentialType.value.toLowerCase().includes(search),
      )
      .slice(0, 4);
  }, [credentialSearch, requestableCredentialTypes]);

  const credentialTypeByValue = useMemo(() => {
    const typeByValue = new Map<string, AppGlobalCredentialType>();
    for (const credentialType of credentialTypes) {
      typeByValue.set(credentialType.value, credentialType);
    }
    return typeByValue;
  }, [credentialTypes]);

  const openCredentialBadgePreview = useCallback(
    (credentialType: string, host: "credentials" | "badges" = "credentials") => {
      const type = credentialTypeByValue.get(credentialType);
      const badgeUri = buildCredentialBadgeUri(type);
      if (!badgeUri) {
        return false;
      }
      openImagePreview({ label: formatCredentialLabel(credentialType, labelMap), imageUri: badgeUri }, host);
      return true;
    },
    [credentialTypeByValue, labelMap, openImagePreview],
  );

  const myBadgeItems = useMemo(() => {
    return activeCredentials
      .map((credential) => {
        const type = credentialTypeByValue.get(credential);
        return {
          credential,
          label: formatCredentialLabel(credential, labelMap),
          badgeUri: buildCredentialBadgeUri(type),
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [activeCredentials, credentialTypeByValue, labelMap]);

  const filteredBadgeItems = useMemo(() => {
    const search = badgeSearch.trim().toLowerCase();
    if (!search) {
      return myBadgeItems;
    }
    return myBadgeItems.filter((badge) => badge.label.toLowerCase().includes(search));
  }, [badgeSearch, myBadgeItems]);

  const summarizeWorkflowForFeed = useCallback(
    (workflow: AppWorkflow): AppImproverWorkflowListItem => {
      const assignedSteps = workflow.steps
        .filter((step) => step.assignedImproverId === user?.id)
        .sort((left, right) => left.stepOrder - right.stepOrder)
        .map((step) => ({
          id: step.id,
          stepOrder: step.stepOrder,
          title: step.title,
          status: step.status,
        }));
      const claimableStep = assignedSteps.length === 0
        ? workflow.steps
            .slice()
            .sort((left, right) => left.stepOrder - right.stepOrder)
            .find((step) => canClaimStep(workflow, step))
        : undefined;

      return {
        id: workflow.id,
        seriesId: workflow.seriesId,
        workflowStateId: workflow.workflowStateId,
        proposerId: workflow.proposerId,
        title: workflow.title,
        description: workflow.description,
        recurrence: workflow.recurrence,
        recurrenceEndAt: workflow.recurrenceEndAt,
        startAt: workflow.startAt,
        status: workflow.status,
        isStartBlocked: workflow.isStartBlocked,
        blockedByWorkflowId: workflow.blockedByWorkflowId,
        totalBounty: workflow.totalBounty,
        weeklyBountyRequirement: workflow.weeklyBountyRequirement,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        voteDecision: workflow.voteDecision,
        isManager: false,
        isManagerEligible: false,
        hasClaimedStep: assignedSteps.length > 0,
        hasActiveClaimedStep: assignedSteps.some((step) => step.status === "available" || step.status === "in_progress"),
        assignedSteps,
        claimableStep: claimableStep
          ? {
              id: claimableStep.id,
              stepOrder: claimableStep.stepOrder,
              title: claimableStep.title,
              status: claimableStep.status,
            }
          : null,
      };
    },
    [canClaimStep, user?.id],
  );

  const mergeWorkflow = useCallback((updatedWorkflow: AppWorkflow) => {
    const updatedCard = summarizeWorkflowForFeed(updatedWorkflow);
    setWorkflows((current) => {
      const existing = current.some((workflow) => workflow.id === updatedCard.id);
      return existing
        ? current.map((workflow) =>
            workflow.id === updatedCard.id
              ? {
                  ...workflow,
                  ...updatedCard,
                  approvedAt: workflow.approvedAt ?? updatedCard.approvedAt,
                  isManager: workflow.isManager,
                  isManagerEligible: workflow.isManagerEligible,
                }
              : workflow,
          )
        : [updatedCard, ...current];
    });
    setUnpaidWorkflows((current) => {
      const existing = current.some((workflow) => workflow.id === updatedWorkflow.id);
      return existing
        ? current.map((workflow) => (workflow.id === updatedWorkflow.id ? updatedWorkflow : workflow))
        : [updatedWorkflow, ...current];
    });
    setSelectedWorkflow((current) => (current?.id === updatedWorkflow.id ? updatedWorkflow : current));
  }, [summarizeWorkflowForFeed]);

  const getInitialStepIndexForWorkflow = useCallback(
    (workflow: AppWorkflow): number => {
      const sortedSteps = [...workflow.steps].sort((left, right) => left.stepOrder - right.stepOrder);
      const mineIndex = sortedSteps.findIndex(
        (step) =>
          step.assignedImproverId === user?.id &&
          (step.status === "available" || step.status === "in_progress" || step.status === "locked"),
      );
      if (mineIndex >= 0) {
        return mineIndex;
      }
      const claimableIndex = sortedSteps.findIndex((step) => canClaimStep(workflow, step));
      return claimableIndex >= 0 ? claimableIndex : 0;
    },
    [canClaimStep, user?.id],
  );

  const openWorkflowDetail = useCallback(
    async (workflow: AppWorkflow | AppImproverWorkflowListItem) => {
      detailScrollYRef.current = 0;
      pendingDetailScrollYRef.current = null;
      setSelectedWorkflow(isFullWorkflow(workflow) ? workflow : null);
      setDetailStepIndex(
        isFullWorkflow(workflow) ? getInitialStepIndexForWorkflow(workflow) : getInitialStepIndexForWorkflowCard(workflow),
      );
      setDetailVisible(true);
      setSubmissionDetailsOpen({});
      if (workflow.recurrence !== "one_time") {
        void loadAbsenceData();
      }
      if (!backendClient) {
        return;
      }
      setDetailLoading(true);
      try {
        const refreshedWorkflow = await backendClient.getWorkflow(workflow.id);
        mergeWorkflow(refreshedWorkflow);
        setSelectedWorkflow(refreshedWorkflow);
        setDetailStepIndex(getInitialStepIndexForWorkflow(refreshedWorkflow));
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToLoadWorkflowDetails"));
      } finally {
        setDetailLoading(false);
      }
    },
    [backendClient, getInitialStepIndexForWorkflow, loadAbsenceData, mergeWorkflow],
  );

  const refreshSelectedWorkflow = useCallback(
    async (workflowId: string) => {
      if (!backendClient) {
        return;
      }
      try {
        const refreshedWorkflow = await backendClient.getWorkflow(workflowId);
        mergeWorkflow(refreshedWorkflow);
      } catch {
        // Keep current in-memory state if detail refresh fails.
      }
    },
    [backendClient, mergeWorkflow],
  );

  const refreshWorkflowSurfaces = useCallback(
    async (includeUnpaid = unpaidDataLoaded || workflowView === "unpaid-workflows") => {
      await Promise.all([
        loadWorkflowData(true),
        loadAbsenceData(true),
        includeUnpaid ? loadUnpaidData(true) : Promise.resolve(),
      ]);
    },
    [loadAbsenceData, loadUnpaidData, loadWorkflowData, unpaidDataLoaded, workflowView],
  );

  const handleWorkflowRefresh = useCallback(async () => {
    setWorkflowRefreshing(true);
    try {
      await refreshWorkflowSurfaces(true);
      if (selectedWorkflow?.id) {
        await refreshSelectedWorkflow(selectedWorkflow.id);
      }
    } finally {
      setWorkflowRefreshing(false);
    }
  }, [refreshSelectedWorkflow, refreshWorkflowSurfaces, selectedWorkflow?.id]);

  const setCompletionItemError = useCallback((stepId: string, itemId: string, message: string) => {
    setItemErrors((current) => ({
      ...current,
      [getCompletionItemErrorKey(stepId, itemId)]: message,
    }));
  }, []);

  const setItemForm = useCallback((stepId: string, itemId: string, patch: Partial<CompletionItemForm>) => {
    setStepErrors((current) => {
      if (!current[stepId]) {
        return current;
      }
      const next = { ...current };
      delete next[stepId];
      return next;
    });
    setItemErrors((current) => {
      const key = getCompletionItemErrorKey(stepId, itemId);
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    setCompletionForms((current) => {
      const stepForms = current[stepId] || {};
      const existing = stepForms[itemId] || emptyItemForm();
      return {
        ...current,
        [stepId]: {
          ...stepForms,
          [itemId]: {
            ...existing,
            ...patch,
          },
        },
      };
    });
  }, []);

  const setStepNotPossibleForm = useCallback((stepId: string, patch: Partial<StepNotPossibleForm>) => {
    setStepErrors((current) => {
      if (!current[stepId]) {
        return current;
      }
      const next = { ...current };
      delete next[stepId];
      return next;
    });
    setStepNotPossibleForms((current) => ({
      ...current,
      [stepId]: {
        ...(current[stepId] || emptyStepNotPossibleForm()),
        ...patch,
      },
    }));
  }, []);

  const ensurePhotoPreviewUri = useCallback(
    async (photoId: string) => {
      if (!backendClient) {
        return;
      }
      const trimmed = photoId.trim();
      if (!trimmed || photoPreviewUris[trimmed] || photoPreviewLoading[trimmed]) {
        return;
      }

      setPhotoPreviewLoading((current) => ({
        ...current,
        [trimmed]: true,
      }));

      try {
        const dataUri = await backendClient.getWorkflowPhotoDataUri(trimmed);
        if (dataUri) {
          setPhotoPreviewUris((current) => ({
            ...current,
            [trimmed]: dataUri,
          }));
        }
      } catch {
        // Keep the rest of the detail view functional even if preview loading fails.
      } finally {
        setPhotoPreviewLoading((current) => {
          if (!current[trimmed]) {
            return current;
          }
          const next = { ...current };
          delete next[trimmed];
          return next;
        });
      }
    },
    [backendClient, photoPreviewLoading, photoPreviewUris],
  );

  const removeCompletionPhoto = useCallback(
    (stepId: string, itemId: string, photoId: string) => {
      const currentPhotos = completionForms[stepId]?.[itemId]?.photos || [];
      setItemForm(stepId, itemId, {
        photos: currentPhotos.filter((photo) => photo.id !== photoId),
      });
    },
    [completionForms, setItemForm],
  );

  const createCompletionPhoto = useCallback((base64: string, title: string, contentType = "image/jpeg"): CompletionPhoto => {
    const normalizedBase64 = base64.trim();
    return {
      id: `photo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      fileName: `${slugifyFileName(title)}_${Date.now()}.${contentType.includes("png") ? "png" : "jpg"}`,
      contentType,
      dataBase64: normalizedBase64,
      previewUri: `data:${contentType};base64,${normalizedBase64}`,
      sizeBytes: estimateBase64Bytes(normalizedBase64),
    };
  }, []);

  const addPhotosToItem = useCallback(
    (stepId: string, itemId: string, photos: CompletionPhoto[], maxCount: number | null) => {
      const currentPhotos = completionForms[stepId]?.[itemId]?.photos || [];
      let nextPhotos = [...currentPhotos, ...photos];
      if (typeof maxCount === "number" && maxCount > 0) {
        nextPhotos = nextPhotos.slice(-maxCount);
      }
      setItemForm(stepId, itemId, { photos: uniqueBy(nextPhotos, (photo) => photo.id) });
    },
    [completionForms, setItemForm],
  );

  const restoreDetailScrollPosition = useCallback((attempt = 0) => {
    requestAnimationFrame(() => {
      const y = pendingDetailScrollYRef.current;
      if (typeof y === "number" && detailScrollRef.current) {
        detailScrollRef.current.scrollTo({ y, animated: false });
        pendingDetailScrollYRef.current = null;
        return;
      }
      if (attempt < 6) {
        setTimeout(() => restoreDetailScrollPosition(attempt + 1), 50);
      }
    });
  }, []);

  useEffect(() => {
    if (cameraTarget || !detailVisible) {
      return;
    }
    if (pendingDetailScrollYRef.current !== null) {
      restoreDetailScrollPosition();
    }
  }, [cameraTarget, detailVisible, restoreDetailScrollPosition]);

  useEffect(() => {
    if (!detailVisible && imagePreviewHost === "detail") {
      closeImagePreview();
    }
  }, [closeImagePreview, detailVisible, imagePreviewHost]);

  const openCameraCapture = useCallback(
    async (stepId: string, itemId: string, title: string, aspectRatio: AppWorkflowPhotoAspectRatio, maxCount: number | null) => {
      setCameraError(null);
      pendingDetailScrollYRef.current = detailScrollYRef.current;
      setCameraTarget({
        stepId,
        itemId,
        title,
        aspectRatio,
        maxCount,
      });
      // A blocked camera gets an explanation and a way to Settings from
      // askCamera(), not an endless "Waiting for camera permission".
      const wasBlocked = cameraAccess === "blocked";
      if (!(await askCamera())) {
        setCameraTarget(null);
        // A blocked camera already got the Settings prompt from askCamera().
        if (!wasBlocked) {
          setCompletionItemError(stepId, itemId, t("improver.cameraPermissionIsRequiredTo"));
        }
      }
    },
    [askCamera, cameraAccess, setCompletionItemError],
  );

  const captureWorkflowPhoto = useCallback(async () => {
    if (!cameraTarget) {
      return;
    }
    triggerClickHaptic(hapticsEnabled, "selection");
    setCameraError(null);
    try {
      const result = await (cameraRef.current as any)?.takePictureAsync({
        base64: true,
        quality: 0.45,
        skipProcessing: false,
      });
      const base64 = typeof result?.base64 === "string" ? result.base64.trim() : "";
      if (!base64) {
        throw new Error(t("improver.unableToCaptureAPhoto"));
      }
      const photo = createCompletionPhoto(base64, cameraTarget.title, "image/jpeg");
      if (photo.sizeBytes > MAX_MOBILE_WORKFLOW_PHOTO_BYTES) {
        throw new Error(t("improver.thatPhotoIsTooLarge"));
      }
      addPhotosToItem(cameraTarget.stepId, cameraTarget.itemId, [photo], cameraTarget.maxCount);
      setCameraTarget(null);
    } catch (nextError) {
      setCameraError((nextError as Error)?.message || t("improver.unableToCaptureAWorkflow"));
    }
  }, [addPhotosToItem, cameraTarget, createCompletionPhoto, hapticsEnabled]);

  const pickLibraryPhotos = useCallback(
    async (stepId: string, itemId: string, title: string, maxCount: number | null) => {
      if (!OPTIONAL_IMAGE_PICKER?.launchImageLibraryAsync) {
        setCompletionItemError(stepId, itemId, t("improver.photoLibraryUploadsAreNot"));
        return;
      }
      try {
        const result = await OPTIONAL_IMAGE_PICKER.launchImageLibraryAsync({
          mediaTypes:
            OPTIONAL_IMAGE_PICKER.MediaTypeOptions?.Images ?? OPTIONAL_IMAGE_PICKER.MediaType?.images ?? ["images"],
          allowsMultipleSelection: maxCount === null || maxCount > 1,
          selectionLimit: maxCount === null ? 10 : Math.max(1, maxCount),
          quality: 0.45,
          base64: true,
        });

        if (result?.canceled) {
          return;
        }

        const assets = Array.isArray(result?.assets) ? result.assets : [];
        const nextPhotos = assets.map((asset: any, index: number) => {
          const base64 = typeof asset?.base64 === "string" ? asset.base64.trim() : "";
          if (!base64) {
            throw new Error(t("improver.oneOfTheSelectedPhotos"));
          }
          const contentType = typeof asset?.mimeType === "string" && asset.mimeType.startsWith("image/")
            ? asset.mimeType
            : "image/jpeg";
          const photo = createCompletionPhoto(base64, `${title}_${index + 1}`, contentType);
          if (photo.sizeBytes > MAX_MOBILE_WORKFLOW_PHOTO_BYTES) {
            throw new Error(t("improver.oneOfTheSelectedPhotos2"));
          }
          return photo;
        });

        if (nextPhotos.length > 0) {
          addPhotosToItem(stepId, itemId, nextPhotos, maxCount);
          setError(null);
        }
      } catch (nextError) {
        setCompletionItemError(stepId, itemId, (nextError as Error)?.message || t("improver.unableToAttachLibraryPhotos"));
      }
    },
    [addPhotosToItem, createCompletionPhoto, setCompletionItemError],
  );

  const buildCompletionPayload = useCallback(
    (workflow: AppWorkflow, step: AppWorkflowStep): AppWorkflowStepCompletionInput => {
      const notPossibleForm = stepNotPossibleForms[step.id] || emptyStepNotPossibleForm();
      if (step.allowStepNotPossible && notPossibleForm.selected) {
        const details = notPossibleForm.details.trim();
        if (!details) {
          throw new Error(t("improver.explainWhyThisStepCannot"));
        }
        return {
          stepNotPossible: true,
          stepNotPossibleDetails: details,
          items: [],
        };
      }

      const items: AppWorkflowStepCompletionInput["items"] = [];
      const stepForms = completionForms[step.id] || {};
      for (const item of step.workItems) {
        const form = stepForms[item.id] || emptyItemForm();
        const dropdownValue = form.dropdown.trim();
        const writtenResponse = form.written.trim();
        const selectedOption = dropdownValue
          ? item.dropdownOptions.find((option) => option.value === dropdownValue)
          : undefined;
        const dropdownRequiresPhoto = Boolean(selectedOption?.requiresPhotoAttachment);
        const requiresWritten =
          item.requiresWrittenResponse ||
          (dropdownValue ? Boolean(item.dropdownRequiresWrittenResponse[dropdownValue]) : false);
        const requiresPhoto = item.requiresPhoto || dropdownRequiresPhoto;
        const anyInput = form.photos.length > 0 || dropdownValue.length > 0 || writtenResponse.length > 0;

        if (!item.optional && !anyInput) {
          throw new Error(t("improver.missingResponseFor", { title: item.title }));
        }
        if (item.requiresDropdown && !dropdownValue) {
          throw new Error(t("improver.chooseAnOptionFor", { title: item.title }));
        }
        if (requiresWritten && !writtenResponse) {
          throw new Error(t("improver.enterAWrittenResponseFor", { title: item.title }));
        }
        if (requiresPhoto) {
          if (item.requiresPhoto && item.photoAllowAnyCount) {
            if (form.photos.length === 0) {
              throw new Error(t("improver.addAtLeastOnePhoto", { title: item.title }));
            }
          } else if (item.requiresPhoto) {
            const requiredCount = Math.max(1, item.photoRequiredCount || 1);
            if (form.photos.length !== requiredCount) {
              throw new Error(t("improver.addExactlyPhotos", { count: requiredCount, title: item.title }));
            }
          } else if (form.photos.length === 0) {
            throw new Error(t("improver.addAPhotoFor", { title: item.title }));
          }
        }
        if (!anyInput && item.optional) {
          continue;
        }

        items.push({
          itemId: item.id,
          photoUploads:
            form.photos.length > 0
              ? form.photos.map((photo) => ({
                  fileName: photo.fileName,
                  contentType: photo.contentType,
                  dataBase64: photo.dataBase64,
                }))
              : undefined,
          writtenResponse: writtenResponse || undefined,
          dropdownValue: dropdownValue || undefined,
        });
      }

      return {
        stepNotPossible: false,
        items,
      };
    },
    [completionForms, stepNotPossibleForms],
  );

  const completeWorkflowStep = useCallback(
    async (workflow: AppWorkflow, step: AppWorkflowStep) => {
      if (!backendClient) {
        return;
      }
      setStepErrors((current) => {
        if (!current[step.id]) {
          return current;
        }
        const next = { ...current };
        delete next[step.id];
        return next;
      });
      setActionKey(`complete:${step.id}`);
      try {
        const payload = buildCompletionPayload(workflow, step);
        const updatedWorkflow = await backendClient.completeWorkflowStep(workflow.id, step.id, payload);
        mergeWorkflow(updatedWorkflow);

        // Their role may cover a later step of this same workflow. Move to it
        // rather than leaving them looking at the step they just finished —
        // which read as "you are done here" when they were not.
        const nextIndex = nextActionableAssignedStepIndex(updatedWorkflow, user?.id, step.stepOrder);
        if (nextIndex >= 0) {
          const nextStep = [...updatedWorkflow.steps].sort((left, right) => left.stepOrder - right.stepOrder)[nextIndex];
          setDetailStepIndex(nextIndex);
          setNotice(
            payload.stepNotPossible
              ? t("improver.stepMarkedNotPossibleYou", { stepOrder: nextStep.stepOrder, title: nextStep.title })
              : t("improver.stepCompletedYouReAlso", { stepOrder: nextStep.stepOrder, title: nextStep.title }),
          );
        } else {
          setNotice(payload.stepNotPossible ? t("improver.stepMarkedNotPossible") : t("improver.workflowStepCompleted"));
        }
        setError(null);
        setCompletionForms((current) => {
          if (!current[step.id]) {
            return current;
          }
          const next = { ...current };
          delete next[step.id];
          return next;
        });
        setItemErrors((current) => {
          const nextEntries = Object.entries(current).filter(([key]) => !key.startsWith(`${step.id}:`));
          if (nextEntries.length === Object.keys(current).length) {
            return current;
          }
          return nextEntries.reduce<Record<string, string>>((next, [key, value]) => {
            next[key] = value;
            return next;
          }, {});
        });
        setStepNotPossibleForms((current) => {
          if (!current[step.id]) {
            return current;
          }
          const next = { ...current };
          delete next[step.id];
          return next;
        });
        await refreshWorkflowSurfaces();
        await refreshSelectedWorkflow(workflow.id);
      } catch (nextError) {
        const message = (nextError as Error)?.message || t("improver.unableToCompleteThisWorkflow");
        setStepErrors((current) => ({
          ...current,
          [step.id]: message,
        }));
      } finally {
        setActionKey("");
      }
    },
    [backendClient, buildCompletionPayload, mergeWorkflow, refreshSelectedWorkflow, refreshWorkflowSurfaces, user?.id],
  );

  const requestPayoutRetry = useCallback(
    async (workflowId: string, stepId: string) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`retry:${stepId}`);
      try {
        const updatedWorkflow = await backendClient.requestWorkflowStepPayoutRetry(workflowId, stepId);
        mergeWorkflow(updatedWorkflow);
        setNotice(t("improver.payoutRetryRequested"));
        setError(null);
        await loadUnpaidData(true);
        await refreshSelectedWorkflow(workflowId);
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToRequestPayoutRetry"));
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, loadUnpaidData, mergeWorkflow, refreshSelectedWorkflow],
  );

  const requestWorkflowPayoutRetries = useCallback(
    async (workflow: AppWorkflow) => {
      if (!backendClient) {
        return;
      }
      const failedSteps = workflow.steps.filter(
        (step) =>
          step.assignedImproverId === user?.id &&
          step.status === "completed" &&
          step.bounty > 0 &&
          Boolean(step.payoutError?.trim()),
      );
      if (failedSteps.length === 0) {
        return;
      }

      setActionKey(`retry-workflow:${workflow.id}`);
      try {
        for (const step of failedSteps) {
          await backendClient.requestWorkflowStepPayoutRetry(workflow.id, step.id);
        }
        setNotice(failedSteps.length === 1 ? t("improver.payoutRetryRequested") : t("improver.payoutRetriesRequested", { count: failedSteps.length }));
        setError(null);
        await loadUnpaidData(true);
        await refreshSelectedWorkflow(workflow.id);
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToRequestPayoutRetries"));
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, loadUnpaidData, refreshSelectedWorkflow, user?.id],
  );

  const claimWorkflowStep = useCallback(
    async (workflowId: string, stepId: string) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`claim:${stepId}`);
      try {
        const updatedWorkflow = await backendClient.claimWorkflowStep(workflowId, stepId);
        mergeWorkflow(updatedWorkflow);
        setWorkflowView("my-workflows");
        setWorkflowEditMode(false);
        setSelectedWorkflowKeys([]);
        setNotice(t("improver.workflowStepClaimed"));
        setError(null);
        void openWorkflowDetail(updatedWorkflow);
        await refreshWorkflowSurfaces();
      } catch (nextError) {
        // The backend returns a specific reason for every claim rejection
        // (400 not claimable, 409 already claimed / absence, 403 credentials).
        // The banner alone sits at the top of a long scroll and is easy to miss,
        // which is what made a real status mismatch look like a dead button.
        const message = describeClaimFailure(nextError);
        setError(message);
        setNotice(null);
        Alert.alert(t("improver.couldNotClaimThisStep"), message);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, mergeWorkflow, openWorkflowDetail, refreshWorkflowSurfaces],
  );

  const startWorkflowStep = useCallback(
    async (workflowId: string, stepId: string) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`start:${stepId}`);
      try {
        const updatedWorkflow = await backendClient.startWorkflowStep(workflowId, stepId);
        mergeWorkflow(updatedWorkflow);
        setNotice(t("improver.workflowStepStarted"));
        setError(null);
        await refreshWorkflowSurfaces();
        await refreshSelectedWorkflow(workflowId);
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToStartThisWorkflow"));
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, mergeWorkflow, refreshSelectedWorkflow, refreshWorkflowSurfaces],
  );

  const requestCredential = useCallback(
    async (credentialType: string) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`credential:${credentialType}`);
      try {
        await backendClient.createImproverCredentialRequest(credentialType);
        setNotice(t("improver.requestedCredential", { credential: formatCredentialLabel(credentialType, labelMap) }));
        setError(null);
        await loadCredentialData(true);
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToRequestThatCredential"));
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, labelMap, loadCredentialData],
  );

  const requestImproverAccess = useCallback(async () => {
    if (!backendClient) {
      setError(t("improver.theSharedAppBackendIs"));
      setNotice(null);
      return;
    }
    const accountEmail = user?.contactEmail?.trim() || "";
    if (!requestFirstName.trim() || !requestLastName.trim()) {
      setError(t("improver.firstAndLastNameAre"));
      setNotice(null);
      return;
    }
    if (!accountEmail) {
      setError(t("improver.addAnEmailToYour"));
      setNotice(null);
      return;
    }
    setActionKey("request-improver");
    try {
      const nextImprover = await backendClient.requestImproverStatus({
        firstName: requestFirstName.trim(),
        lastName: requestLastName.trim(),
        email: accountEmail,
      });
      onImproverUpdated?.(nextImprover);
      await onRefreshProfile();
      setNotice(
        nextImprover.status === "approved"
          ? t("improver.improverAccessIsActive")
          : t("improver.improverRequestSubmitted"),
      );
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || t("improver.unableToSubmitImproverRequest"));
      setNotice(null);
    } finally {
      setActionKey("");
    }
  }, [
    backendClient,
    onImproverUpdated,
    onRefreshProfile,
    requestFirstName,
    requestLastName,
    user?.contactEmail,
  ]);

  const revokeAbsence = useCallback(
    async (absenceId: string) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`absence-delete:${absenceId}`);
      try {
        await backendClient.deleteImproverAbsencePeriod(absenceId);
        setNotice(t("improver.absenceRevoked"));
        setError(null);
        await refreshWorkflowSurfaces();
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToRevokeAbsence"));
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, refreshWorkflowSurfaces],
  );

  // Bulk revoke is confirmed with an in-app styled modal (not a native alert).
  const revokeSelectedWorkflows = useCallback(() => {
    if (selectedWorkflowGroups.length === 0 || !backendClient) {
      return;
    }
    setRevokeConfirmVisible(true);
  }, [backendClient, selectedWorkflowGroups.length]);

  const confirmRevokeSelectedWorkflows = useCallback(() => {
    setRevokeConfirmVisible(false);
    if (selectedWorkflowGroups.length === 0 || !backendClient) {
      return;
    }
    void (async () => {
      setActionKey("bulk-revoke");
      try {
        for (const group of selectedWorkflowGroups) {
          if (group.primaryStepOrder === null) {
            continue;
          }
          await backendClient.unclaimImproverWorkflowSeries(group.seriesId, group.primaryStepOrder);
        }
        setNotice(
          selectedWorkflowGroups.length === 1
            ? t("improver.selectedWorkflowRevoked")
            : t("improver.workflowsRevoked", { count: selectedWorkflowGroups.length }),
        );
        setError(null);
        setWorkflowEditMode(false);
        setSelectedWorkflowKeys([]);
        await refreshWorkflowSurfaces();
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToRevokeSelectedWorkflows"));
        setNotice(null);
      } finally {
        setActionKey("");
      }
    })();
  }, [backendClient, refreshWorkflowSurfaces, selectedWorkflowGroups]);

  // Editable (recurring) groups that a valid absence request can target: either
  // the current selection, or — when "all workflows" is checked — every one.
  const absenceTargetGroups = useMemo(() => {
    const editable = (group: WorkflowSeriesGroup) =>
      group.recurrence !== "one_time" && group.primaryStepOrder !== null;
    return absenceAllWorkflows
      ? myWorkflowGroups.filter(editable)
      : selectedWorkflowGroups.filter(editable);
  }, [absenceAllWorkflows, myWorkflowGroups, selectedWorkflowGroups]);

  const closeAbsenceScreen = useCallback(() => {
    setAbsenceScreenVisible(false);
    setAbsencePickerField(null);
    // If the screen was opened directly (e.g. from a step, not via multi-select
    // edit mode), drop the transient pre-selection so it doesn't linger.
    if (!workflowEditMode) {
      setSelectedWorkflowKeys([]);
    }
  }, [workflowEditMode]);

  const saveAbsenceCoverage = useCallback(() => {
    if (!backendClient) {
      return;
    }
    if (!isValidDateInput(absenceFrom) || !isValidDateInput(absenceUntil)) {
      setError(t("improver.chooseBothAbsenceDates"));
      setNotice(null);
      return;
    }
    if (absenceFrom > absenceUntil) {
      setError(t("improver.absentEndDateMustBe"));
      setNotice(null);
      return;
    }
    if (absenceTargetGroups.length === 0) {
      setError(t("improver.selectAtLeastOneWorkflow"));
      setNotice(null);
      return;
    }

    void (async () => {
      setActionKey("bulk-absence");
      try {
        const summaries: AppImproverAbsencePeriodCreateResult[] = [];
        for (const group of absenceTargetGroups) {
          if (group.primaryStepOrder === null) {
            continue;
          }
          summaries.push(
            await backendClient.createImproverAbsencePeriod({
              seriesId: group.seriesId,
              stepOrder: group.primaryStepOrder,
              absentFrom: absenceFrom,
              absentUntil: absenceUntil,
            }),
          );
        }
        const released = summaries.reduce((sum, entry) => sum + entry.releasedCount, 0);
        const skipped = summaries.reduce((sum, entry) => sum + entry.skippedCount, 0);
        setNotice(
          skipped > 0
            ? t("improver.absenceSavedReleasedAssignmentsAnd", { released, skipped })
            : t("improver.absenceSavedReleasedAssignments", { released }),
        );
        setError(null);
        setAbsenceScreenVisible(false);
        setWorkflowEditMode(false);
        setSelectedWorkflowKeys([]);
        setAbsenceFrom("");
        setAbsenceUntil("");
        setAbsenceAllWorkflows(false);
        await refreshWorkflowSurfaces();
      } catch (nextError) {
        setError((nextError as Error)?.message || t("improver.unableToSaveAbsenceCoverage"));
        setNotice(null);
      } finally {
        setActionKey("");
      }
    })();
  }, [absenceFrom, absenceUntil, absenceTargetGroups, backendClient, refreshWorkflowSurfaces]);

  // Open the dedicated absence screen, optionally pre-selecting one series.
  const openAbsenceScreen = useCallback((preselectKey?: string) => {
    if (preselectKey) {
      setSelectedWorkflowKeys([preselectKey]);
    }
    setAbsenceAllWorkflows(false);
    setAbsenceFrom("");
    setAbsenceUntil("");
    setError(null);
    setAbsenceScreenVisible(true);
  }, []);

  const currentWorkflowOptionsLabel =
    workflowSelectorOptions.find((option) => option.value === workflowView)?.label || t("improver.myWorkflows");

  const selectedWorkflowAssignedStep = useMemo(
    () => (selectedWorkflow ? resolveAssignedStep(selectedWorkflow, user?.id) : null),
    [selectedWorkflow, user?.id],
  );

  const selectedWorkflowAbsence = useMemo(() => {
    if (!selectedWorkflowAssignedStep || !selectedWorkflow) {
      return null;
    }
    return (
      absencePeriods
        .filter(
          (period) =>
            period.seriesId === selectedWorkflow.seriesId &&
            period.stepOrder === selectedWorkflowAssignedStep.stepOrder &&
            period.absentUntil * 1000 >= Date.now(),
        )
        .sort((left, right) => left.absentFrom - right.absentFrom)[0] || null
    );
  }, [absencePeriods, selectedWorkflow, selectedWorkflowAssignedStep]);

  const canRevokeSelectedWorkflowAbsence = useMemo(() => {
    if (!selectedWorkflowAbsence || !selectedWorkflowAssignedStep || !selectedWorkflow || !user?.id) {
      return false;
    }
    return true;
  }, [selectedWorkflowAbsence, selectedWorkflowAssignedStep, selectedWorkflow, user?.id]);

  // Workflow revocation moved to the edit menu, so the detail actions row now
  // only appears when there's a saved absence period to revoke.
  const shouldShowSelectedWorkflowActions = Boolean(
    selectedWorkflowAbsence && canRevokeSelectedWorkflowAbsence,
  );

  const sortedDetailSteps = useMemo(
    () => (selectedWorkflow ? [...selectedWorkflow.steps].sort((left, right) => left.stepOrder - right.stepOrder) : []),
    [selectedWorkflow],
  );
  const currentDetailStepIndex = Math.min(detailStepIndex, Math.max(sortedDetailSteps.length - 1, 0));
  const myStepOrders = useMemo(
    () => (selectedWorkflow ? assignedStepOrders(selectedWorkflow, user?.id) : []),
    [selectedWorkflow, user?.id],
  );
  const currentDetailStep = sortedDetailSteps[currentDetailStepIndex] || null;
  const detailSubmissionExpanded = currentDetailStep ? Boolean(submissionDetailsOpen[currentDetailStep.id]) : false;
  const currentDetailStepHasCompletionForm = Boolean(
    currentDetailStep &&
      currentDetailStep.assignedImproverId === user?.id &&
      (currentDetailStep.status === "available" || currentDetailStep.status === "in_progress"),
  );

  useEffect(() => {
    if (!detailVisible) {
      setSubmissionDetailsOpen({});
    }
  }, [detailVisible]);

  useEffect(() => {
    if (!currentDetailStep?.submission || currentDetailStep.submission.stepNotPossible) {
      return;
    }
    const photoIds = uniqueBy(
      currentDetailStep.submission.itemResponses.flatMap((response) => response.photoIds || []),
      (photoId) => photoId,
    );
    for (const photoId of photoIds) {
      void ensurePhotoPreviewUri(photoId);
    }
  }, [currentDetailStep, ensurePhotoPreviewUri]);

  const renderStatusChip = (label: string, tone: "default" | "success" | "danger" | "warning" = "default") => {
    const toneStyle =
      tone === "success"
        ? styles.statusChipSuccess
        : tone === "danger"
          ? styles.statusChipDanger
          : tone === "warning"
            ? styles.statusChipWarning
            : styles.statusChipDefault;
    const textStyle =
      tone === "success"
        ? styles.statusChipTextSuccess
        : tone === "danger"
          ? styles.statusChipTextDanger
          : tone === "warning"
            ? styles.statusChipTextWarning
            : styles.statusChipTextDefault;
    return (
      <View style={[styles.statusChip, toneStyle]}>
        <Text style={[styles.statusChipText, textStyle]}>{label}</Text>
      </View>
    );
  };

  const renderBannerStack = () => (
    <>
      {error ? (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={styles.errorCardText}>{error}</Text>
        </View>
      ) : null}

      {notice ? (
        <View style={styles.noticeCard}>
          <Ionicons name="checkmark-circle-outline" size={18} color={palette.success} />
          <Text style={styles.noticeCardText}>{notice}</Text>
        </View>
      ) : null}
    </>
  );

  const renderLoadingCard = (label: string) => (
    <View style={styles.loadingInlineCard}>
      <ThemedActivityIndicator size="small" color={palette.primaryStrong} />
      <Text style={styles.loadingInlineText}>{label}</Text>
    </View>
  );

  const renderLoadingIndicatorCard = () => (
    <View style={styles.loadingInlineCard}>
      <ThemedActivityIndicator size="small" color={palette.primaryStrong} />
    </View>
  );

  const renderEmptyCard = (title: string, body: string) => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );

  const renderRequestAccess = () => {
    const statusTone =
      improver?.status === "approved"
        ? "success"
        : improver?.status === "rejected"
          ? "danger"
          : "warning";
    const requestFormBusy = actionKey === "request-improver";
    const accountEmail = user?.contactEmail?.trim() || "";
    const requestButtonLabel = requestFormBusy
      ? t("improver.submitting")
      : improver?.status === "pending"
        ? t("improver.updateRequest")
        : improver?.status === "rejected"
          ? t("improver.resubmitRequest")
          : t("improver.submit");
    const requestHelpText = accountEmail
      ? t("improver.thisRequestWillUseThe", { accountEmail })
      : t("improver.addAnEmailToYour2");

    return (
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Money being held sits above everything else: it is the thing that
            needs doing, and it is the reason a bounty has not arrived. */}
        {onStartW9 ? (
          <W9EscrowCard status={w9Status ?? null} busy={w9Busy} onStart={onStartW9} />
        ) : null}

        {renderBannerStack()}

        {improver ? (
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t("improver.currentRequest")}</Text>
              {renderStatusChip(formatStatusLabel(improver.status), statusTone)}
            </View>
            <Text style={styles.meta}>{`${improver.firstName} ${improver.lastName}`.trim()}</Text>
            <Text style={styles.meta}>{improver.email}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("improver.becomeAnImprover")}</Text>
          {improver?.status === "pending" ? (
            <Text style={styles.body}>{t("improver.yourRequestIsPendingYou")}</Text>
          ) : improver?.status === "rejected" ? (
            <Text style={styles.body}>{t("improver.yourPreviousRequestWasNot")}</Text>
          ) : (
            <Text style={styles.body}>{t("improver.submitYourNameToEnable")}</Text>
          )}
          <TextInput
            style={styles.input}
            placeholder={t("improver.firstName")}
            placeholderTextColor={palette.textMuted}
            value={requestFirstName}
            onChangeText={(value) => {
              setRequestFirstName(value);
              if (error || notice) {
                setError(null);
                setNotice(null);
              }
            }}
          />
          <TextInput
            style={styles.input}
            placeholder={t("improver.lastName")}
            placeholderTextColor={palette.textMuted}
            value={requestLastName}
            onChangeText={(value) => {
              setRequestLastName(value);
              if (error || notice) {
                setError(null);
                setNotice(null);
              }
            }}
          />
          <Text style={styles.meta}>{requestHelpText}</Text>
          <Pressable
            style={[
              styles.primaryButton,
              requestFormBusy ? styles.buttonDisabled : undefined,
            ]}
            disabled={requestFormBusy}
            onPress={() => {
              void requestImproverAccess();
            }}
          >
            <Text style={styles.primaryButtonText}>{requestButtonLabel}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  };

  if (!canUsePanel) {
    return renderRequestAccess();
  }

  const renderMyWorkflowCard = (group: WorkflowSeriesGroup) => {
    const focusWorkflow =
      group.workflows.find((workflow) => isWorkflowCardActiveForUser(workflow)) || group.workflows[0];
    const selected = selectedWorkflowKeys.includes(group.key);
    const isEditable = group.recurrence !== "one_time";

    return (
      <Pressable
        key={group.key}
        style={[
          styles.card,
          workflowEditMode && selected ? styles.cardSelected : undefined,
        ]}
        onPress={() => {
          if (workflowEditMode && isEditable) {
            setSelectedWorkflowKeys((current) =>
              current.includes(group.key)
                ? current.filter((value) => value !== group.key)
                : [...current, group.key],
            );
            return;
          }
          void openWorkflowDetail(focusWorkflow);
        }}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.workflowTitle} numberOfLines={2}>
              {group.workflowTitle}
            </Text>
            <Text style={styles.meta}>
              {group.primaryStepOrder === null
                ? group.primaryStepTitle || t("improver.assignedStep")
                : t("improver.stepTitle", { step: group.primaryStepOrder, title: group.primaryStepTitle })}
            </Text>
            <Text style={styles.meta}>{t("improver.nextDate", { date: formatWorkflowDate(focusWorkflow.startAt) })}</Text>
          </View>
          <View style={styles.cardBadgeStack}>
            {renderStatusChip(formatWorkflowDisplayStatus(focusWorkflow), resolveWorkflowTone(focusWorkflow))}
            {group.absence ? (
              renderStatusChip(
                t("improver.absentUntil2", { date: formatDateFromUnix(group.absence.absentUntil, true) }),
                "warning",
              )
            ) : null}
            {workflowEditMode && isEditable ? (
              <Ionicons
                name={selected ? "checkmark-circle" : "ellipse-outline"}
                size={20}
                color={selected ? palette.primaryStrong : palette.textMuted}
              />
            ) : null}
          </View>
        </View>
        {group.workflows.length > 1 ? (
          <Text style={styles.meta}>
            {t("improver.upcomingAssignments", { count: group.workflows.length })}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const renderWorkflowBoardCard = (workflow: AppImproverWorkflowListItem) => {
    const claimableStep = workflow.claimableStep;
    return (
      <Pressable key={workflow.id} style={styles.card} onPress={() => void openWorkflowDetail(workflow)}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.workflowTitle} numberOfLines={2}>
              {workflow.title}
            </Text>
            {claimableStep ? (
              <Text style={styles.meta}>
                {t("improver.claimableStep", { step: claimableStep.stepOrder })}
                {claimableStep.title ? ` - ${claimableStep.title}` : ""}
              </Text>
            ) : null}
            <Text style={styles.meta}>{t("improver.startsDate", { date: formatWorkflowDate(workflow.startAt) })}</Text>
          </View>
          {renderStatusChip(formatWorkflowDisplayStatus(workflow), resolveWorkflowTone(workflow))}
        </View>
        {claimableStep ? (
          <Pressable
            style={[styles.primaryButton, actionKey === `claim:${claimableStep.id}` ? styles.buttonDisabled : undefined]}
            disabled={Boolean(actionKey)}
            onPress={() => {
              void claimWorkflowStep(workflow.id, claimableStep.id);
            }}
          >
            <Text style={styles.primaryButtonText}>
              {actionKey === `claim:${claimableStep.id}` ? t("improver.claiming") : t("improver.claimStep", { stepOrder: claimableStep.stepOrder })}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  const renderUnpaidWorkflowCard = (workflow: AppWorkflow) => {
    const unpaidSteps = workflow.steps.filter(
      (step) => step.assignedImproverId === user?.id && step.status === "completed" && step.bounty > 0,
    );
    const failedSteps = unpaidSteps.filter((step) => Boolean(step.payoutError?.trim()));
    return (
      <Pressable key={workflow.id} style={styles.card} onPress={() => void openWorkflowDetail(workflow)}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.workflowTitle} numberOfLines={2}>
              {workflow.title}
            </Text>
            <Text style={styles.meta}>{t("improver.pendingPayouts", { count: unpaidSteps.length })}</Text>
            {failedSteps.length > 0 ? (
              <Text style={styles.inlineError}>
                {failedSteps.length === 1 ? t("improver.1PayoutNeedsAttention") : t("improver.payoutsNeedAttention", { count: failedSteps.length })}
              </Text>
            ) : null}
          </View>
          {renderStatusChip(
            failedSteps.length > 0 ? t("improver.actionNeeded") : t("improver.pending"),
            failedSteps.length > 0 ? "danger" : "warning",
          )}
        </View>
        {failedSteps.length > 0 ? (
          <Pressable
            style={[styles.primaryButton, actionKey === `retry-workflow:${workflow.id}` ? styles.buttonDisabled : undefined]}
            disabled={Boolean(actionKey)}
            onPress={() => {
              void requestWorkflowPayoutRetries(workflow);
            }}
          >
            <Text style={styles.primaryButtonText}>
              {actionKey === `retry-workflow:${workflow.id}`
                ? t("improver.requesting")
                : failedSteps.length === 1
                  ? t("improver.retryFailedPayout")
                  : t("improver.retryFailedPayouts")}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  const renderWorkflowsContent = () => {
    const searchValue =
      workflowView === "my-workflows"
        ? myWorkflowsSearch
        : workflowView === "workflow-board"
          ? boardSearch
          : unpaidSearch;
    const setSearchValue =
      workflowView === "my-workflows"
        ? setMyWorkflowsSearch
        : workflowView === "workflow-board"
          ? setBoardSearch
          : setUnpaidSearch;
    const searchPlaceholder =
      workflowView === "my-workflows"
        ? t("improver.searchYourWorkflows")
        : workflowView === "workflow-board"
          ? t("improver.searchTheWorkflowBoard")
          : t("improver.searchUnpaidWorkflows");

    return (
      <View style={styles.sectionStack}>
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Pressable style={styles.selectorButton} onPress={() => setWorkflowSelectorVisible(true)}>
              <Text style={styles.selectorButtonText} numberOfLines={1}>{currentWorkflowOptionsLabel}</Text>
              <Ionicons name="chevron-down" size={16} color={palette.primaryStrong} />
            </Pressable>
            <View style={styles.headerActions}>
              {workflowView === "my-workflows" ? (
                <Pressable
                  style={[styles.checkboxPill, includePastWorkflows ? styles.checkboxPillActive : undefined]}
                  onPress={() => setIncludePastWorkflows((current) => !current)}
                >
                  <Ionicons
                    name={includePastWorkflows ? "checkbox" : "square-outline"}
                    size={16}
                    color={includePastWorkflows ? palette.white : palette.primaryStrong}
                  />
                  <Text style={[styles.checkboxPillText, includePastWorkflows ? styles.checkboxPillTextActive : undefined]}>
                    {t("improver.past")}
                  </Text>
                </Pressable>
              ) : null}
              {workflowView === "my-workflows" && myWorkflowGroups.some((group) => group.recurrence !== "one_time") ? (
                <Pressable
                  style={styles.compactActionButton}
                  onPress={() => {
                    setWorkflowEditMode((current) => !current);
                    setSelectedWorkflowKeys([]);
                  }}
                >
                  <Text style={styles.compactActionButtonText}>{workflowEditMode ? t("improver.done") : t("improver.edit")}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={palette.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder={searchPlaceholder}
              placeholderTextColor={palette.textMuted}
              value={searchValue}
              onChangeText={setSearchValue}
            />
          </View>
        </View>

        {workflowView === "my-workflows" && !workflowDataLoaded ? renderLoadingCard(t("improver.loadingWorkflows")) : null}
        {workflowView === "workflow-board" && (!workflowDataLoaded || !absenceDataLoaded)
          ? renderLoadingCard(t("improver.loadingWorkflowBoard"))
          : null}
        {workflowView === "unpaid-workflows" && !unpaidDataLoaded ? renderLoadingCard(t("improver.loadingUnpaidWorkflows")) : null}

        {workflowView === "my-workflows" && workflowDataLoaded
          ? filteredMyWorkflowGroups.length === 0
            ? renderEmptyCard(t("improver.noClaimedWorkflows"), t("improver.claimedWorkflowsWillAppearHere"))
            : filteredMyWorkflowGroups.map(renderMyWorkflowCard)
          : null}

        {workflowView === "workflow-board" && workflowDataLoaded && absenceDataLoaded
          ? filteredWorkflowBoard.length === 0
            ? renderEmptyCard(t("improver.noEligibleWorkflows"), t("improver.nothingIsClaimableForYour"))
            : filteredWorkflowBoard.map(renderWorkflowBoardCard)
          : null}

        {workflowView === "unpaid-workflows" && unpaidDataLoaded
          ? filteredUnpaidWorkflowCards.length === 0
            ? renderEmptyCard(t("improver.noUnpaidWorkflows"), t("improver.completedPayoutsWaitingOnSettlement"))
            : filteredUnpaidWorkflowCards.map(renderUnpaidWorkflowCard)
          : null}
      </View>
    );
  };

  const renderCredentialsContent = () => (
    <View style={styles.sectionStack}>
      <View style={styles.card}>
        <Pressable style={styles.primaryButton} onPress={() => setBadgesVisible(true)}>
          <Text style={styles.primaryButtonText}>{t("improver.myBadges")}</Text>
        </Pressable>
        {activeCredentials.length > 0 ? (
          <View style={styles.chipWrap}>
            {myBadgeItems.map((badge) => (
              <Pressable
                key={badge.credential}
                disabled={!badge.badgeUri}
                onPress={() => {
                  openCredentialBadgePreview(badge.credential, "credentials");
                }}
              >
                {renderStatusChip(badge.label, "default")}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t("improver.searchCredentialTypes")}
            placeholderTextColor={palette.textMuted}
            value={credentialSearch}
            onChangeText={setCredentialSearch}
          />
        </View>

        {credentialDataLoading && !credentialDataLoaded ? renderLoadingCard(t("improver.loadingCredentials")) : null}

        {credentialSuggestions.length > 0 ? (
          <View style={styles.stack}>
            {credentialSuggestions.map((credentialType) => {
              const hasBadgePreview = Boolean(buildCredentialBadgeUri(credentialType));
              return (
                <Pressable
                  key={credentialType.value}
                  style={styles.choiceRow}
                  disabled={!hasBadgePreview}
                  onPress={() => {
                    openCredentialBadgePreview(credentialType.value, "credentials");
                  }}
                >
                  <View style={styles.choiceCopy}>
                    <Text style={styles.choiceTitle}>{credentialType.label}</Text>
                    <Text style={styles.choiceBody}>
                      {pendingCredentialSet.has(credentialType.value) ? t("improver.requestAlreadyPending") : t("improver.availableToRequest")}
                    </Text>
                  </View>
                  <Pressable
                    style={[
                      styles.secondaryButton,
                      pendingCredentialSet.has(credentialType.value) || Boolean(actionKey) ? styles.buttonDisabled : undefined,
                    ]}
                    disabled={pendingCredentialSet.has(credentialType.value) || Boolean(actionKey)}
                    onPress={(event) => {
                      event.stopPropagation();
                      void requestCredential(credentialType.value);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {actionKey === `credential:${credentialType.value}` ? t("improver.sending") : t("improver.request")}
                    </Text>
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {credentialRequests.length > 0 ? (
          <View style={styles.stack}>
            <Text style={styles.stackLabel}>{t("improver.requestHistory")}</Text>
            {credentialRequests.map((request) => {
              const hasBadgePreview = Boolean(buildCredentialBadgeUri(credentialTypeByValue.get(request.credentialType)));
              return (
                <Pressable
                  key={request.id}
                  style={styles.subCard}
                  disabled={!hasBadgePreview}
                  onPress={() => {
                    openCredentialBadgePreview(request.credentialType, "credentials");
                  }}
                >
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.cardHeaderCopy}>
                      <Text style={styles.choiceTitle}>
                        {formatCredentialLabel(request.credentialType, labelMap)}
                      </Text>
                      <Text style={styles.choiceBody}>
                        {t("improver.requestedOn", { date: new Date(request.requestedAt).toLocaleString() })}
                      </Text>
                    </View>
                    {renderStatusChip(
                      formatStatusLabel(request.status),
                      request.status === "approved"
                        ? "success"
                        : request.status === "rejected"
                          ? "danger"
                          : "warning",
                    )}
                  </View>
                  {request.resolvedAt ? (
                    <Text style={styles.choiceBody}>
                      {t("improver.resolvedOn", { date: new Date(request.resolvedAt).toLocaleString() })}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : credentialDataLoaded ? (
          <Text style={styles.meta}>{t("improver.noCredentialRequestsYet")}</Text>
        ) : null}
      </View>
    </View>
  );

  const renderStepResponsePhotos = (response: { photoIds?: string[]; photoUrls?: string[]; photos?: Array<{ id: string; fileName: string }> }) => {
    const responsePhotoIds = response.photoIds || [];
    const responsePhotoUrls = response.photoUrls || [];
    if (responsePhotoIds.length === 0 && responsePhotoUrls.length === 0) {
      return null;
    }

    return (
      <View style={styles.photoGrid}>
        {responsePhotoIds.map((photoId, photoIndex) => {
          const previewUri = photoPreviewUris[photoId];
          const previewLoading = Boolean(photoPreviewLoading[photoId]);
          const fileName =
            response.photos?.find((photo) => photo.id === photoId)?.fileName || t("improver.photoN", { n: photoIndex + 1 });
          return (
            <Pressable
              key={photoId}
              style={styles.photoCard}
              disabled={!previewUri}
              onPress={() => {
                if (previewUri) {
                  openImagePreview({ label: fileName, imageUri: previewUri }, "detail");
                }
              }}
            >
              {previewUri ? (
                <Image source={{ uri: previewUri }} style={styles.photoPreview} resizeMode="cover" />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderText}>
                    {previewLoading ? t("improver.loading") : t("improver.previewUnavailable")}
                  </Text>
                </View>
              )}
              <Text style={styles.photoLabel} numberOfLines={1}>
                {fileName}
              </Text>
            </Pressable>
          );
        })}

        {responsePhotoUrls.map((photoUrl, photoIndex) => (
          <Pressable
            key={`${photoUrl}-${photoIndex}`}
            style={styles.photoCard}
            onPress={() => openImagePreview({ label: t("improver.photoN", { n: photoIndex + 1 }), imageUri: photoUrl }, "detail")}
          >
            <Image source={{ uri: photoUrl }} style={styles.photoPreview} resizeMode="cover" />
            <Text style={styles.photoLabel} numberOfLines={1}>
              {t("improver.photoN", { n: photoIndex + 1 })}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderDetailWorkItem = (step: AppWorkflowStep, item: AppWorkflowWorkItem) => {
    const itemResponses =
      step.submission && !step.submission.stepNotPossible
        ? step.submission.itemResponses.filter((response) => response.itemId === item.id)
        : [];

    return (
      <View key={item.id} style={styles.subCard}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.choiceTitle}>
              {t("improver.itemTitle", { order: item.itemOrder, title: item.title })}
            </Text>
            {item.description ? <Text style={styles.choiceBody}>{item.description}</Text> : null}
          </View>
          {item.optional ? renderStatusChip(t("improver.optional"), "default") : null}
        </View>
        <Text style={styles.meta}>{t("improver.requirementsList", { list: formatWorkItemRequirements(item) })}</Text>

                {itemResponses.length > 0 ? (
          itemResponses.map((response, index) => {
            const dropdownLabel = response.dropdownValue
              ? item.dropdownOptions.find((option) => option.value === response.dropdownValue)?.label || response.dropdownValue
              : "";
            return (
              <View key={`${item.id}-response-${index}`} style={styles.responseCard}>
                {itemResponses.length > 1 ? (
                  <Text style={styles.responseLabel}>{t("improver.submittedResponseN", { n: index + 1 })}</Text>
                ) : null}
                {dropdownLabel ? (
                  <View style={styles.responseRow}>
                    <Text style={styles.responseKey}>{t("improver.selectedOption")}</Text>
                    <Text style={styles.responseValue}>{dropdownLabel}</Text>
                  </View>
                ) : null}
                {response.writtenResponse ? (
                  <View style={styles.stack}>
                    <Text style={styles.responseKey}>{t("improver.notes")}</Text>
                    <Text style={styles.responseValue}>{response.writtenResponse}</Text>
                  </View>
                ) : null}
                {renderStepResponsePhotos({
                  photoIds: response.photoIds,
                  photoUrls: response.photoUrls,
                  photos: response.photos?.map((photo) => ({ id: photo.id, fileName: photo.fileName })),
                })}
              </View>
            );
          })
        ) : step.submission && !step.submission.stepNotPossible ? (
          <Text style={styles.meta}>{t("improver.noResponseSubmittedForThis")}</Text>
        ) : null}
      </View>
    );
  };

  const renderStepActions = (workflow: AppWorkflow, step: AppWorkflowStep) => {
    const mine = step.assignedImproverId === user?.id;
    const claimable = canClaimStep(workflow, step);
    const previousStepSatisfied =
      step.stepOrder <= 1
        ? workflow.startAt <= Math.floor(Date.now() / 1000)
        : workflow.steps.some(
            (candidate) =>
              candidate.stepOrder === step.stepOrder - 1 &&
              (candidate.status === "completed" || candidate.status === "paid_out"),
          );

    if (!claimable && !mine) {
      return null;
    }

    const stepError = stepErrors[step.id];
    const notPossibleForm = stepNotPossibleForms[step.id] || emptyStepNotPossibleForm();

    return (
      <View style={styles.stack}>
        {claimable ? (
          <Pressable
            style={[styles.primaryButton, actionKey === `claim:${step.id}` ? styles.buttonDisabled : undefined]}
            disabled={Boolean(actionKey)}
            onPress={() => {
              void claimWorkflowStep(workflow.id, step.id);
            }}
          >
            <Text style={styles.primaryButtonText}>
              {actionKey === `claim:${step.id}` ? t("improver.claiming") : t("improver.claimStep2", { stepOrder: step.stepOrder })}
            </Text>
          </Pressable>
        ) : null}

        {mine && step.status === "locked" && previousStepSatisfied ? (
          <Pressable
            style={[styles.secondaryButton, actionKey === `start:${step.id}` ? styles.buttonDisabled : undefined]}
            disabled={Boolean(actionKey)}
            onPress={() => {
              void startWorkflowStep(workflow.id, step.id);
            }}
          >
            <Text style={styles.secondaryButtonText}>
              {actionKey === `start:${step.id}` ? t("improver.starting") : t("improver.startStep")}
            </Text>
          </Pressable>
        ) : null}

        {mine && workflow.recurrence !== "one_time" && step.status !== "paid_out" && step.status !== "completed" ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              // Close the detail modal, then open the dedicated absence screen
              // with this step's series pre-selected. Works for locked step 2+
              // claims too.
              setDetailVisible(false);
              setSelectedWorkflow(null);
              openAbsenceScreen(`${workflow.seriesId}:${step.stepOrder}`);
            }}
          >
            <Text style={styles.secondaryButtonText}>{t("improver.requestAbsenceCoverage")}</Text>
          </Pressable>
        ) : null}

        {mine && (step.status === "available" || step.status === "in_progress") ? (
          <View style={styles.stack}>
            {step.allowStepNotPossible ? (
              <Pressable
                style={[styles.choiceRow, notPossibleForm.selected ? styles.choiceRowActive : undefined]}
                onPress={() => setStepNotPossibleForm(step.id, { selected: !notPossibleForm.selected })}
              >
                <View style={styles.choiceCopy}>
                  <Text style={styles.choiceTitle}>{t("improver.stepNotPossible")}</Text>
                  <Text style={styles.choiceBody}>{t("improver.endsTheWorkflowWithoutPayout")}</Text>
                </View>
                <Ionicons
                  name={notPossibleForm.selected ? "checkmark-circle" : "ellipse-outline"}
                  size={20}
                  color={notPossibleForm.selected ? palette.primaryStrong : palette.textMuted}
                />
              </Pressable>
            ) : null}

            {notPossibleForm.selected ? (
              <TextInput
                style={[styles.input, styles.multilineInput]}
                multiline
                placeholder={t("improver.explainWhyThisStepCannot")}
                placeholderTextColor={palette.textMuted}
                value={notPossibleForm.details}
                onChangeText={(value) => setStepNotPossibleForm(step.id, { details: value })}
              />
            ) : (
              step.workItems
                .slice()
                .sort((left, right) => left.itemOrder - right.itemOrder)
                .map((item) => {
                  const form = completionForms[step.id]?.[item.id] || emptyItemForm();
                  const itemError = itemErrors[getCompletionItemErrorKey(step.id, item.id)];
                  const selectedOption = form.dropdown
                    ? item.dropdownOptions.find((option) => option.value === form.dropdown)
                    : undefined;
                  const dropdownRequiresPhoto = Boolean(selectedOption?.requiresPhotoAttachment);
                  const dropdownCameraOnly = dropdownRequiresPhoto && Boolean(selectedOption?.cameraCaptureOnly);
                  const requiresPhoto = item.requiresPhoto || dropdownRequiresPhoto;
                  const requiresWritten =
                    item.requiresWrittenResponse ||
                    (form.dropdown ? Boolean(item.dropdownRequiresWrittenResponse[form.dropdown]) : false);
                  const photoLimit = item.requiresPhoto
                    ? item.photoAllowAnyCount
                      ? null
                      : Math.max(1, item.photoRequiredCount || 1)
                    : 1;
                  const effectiveCameraOnly = (item.requiresPhoto && item.cameraCaptureOnly) || dropdownCameraOnly;

                  return (
                    <View key={item.id} style={styles.subCard}>
                      <Text style={styles.choiceTitle}>
                        {t("improver.itemTitle", { order: item.itemOrder, title: item.title })}
                      </Text>
                      {item.description ? <Text style={styles.choiceBody}>{item.description}</Text> : null}
                      <Text style={styles.meta}>{t("improver.requirementsList", { list: formatWorkItemRequirements(item) })}</Text>

                      {item.requiresDropdown ? (
                        <View style={styles.choiceList}>
                          {item.dropdownOptions.map((option) => {
                            const selected = option.value === form.dropdown;
                            return (
                              <Pressable
                                key={option.value}
                                style={[styles.choiceRow, selected ? styles.choiceRowActive : undefined]}
                                onPress={() => setItemForm(step.id, item.id, { dropdown: option.value })}
                              >
                                <View style={styles.choiceCopy}>
                                  <Text style={styles.choiceTitle}>{option.label}</Text>
                                  {option.photoInstructions ? (
                                    <Text style={styles.choiceBody}>{option.photoInstructions}</Text>
                                  ) : null}
                                </View>
                                {selected ? <Ionicons name="checkmark-circle" size={20} color={palette.primaryStrong} /> : null}
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}

                      {requiresWritten ? (
                        <TextInput
                          style={[styles.input, styles.multilineInput]}
                          multiline
                          placeholder={t("improver.enterYourResponse")}
                          placeholderTextColor={palette.textMuted}
                          value={form.written}
                          onChangeText={(value) => setItemForm(step.id, item.id, { written: value })}
                        />
                      ) : null}

                      {requiresPhoto ? (
                        <View style={styles.stack}>
                          {selectedOption?.photoInstructions ? (
                            <Text style={styles.choiceBody}>{selectedOption.photoInstructions}</Text>
                          ) : null}
                          <View style={styles.photoGrid}>
                            {form.photos.map((photo) => (
                              <Pressable
                                key={photo.id}
                                style={styles.photoCard}
                                onPress={() => openImagePreview({ label: photo.fileName, imageUri: photo.previewUri }, "detail")}
                              >
                                <Image source={{ uri: photo.previewUri }} style={styles.photoPreview} resizeMode="cover" />
                                <Pressable
                                  style={styles.photoRemoveIconButton}
                                  onPress={(event) => {
                                    event.stopPropagation();
                                    removeCompletionPhoto(step.id, item.id, photo.id);
                                  }}
                                  hitSlop={8}
                                >
                                  <Ionicons name="close" size={16} color={palette.white} />
                                </Pressable>
                                <Text style={styles.photoLabel} numberOfLines={1}>
                                  {photo.fileName}
                                </Text>
                              </Pressable>
                            ))}
                          </View>

                          <View style={styles.inlineActions}>
                            <Pressable
                              style={styles.secondaryButton}
                              onPress={() =>
                                void openCameraCapture(
                                  step.id,
                                  item.id,
                                  item.title,
                                  item.photoAspectRatio,
                                  photoLimit,
                                )
                              }
                            >
                              <Text style={styles.secondaryButtonText}>
                                {form.photos.length > 0 ? t("improver.captureAnotherLivePhoto") : t("improver.captureLivePhoto")}
                              </Text>
                            </Pressable>
                            {!effectiveCameraOnly ? (
                              <Pressable
                                style={[styles.secondaryButton, !imagePickerAvailable ? styles.buttonDisabled : undefined]}
                                disabled={!imagePickerAvailable}
                                onPress={() => {
                                  void pickLibraryPhotos(step.id, item.id, item.title, photoLimit);
                                }}
                              >
                                <Text style={styles.secondaryButtonText}>{t("improver.uploadFromLibrary")}</Text>
                              </Pressable>
                            ) : null}
                          </View>
                          {!imagePickerAvailable && !effectiveCameraOnly ? (
                            <Text style={styles.meta}>{t("improver.photoLibraryUploadsWillWork")}</Text>
                          ) : null}
                          {itemError ? <Text style={styles.inlineError}>{itemError}</Text> : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })
            )}

            {stepError ? <Text style={styles.inlineError}>{stepError}</Text> : null}
            <Pressable
              style={[styles.primaryButton, actionKey === `complete:${step.id}` ? styles.buttonDisabled : undefined]}
              disabled={Boolean(actionKey)}
              onPress={() => {
                void completeWorkflowStep(workflow, step);
              }}
            >
              <Text style={styles.primaryButtonText}>
                {actionKey === `complete:${step.id}`
                  ? t("improver.submitting")
                  : notPossibleForm.selected
                    ? t("improver.markStepNotPossible")
                    : t("improver.completeStep")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  const renderWorkflowCameraCapture = () => (
    <View style={[styles.cameraScreen, { paddingTop: topInset + spacing.xl }]}>
      <View style={styles.cameraHeader}>
        <View style={styles.cameraHeaderCopy}>
          <Text style={styles.cameraTitle}>{t("improver.captureWorkflowPhoto")}</Text>
          <Text style={styles.cameraSubtitle}>{cameraTarget?.title || t("improver.workflowItem")}</Text>
        </View>
        <Pressable style={styles.iconButtonInverse} onPress={() => setCameraTarget(null)}>
          <Ionicons name="close" size={20} color={palette.white} />
        </Pressable>
      </View>
      <View
        style={[
          styles.cameraFrame,
          { aspectRatio: getWorkflowPhotoAspectRatioValue(cameraTarget?.aspectRatio || "square") },
        ]}
      >
        {permission?.granted ? (
          <CameraView ref={cameraRef} style={styles.cameraView} facing="back" />
        ) : (
          <View style={styles.cameraPendingWrap}>
            <ThemedActivityIndicator size="large" color={palette.white} />
            <Text style={styles.cameraPendingText}>{t("improver.waitingForCameraPermission")}</Text>
          </View>
        )}
      </View>
      {cameraError ? <Text style={styles.cameraError}>{cameraError}</Text> : null}
      <View style={styles.cameraActions}>
        <Pressable
          style={[styles.cameraCaptureButton, !permission?.granted ? styles.buttonDisabled : undefined]}
          disabled={!permission?.granted}
          onPress={() => void captureWorkflowPhoto()}
        >
          <Ionicons name="camera" size={22} color={palette.white} />
          <Text style={styles.cameraCaptureText}>{t("improver.capture")}</Text>
        </Pressable>
      </View>
    </View>
  );

  const imagePreviewBaseWidth = Math.min(windowWidth - spacing.lg * 4, 640);
  const imagePreviewBaseHeight = Math.min(windowHeight * 0.58, 520);

  const renderBadgePreviewOverlay = (inline = false) => (
    <Pressable
      style={inline ? styles.inlineImagePreviewOverlay : styles.modalOverlay}
      onPress={closeImagePreview}
    >
      <Pressable style={styles.imagePreviewCard} onPress={() => {}}>
        <View style={styles.imagePreviewHeader}>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {badgePreview?.label || t("improver.preview")}
          </Text>
          <Pressable style={styles.iconButton} onPress={closeImagePreview}>
            <Ionicons name="close" size={20} color={palette.primaryStrong} />
          </Pressable>
        </View>

        <View style={styles.imagePreviewViewport}>
          {badgePreview?.imageUri ? (
            <ScrollView
              style={styles.imagePreviewScroll}
              contentContainerStyle={styles.imagePreviewScrollContent}
              scrollEnabled
              maximumZoomScale={4}
              minimumZoomScale={1}
              pinchGestureEnabled
              nestedScrollEnabled
              bounces={false}
              bouncesZoom={false}
              alwaysBounceHorizontal={false}
              alwaysBounceVertical={false}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: badgePreview.imageUri }}
                style={[
                  styles.imagePreviewImage,
                  {
                    width: imagePreviewBaseWidth,
                    height: imagePreviewBaseHeight,
                  },
                ]}
                resizeMode="contain"
              />
            </ScrollView>
          ) : null}
        </View>

        <Pressable style={styles.secondaryButton} onPress={closeImagePreview}>
          <Text style={styles.secondaryButtonText}>{t("improver.close")}</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          // In edit mode, pad the list past the floating bar (bar height + its
          // above-dock offset + a gap) so every workflow can scroll clear of it.
          workflowEditMode && workflowView === "my-workflows"
            ? { paddingBottom: bulkBarBottomInset + bulkBarHeight + spacing.lg }
            : undefined,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          section === "workflows" ? (
            <RefreshControl
              key={refreshControlKey}
              refreshing={workflowRefreshing}
              onRefresh={handleWorkflowRefresh}
              tintColor={refreshAccent}
              colors={[refreshAccent]}
              progressBackgroundColor={isDark ? palette.backgroundMuted : palette.surfaceStrong}
            />
          ) : undefined
        }
      >
        {renderBannerStack()}

        <SegmentedTabs
          segments={IMPROVER_SECTION_TABS()}
          value={section}
          onChange={setSection}
          hapticsEnabled={hapticsEnabled}
        />

        {section === "workflows" ? renderWorkflowsContent() : renderCredentialsContent()}
      </ScrollView>

      {workflowEditMode && workflowView === "my-workflows" ? (
        <View
          style={[styles.bulkActionBar, { bottom: bulkBarBottomInset }]}
          onLayout={(event) => setBulkBarHeight(event.nativeEvent.layout.height)}
        >
          <Text style={styles.bulkActionTitle}>
            {selectedWorkflowGroups.length === 0
              ? t("improver.selectWorkflows")
              : t("common.selectedCount", { count: selectedWorkflowGroups.length })}
          </Text>
          <View style={styles.bulkActionButtons}>
            <Pressable
              style={[
                styles.secondaryButton,
                styles.bulkActionButton,
                selectedWorkflowGroups.length === 0 || Boolean(actionKey) ? styles.buttonDisabled : undefined,
              ]}
              disabled={selectedWorkflowGroups.length === 0 || Boolean(actionKey)}
              onPress={revokeSelectedWorkflows}
            >
              <Text style={styles.secondaryButtonText}>
                {actionKey === "bulk-revoke" ? t("improver.revoking") : t("improver.revokeSelected")}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryButton,
                styles.bulkActionButton,
                Boolean(actionKey) ? styles.buttonDisabled : undefined,
              ]}
              disabled={Boolean(actionKey)}
              onPress={() => openAbsenceScreen()}
            >
              <Text style={styles.primaryButtonText}>{t("improver.absence")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Absence coverage — its own screen, not a bar over the workflow list. */}
      <Modal
        visible={absenceScreenVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeAbsenceScreen}
      >
        <View style={[styles.absenceScreen, { paddingTop: topInset }]}>
          <View style={styles.absenceHeader}>
            <Pressable style={styles.absenceBackButton} onPress={closeAbsenceScreen} hitSlop={8}>
              <Ionicons name={dirIcon("chevron-back")} size={22} color={palette.text} />
            </Pressable>
            <Text style={styles.absenceHeaderTitle}>{t("improver.absenceCoverage")}</Text>
            <View style={styles.absenceBackButton} />
          </View>

          <ScrollView contentContainerStyle={styles.absenceScreenContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.absenceIntro}>
              {t("improver.absenceIntro")}
            </Text>

            <Pressable
              style={styles.absenceCheckboxRow}
              onPress={() => setAbsenceAllWorkflows((current) => !current)}
            >
              <Ionicons
                name={absenceAllWorkflows ? "checkbox" : "square-outline"}
                size={22}
                color={absenceAllWorkflows ? palette.primary : palette.textMuted}
              />
              <Text style={styles.absenceCheckboxLabel}>
                {t("improver.requestAbsenceForAllWorkflows")}
              </Text>
            </Pressable>

            <View style={styles.absenceSection}>
              <Text style={styles.absenceSectionLabel}>
                {absenceAllWorkflows ? t("improver.covering") : t("improver.selectedWorkflows")}
              </Text>
              {absenceAllWorkflows ? (
                <Text style={styles.absenceCoverageSummary}>
                  {t("improver.allRecurringWorkflows", { count: absenceTargetGroups.length })}
                </Text>
              ) : selectedWorkflowGroups.length === 0 ? (
                <Text style={styles.absenceEmptyHint}>
                  {t("improver.noWorkflowsSelectedTickThe")}
                </Text>
              ) : (
                <View style={styles.stack}>
                  {selectedWorkflowGroups.map((group) => (
                    <View key={group.key} style={styles.absenceGroupRow}>
                      <Text style={styles.absenceGroupTitle} numberOfLines={1}>
                        {group.workflowTitle}
                      </Text>
                      <Text style={styles.absenceGroupMeta} numberOfLines={1}>
                        {group.primaryStepOrder === null
                          ? group.primaryStepTitle || t("improver.assignedStep")
                          : t("improver.stepTitle", { step: group.primaryStepOrder, title: group.primaryStepTitle })}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.absenceSection}>
              <Text style={styles.absenceSectionLabel}>{t("improver.absenceDates")}</Text>
              <Pressable style={[styles.input, styles.dateField]} onPress={() => setAbsencePickerField("from")}>
                <Text style={absenceFrom ? styles.dateFieldValue : styles.dateFieldPlaceholder}>
                  {absenceFrom ? formatAbsenceFieldDate(absenceFrom) : t("improver.absentFrom")}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={palette.textMuted} />
              </Pressable>
              <Pressable style={[styles.input, styles.dateField]} onPress={() => setAbsencePickerField("until")}>
                <Text style={absenceUntil ? styles.dateFieldValue : styles.dateFieldPlaceholder}>
                  {absenceUntil ? formatAbsenceFieldDate(absenceUntil) : t("improver.absentUntil")}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={palette.textMuted} />
              </Pressable>
            </View>

            {error ? <Text style={styles.absenceError}>{error}</Text> : null}

            <Pressable
              style={[styles.primaryButton, actionKey === "bulk-absence" ? styles.buttonDisabled : undefined]}
              disabled={actionKey === "bulk-absence"}
              onPress={saveAbsenceCoverage}
            >
              <Text style={styles.primaryButtonText}>
                {actionKey === "bulk-absence" ? t("improver.saving") : t("improver.saveAbsence")}
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        <DatePickerSheet
          visible={absencePickerField === "from"}
          value={absenceFrom}
          title={t("improver.absentFrom")}
          onSelect={(next) => {
            setAbsenceFrom(next);
            // Keep the range valid: never leave "until" before "from".
            setAbsenceUntil((current) => (current && current < next ? next : current));
          }}
          onClose={() => setAbsencePickerField(null)}
        />
        <DatePickerSheet
          visible={absencePickerField === "until"}
          value={absenceUntil}
          title={t("improver.absentUntil")}
          minDate={absenceFrom || undefined}
          onSelect={setAbsenceUntil}
          onClose={() => setAbsencePickerField(null)}
        />
      </Modal>


      {/* Styled bulk-revoke confirmation (replaces the native alert). */}
      <Modal
        visible={revokeConfirmVisible}
        transparent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setRevokeConfirmVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setRevokeConfirmVisible(false)}>
          <Pressable style={styles.selectorSheetCard} onPress={() => {}}>
            <Text style={styles.sectionTitle}>
              {selectedWorkflowGroups.length === 1 ? t("improver.revokeWorkflow") : t("improver.revokeSelectedWorkflows")}
            </Text>
            <Text style={styles.confirmBody}>
              {t("improver.releasesToOthers", {
                what:
                  selectedWorkflowGroups.length === 1
                    ? t("improver.thisRecurringWorkflowClaim")
                    : t("improver.theseRecurringWorkflowClaims", { count: selectedWorkflowGroups.length }),
              })}
            </Text>
            <View style={styles.bulkActionButtons}>
              <Pressable
                style={[styles.secondaryButton, styles.bulkActionButton]}
                onPress={() => setRevokeConfirmVisible(false)}
              >
                <Text style={styles.secondaryButtonText}>{t("improver.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerButton, styles.bulkActionButton]}
                onPress={confirmRevokeSelectedWorkflows}
              >
                <Text style={styles.dangerButtonText}>{t("improver.revoke")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={workflowSelectorVisible}
        transparent
        presentationStyle="overFullScreen"
        animationType="none"
        onRequestClose={() => setWorkflowSelectorVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setWorkflowSelectorVisible(false)}>
          <Pressable style={styles.selectorSheetCard} onPress={() => {}}>
            <Text style={styles.sectionTitle}>{t("improver.workflowView")}</Text>
            <View style={styles.stack}>
              {workflowSelectorOptions.map((option) => {
                const selected = option.value === workflowView;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.choiceRow, selected ? styles.choiceRowActive : undefined]}
                    onPress={() => {
                      selectWorkflowView(option.value);
                      setWorkflowSelectorVisible(false);
                    }}
                  >
                    <Text style={styles.choiceTitle}>{option.label}</Text>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={palette.primaryStrong} /> : null}
                  </Pressable>
                );
              })}
              {unpaidDataLoading && !unpaidDataLoaded ? renderLoadingCard(t("improver.checkingUnpaidWorkflows")) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={detailVisible}
        animationType="slide"
        onRequestClose={() => {
          if (cameraTarget) {
            setCameraTarget(null);
            return;
          }
          setDetailVisible(false);
        }}
      >
        {cameraTarget ? (
          renderWorkflowCameraCapture()
        ) : (
          <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: topInset + spacing.sm }]}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalTitle}>{selectedWorkflow?.title || t("improver.workflow")}</Text>
              <Text style={styles.modalSubtitle}>
                {selectedWorkflow ? formatWorkflowDisplayStatus(selectedWorkflow) : t("improver.details")}
              </Text>
            </View>
            <Pressable style={styles.iconButton} onPress={() => setDetailVisible(false)}>
              <Ionicons name="close" size={20} color={palette.primaryStrong} />
            </Pressable>
          </View>

          {!selectedWorkflow && detailLoading ? (
            <View style={styles.loadingWrap}>
              <ThemedActivityIndicator size="large" color={palette.primaryStrong} />
              <Text style={styles.loadingText}>{t("improver.loadingWorkflowDetails")}</Text>
            </View>
          ) : selectedWorkflow ? (
            <ScrollView
              ref={detailScrollRef}
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
              onScroll={(event) => {
                detailScrollYRef.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              refreshControl={
                <RefreshControl
                  key={refreshControlKey}
                  refreshing={workflowRefreshing}
                  onRefresh={handleWorkflowRefresh}
                  tintColor={refreshAccent}
                  colors={[refreshAccent]}
                  progressBackgroundColor={isDark ? palette.backgroundMuted : palette.surfaceStrong}
                />
              }
            >
              {detailLoading ? renderLoadingIndicatorCard() : null}

              {shouldShowSelectedWorkflowActions ? (
                <View style={styles.inlineActions}>
                  {/* Workflow revocation is done from the My Workflows edit
                      menu (multi-select), not from the detail view. */}
                  {selectedWorkflowAbsence && canRevokeSelectedWorkflowAbsence ? (
                    <Pressable
                      style={[
                        styles.secondaryButton,
                        actionKey === `absence-delete:${selectedWorkflowAbsence.id}` ? styles.buttonDisabled : undefined,
                      ]}
                      disabled={Boolean(actionKey)}
                      onPress={() =>
                        Alert.alert(
                          t("improver.revokeAbsence"),
                          t("improver.thisWillRemoveTheSaved"),
                          [
                            { text: t("improver.cancel"), style: "cancel" },
                            {
                              text: t("improver.revoke"),
                              style: "destructive",
                              onPress: () => {
                                void revokeAbsence(selectedWorkflowAbsence.id);
                              },
                            },
                          ],
                        )
                      }
                    >
                      <Text style={styles.secondaryButtonText}>
                        {actionKey === `absence-delete:${selectedWorkflowAbsence.id}` ? t("improver.revoking") : t("improver.revokeAbsence2")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {sortedDetailSteps.length > 0 ? (
                <>
                  <View style={styles.stepPagerRow}>
                    <Text style={styles.stepPagerTitle}>
                      {t("improver.stepOf", { step: currentDetailStepIndex + 1, total: sortedDetailSteps.length })}
                      {/* Which of these steps are theirs. "Step 2 of 4" alone
                          told an improver nothing about where their other
                          assigned step was. */}
                      {selectedWorkflow && myStepOrders.length > 1
                        ? t("improver.yoursSteps", { steps: myStepOrders.join(", ") })
                        : ""}
                    </Text>
                    <View style={styles.inlineActions}>
                      <Pressable
                        style={[styles.compactActionButton, currentDetailStepIndex === 0 ? styles.buttonDisabled : undefined]}
                        disabled={currentDetailStepIndex === 0}
                        onPress={() => setDetailStepIndex((current) => Math.max(0, current - 1))}
                      >
                        <Text style={styles.compactActionButtonText}>{t("improver.previous")}</Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.compactActionButton,
                          currentDetailStepIndex >= sortedDetailSteps.length - 1 ? styles.buttonDisabled : undefined,
                        ]}
                        disabled={currentDetailStepIndex >= sortedDetailSteps.length - 1}
                        onPress={() =>
                          setDetailStepIndex((current) => Math.min(sortedDetailSteps.length - 1, current + 1))
                        }
                      >
                        <Text style={styles.compactActionButtonText}>{t("improver.next")}</Text>
                      </Pressable>
                    </View>
                  </View>

                  {currentDetailStep ? (
                    <View style={styles.card}>
                      <View style={styles.cardHeaderRow}>
                        <View style={styles.cardHeaderCopy}>
                          <Text style={styles.sectionTitle}>
                            {t("improver.stepTitle", { step: currentDetailStep.stepOrder, title: currentDetailStep.title })}
                          </Text>
                        </View>
                        {renderStatusChip(
                          formatStatusLabel(currentDetailStep.status),
                          currentDetailStep.status === "paid_out"
                            ? "success"
                            : currentDetailStep.status === "completed"
                              ? "warning"
                              : "default",
                        )}
                      </View>

                      {!currentDetailStepHasCompletionForm ? (
                        <>
                          <Text style={styles.meta}>{t("improver.bountyAmount", { amount: currentDetailStep.bounty, tokenSymbol })}</Text>
                          {currentDetailStep.assignedImproverName ? (
                            <Text style={styles.meta}>{t("improver.assignedTo", { name: currentDetailStep.assignedImproverName })}</Text>
                          ) : null}
                          {currentDetailStep.payoutError ? <Text style={styles.inlineError}>{currentDetailStep.payoutError}</Text> : null}

                          {currentDetailStep.submission ? (
                            currentDetailStep.submission.stepNotPossible ? (
                              <View style={styles.submissionCard}>
                                <Text style={styles.stackLabel}>{t("improver.submittedAsNotPossible")}</Text>
                                <Text style={styles.choiceBody}>
                                  {currentDetailStep.submission.stepNotPossibleDetails || t("improver.noDetailsProvided")}
                                </Text>
                              </View>
                            ) : (
                              <View style={styles.submissionCard}>
                                <View style={styles.sectionHeaderRow}>
                                  <Text style={styles.stackLabel}>
                                    {t("improver.submittedOn", { date: new Date(currentDetailStep.submission.submittedAt * 1000).toLocaleString() })}
                                  </Text>
                                  <Pressable
                                    style={styles.compactActionButton}
                                    onPress={() =>
                                      setSubmissionDetailsOpen((current) => ({
                                        ...current,
                                        [currentDetailStep.id]: !current[currentDetailStep.id],
                                      }))
                                    }
                                  >
                                    <Text style={styles.compactActionButtonText}>
                                      {detailSubmissionExpanded ? t("improver.hideDetails") : t("improver.viewDetails")}
                                    </Text>
                                  </Pressable>
                                </View>
                              </View>
                            )
                          ) : null}

                          {(currentDetailStep.submission?.stepNotPossible ||
                            !currentDetailStep.submission ||
                            detailSubmissionExpanded) &&
                          currentDetailStep.description ? (
                            <Text style={styles.body}>{currentDetailStep.description}</Text>
                          ) : null}

                          {(currentDetailStep.submission?.stepNotPossible ||
                            !currentDetailStep.submission ||
                            detailSubmissionExpanded) &&
                          currentDetailStep.workItems.length > 0 ? (
                            <View style={styles.stack}>
                              {currentDetailStep.workItems
                                .slice()
                                .sort((left, right) => left.itemOrder - right.itemOrder)
                                .map((item) => renderDetailWorkItem(currentDetailStep, item))}
                            </View>
                          ) : null}

                          {currentDetailStep.status === "completed" &&
                          currentDetailStep.assignedImproverId === user?.id &&
                          currentDetailStep.bounty > 0 &&
                          currentDetailStep.payoutError ? (
                            <Pressable
                              style={[
                                styles.secondaryButton,
                                actionKey === `retry:${currentDetailStep.id}` ? styles.buttonDisabled : undefined,
                              ]}
                              disabled={Boolean(actionKey)}
                              onPress={() => {
                                void requestPayoutRetry(selectedWorkflow.id, currentDetailStep.id);
                              }}
                            >
                              <Text style={styles.secondaryButtonText}>
                                {actionKey === `retry:${currentDetailStep.id}` ? t("improver.requesting") : t("improver.retryPayout")}
                              </Text>
                            </Pressable>
                          ) : null}
                        </>
                      ) : null}

                      {renderStepActions(selectedWorkflow, currentDetailStep)}
                    </View>
                  ) : null}
                </>
              ) : renderEmptyCard(t("improver.noWorkflowSteps"), t("improver.noWorkflowStepsWereConfigured"))}
            </ScrollView>
          ) : null}
          {badgePreview && imagePreviewHost === "detail" ? renderBadgePreviewOverlay(true) : null}
          </View>
        )}
      </Modal>

      <Modal
        visible={badgesVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        allowSwipeDismissal={!(badgePreview && imagePreviewHost === "badges")}
        onRequestClose={closeBadges}
        onDismiss={closeBadges}
      >
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: topInset + spacing.sm }]}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalTitle}>{t("improver.myBadges")}</Text>
              <Text style={styles.modalSubtitle}>
                {t("improver.resultCount", { count: filteredBadgeItems.length })}
              </Text>
            </View>
            <Pressable style={styles.iconButton} onPress={closeBadges}>
              <Ionicons name={dirIcon("arrow-back")} size={20} color={palette.primaryStrong} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color={palette.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={t("improver.searchBadges")}
                placeholderTextColor={palette.textMuted}
                value={badgeSearch}
                onChangeText={setBadgeSearch}
              />
            </View>
            {filteredBadgeItems.length === 0 ? (
              renderEmptyCard(t("improver.noBadgesFound"), t("improver.noBadgesMatchYourSearch"))
            ) : (
              <View style={styles.badgeGrid}>
                {filteredBadgeItems.map((badge) => (
                  <Pressable
                    key={badge.credential}
                    style={styles.badgeCard}
                    disabled={!badge.badgeUri}
                    onPress={() => {
                      if (badge.badgeUri) {
                        openImagePreview({ label: badge.label, imageUri: badge.badgeUri }, "badges");
                      }
                    }}
                  >
                    {badge.badgeUri ? (
                      <Image source={{ uri: badge.badgeUri }} style={styles.badgeImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.badgePlaceholder}>
                        <Ionicons name="ribbon-outline" size={28} color={palette.textMuted} />
                      </View>
                    )}
                    <Text style={styles.badgeLabel}>{badge.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
          {badgePreview && imagePreviewHost === "badges" ? renderBadgePreviewOverlay(true) : null}
        </View>
      </Modal>

      <Modal
        visible={Boolean(badgePreview) && imagePreviewHost === "credentials"}
        transparent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={closeImagePreview}
      >
        {renderBadgePreviewOverlay(false)}
      </Modal>
    </>
  );
}

function createStyles(
  palette: Palette,
  shadows: ReturnType<typeof getShadows>,
  isDark: boolean,
) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: 140,
      gap: spacing.md,
    },
    heroCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
      gap: spacing.xs,
      ...shadows.soft,
    },
    title: {
      color: palette.text,
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: 0,
    },
    subtitle: {
      color: palette.textMuted,
      lineHeight: 21,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.soft,
    },
    cardSelected: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    sectionStack: {
      gap: spacing.md,
    },
    cardHeaderRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    cardHeaderCopy: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    cardBadgeStack: {
      alignItems: "flex-end",
      gap: spacing.xs,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "800",
    },
    workflowTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
      lineHeight: 22,
    },
    body: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    metadataWrap: {
      gap: 4,
    },
    meta: {
      color: palette.textMuted,
      lineHeight: 18,
    },
    noticeCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: isDark ? "rgba(87,200,150,0.12)" : "rgba(23,130,87,0.10)",
      borderWidth: 1,
      borderColor: isDark ? "rgba(87,200,150,0.28)" : "rgba(23,130,87,0.22)",
      borderRadius: radii.md,
      padding: spacing.md,
    },
    noticeCardText: {
      flex: 1,
      color: palette.text,
      lineHeight: 20,
      fontWeight: "700",
    },
    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: isDark ? "rgba(255,138,128,0.12)" : "rgba(207,77,67,0.10)",
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,138,128,0.28)" : "rgba(207,77,67,0.22)",
      borderRadius: radii.md,
      padding: spacing.md,
    },
    errorCardText: {
      flex: 1,
      color: palette.text,
      lineHeight: 20,
      fontWeight: "700",
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flexShrink: 0,
    },
    selectorButton: {
      maxWidth: "62%",
      flexShrink: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    selectorButtonText: {
      flexShrink: 1,
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 14,
    },
    checkboxPill: {
      minHeight: 38,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 12,
    },
    checkboxPillActive: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    checkboxPillText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    checkboxPillTextActive: {
      color: palette.white,
    },
    searchWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    searchInput: {
      flex: 1,
      color: palette.text,
      fontSize: 15,
      paddingVertical: 0,
    },
    input: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: palette.text,
      fontSize: 15,
    },
    dateField: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dateFieldValue: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "700",
    },
    dateFieldPlaceholder: {
      color: palette.textMuted,
      fontSize: 15,
    },
    bulkActionButtons: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    bulkActionButton: {
      flex: 1,
    },
    absenceScreen: {
      flex: 1,
      backgroundColor: palette.background,
    },
    absenceHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    absenceBackButton: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    absenceHeaderTitle: {
      color: palette.text,
      fontSize: 17,
      fontWeight: "800",
    },
    absenceScreenContent: {
      padding: spacing.lg,
      paddingBottom: 120,
      gap: spacing.lg,
    },
    absenceIntro: {
      color: palette.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    absenceCheckboxRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.md,
    },
    absenceCheckboxLabel: {
      flex: 1,
      color: palette.text,
      fontSize: 14,
      fontWeight: "700",
    },
    absenceSection: {
      gap: spacing.sm,
    },
    absenceSectionLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    absenceCoverageSummary: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "800",
    },
    absenceEmptyHint: {
      color: palette.textMuted,
      fontSize: 14,
    },
    absenceGroupRow: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    absenceGroupTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "800",
    },
    absenceGroupMeta: {
      color: palette.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    absenceError: {
      color: palette.danger,
      fontSize: 14,
      fontWeight: "700",
    },
    multilineInput: {
      minHeight: 110,
      textAlignVertical: "top",
    },
    primaryButton: {
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingHorizontal: 18,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 14,
    },
    secondaryButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      paddingHorizontal: 18,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 14,
    },
    dangerButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.danger,
      backgroundColor: palette.danger,
      paddingHorizontal: 18,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    dangerButtonText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 14,
    },
    confirmBody: {
      color: palette.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    compactActionButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      paddingHorizontal: 14,
      paddingVertical: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    compactActionButtonText: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 12,
    },
    deleteButton: {
      borderRadius: radii.pill,
      backgroundColor: palette.danger,
      paddingHorizontal: 18,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    deleteButtonText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 14,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    inlineActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    statusChip: {
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      maxWidth: "100%",
    },
    statusChipDefault: {
      backgroundColor: palette.surfaceStrong,
      borderColor: palette.border,
    },
    statusChipSuccess: {
      backgroundColor: isDark ? "rgba(87,200,150,0.12)" : "rgba(23,130,87,0.10)",
      borderColor: isDark ? "rgba(87,200,150,0.28)" : "rgba(23,130,87,0.22)",
    },
    statusChipDanger: {
      backgroundColor: isDark ? "rgba(255,138,128,0.12)" : "rgba(207,77,67,0.10)",
      borderColor: isDark ? "rgba(255,138,128,0.28)" : "rgba(207,77,67,0.22)",
    },
    statusChipWarning: {
      backgroundColor: isDark ? "rgba(215,164,86,0.12)" : "rgba(166,106,31,0.10)",
      borderColor: isDark ? "rgba(215,164,86,0.28)" : "rgba(166,106,31,0.22)",
    },
    statusChipText: {
      fontSize: 12,
      fontWeight: "800",
    },
    statusChipTextDefault: {
      color: palette.textMuted,
    },
    statusChipTextSuccess: {
      color: palette.success,
    },
    statusChipTextDanger: {
      color: palette.danger,
    },
    statusChipTextWarning: {
      color: palette.warning,
    },
    choiceRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.md,
    },
    choiceRowActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    choiceCopy: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    choiceTitle: {
      color: palette.text,
      fontWeight: "800",
      lineHeight: 18,
      flexShrink: 1,
    },
    choiceBody: {
      color: palette.textMuted,
      lineHeight: 18,
    },
    stack: {
      gap: spacing.sm,
    },
    stackLabel: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 14,
    },
    pendingEmailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    inlineForm: {
      gap: spacing.sm,
    },
    chipWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    subCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.md,
      gap: spacing.sm,
    },
    subCardDanger: {
      borderColor: isDark ? "rgba(255,138,128,0.28)" : "rgba(207,77,67,0.22)",
      backgroundColor: isDark ? "rgba(255,138,128,0.08)" : "rgba(207,77,67,0.06)",
    },
    badgeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.md,
    },
    badgeCard: {
      flexBasis: "47%",
      flexGrow: 1,
      minWidth: 128,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.sm,
      gap: spacing.sm,
    },
    badgeImage: {
      width: "100%",
      height: 140,
      borderRadius: radii.md,
      backgroundColor: palette.surface,
    },
    badgePlaceholder: {
      width: "100%",
      height: 140,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeLabel: {
      color: palette.text,
      fontWeight: "800",
      lineHeight: 18,
    },
    photoGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    photoCard: {
      flexBasis: "47%",
      flexGrow: 1,
      minWidth: 128,
      position: "relative",
      gap: spacing.xs,
    },
    photoPlaceholder: {
      width: "100%",
      height: 120,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.sm,
    },
    photoPlaceholderText: {
      color: palette.textMuted,
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
    },
    photoPreview: {
      width: "100%",
      height: 120,
      borderRadius: radii.md,
      backgroundColor: palette.surface,
    },
    photoLabel: {
      color: palette.textMuted,
      fontSize: 12,
      lineHeight: 16,
    },
    photoRemoveButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceStrong,
    },
    photoRemoveText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
    },
    photoRemoveIconButton: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.58)",
    },
    submissionCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.md,
      gap: spacing.sm,
    },
    responseCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.background,
      padding: spacing.md,
      gap: spacing.sm,
    },
    responseLabel: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
    },
    responseRow: {
      gap: 4,
    },
    responseKey: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
    },
    responseValue: {
      color: palette.text,
      lineHeight: 20,
      flexShrink: 1,
    },
    submissionRow: {
      gap: 4,
      paddingBottom: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    inlineError: {
      color: palette.danger,
      lineHeight: 18,
      fontWeight: "700",
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      padding: spacing.xl,
      backgroundColor: palette.background,
    },
    loadingText: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    loadingInlineCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.md,
    },
    loadingInlineText: {
      color: palette.textMuted,
      fontWeight: "700",
    },
    modalScreen: {
      flex: 1,
      backgroundColor: palette.background,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      backgroundColor: palette.surface,
    },
    modalHeaderCopy: {
      flex: 1,
      gap: 4,
    },
    modalTitle: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "800",
      letterSpacing: 0,
    },
    modalSubtitle: {
      color: palette.textMuted,
      lineHeight: 18,
    },
    modalContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: 140,
      gap: spacing.md,
    },
    selectorSheetCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },
    bellButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
    },
    bellBadge: {
      position: "absolute",
      top: -3,
      right: -4,
      minWidth: 17,
      height: 17,
      borderRadius: 9,
      paddingHorizontal: 4,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.danger,
      borderWidth: 1.5,
      borderColor: palette.surface,
    },
    bellBadgeText: {
      color: palette.white,
      fontSize: 10,
      fontWeight: "800",
    },
    notificationHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    notificationClose: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
    },
    notificationList: {
      maxHeight: 380,
    },
    notificationRow: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    notificationRowSeen: {
      opacity: 0.62,
    },
    notificationIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
    },
    notificationIconDanger: {
      backgroundColor: isDark ? "rgba(255, 138, 128, 0.16)" : "rgba(176, 0, 32, 0.08)",
    },
    notificationCopy: {
      flex: 1,
      gap: 3,
    },
    notificationTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    notificationTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: "700",
      color: palette.text,
    },
    notificationUnseenDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: palette.primaryStrong,
    },
    notificationBody: {
      fontSize: 12,
      color: palette.textMuted,
      lineHeight: 17,
    },
    notificationMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    notificationMeta: {
      flex: 1,
      fontSize: 11,
      color: palette.textMuted,
    },
    notificationAmount: {
      fontSize: 12,
      fontWeight: "800",
      color: palette.primaryStrong,
    },
    notificationError: {
      fontSize: 11,
      color: palette.danger,
    },
    notificationEmpty: {
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.lg,
    },
    notificationEmptyText: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
    },
    iconButtonInverse: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.16)",
    },
    cameraScreen: {
      flex: 1,
      backgroundColor: "#000000",
      paddingTop: spacing.xl,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.md,
    },
    cameraHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    cameraHeaderCopy: {
      flex: 1,
      gap: 4,
    },
    cameraTitle: {
      color: palette.white,
      fontSize: 22,
      fontWeight: "800",
    },
    cameraSubtitle: {
      color: "rgba(255,255,255,0.78)",
      lineHeight: 18,
    },
    cameraFrame: {
      width: "100%",
      maxWidth: 520,
      minHeight: 240,
      alignSelf: "center",
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: "#000000",
    },
    cameraView: {
      flex: 1,
    },
    cameraPendingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      padding: spacing.lg,
    },
    cameraPendingText: {
      color: "rgba(255,255,255,0.78)",
      lineHeight: 18,
      textAlign: "center",
      fontWeight: "700",
    },
    cameraActions: {
      alignItems: "center",
      justifyContent: "center",
    },
    cameraCaptureButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingHorizontal: 22,
      paddingVertical: 16,
    },
    cameraCaptureText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 16,
    },
    cameraError: {
      color: "#ffb7b0",
      lineHeight: 20,
      textAlign: "center",
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      padding: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    inlineImagePreviewOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20,
      elevation: 20,
      backgroundColor: palette.overlay,
      padding: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    stepPagerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    stepPagerTitle: {
      flex: 1,
      minWidth: 140,
      color: palette.text,
      fontSize: 14,
      fontWeight: "800",
    },
    bulkActionBar: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      // `bottom` is set inline (bulkBarBottomInset) to clear the tab dock.
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.card,
    },
    bulkActionTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "800",
    },
    imagePreviewCard: {
      width: "100%",
      maxWidth: 720,
      height: "84%",
      maxHeight: 760,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },
    imagePreviewHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    imagePreviewViewport: {
      flex: 1,
      width: "100%",
      minHeight: 300,
      borderRadius: radii.md,
      backgroundColor: isDark ? "#050607" : "#f6f7fb",
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
    },
    imagePreviewScroll: {
      flex: 1,
      width: "100%",
    },
    imagePreviewScrollContent: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.sm,
    },
    imagePreviewImage: {
      maxWidth: "100%",
      maxHeight: "100%",
    },
    choiceList: {
      gap: spacing.sm,
    },
  });
}
