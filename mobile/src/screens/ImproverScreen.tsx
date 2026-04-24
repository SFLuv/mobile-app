import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { AppBackendClient } from "../services/appBackend";
import {
  AppCredentialRequest,
  AppCredentialType,
  AppGlobalCredentialType,
  AppImprover,
  AppImproverAbsencePeriod,
  AppImproverAbsencePeriodCreateResult,
  AppUser,
  AppWorkflowDropdownOption,
  AppWorkflow,
  AppWorkflowPhotoAspectRatio,
  AppWorkflowWorkItem,
  AppWorkflowStep,
  AppWorkflowStepCompletionInput,
  VerifiedEmail,
} from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  user: AppUser | null;
  improver: AppImprover | null;
  backendClient?: AppBackendClient | null;
  onRefreshProfile: () => Promise<void>;
};

type ImproverSection = "workflows" | "credentials";
type WorkflowView = "my-workflows" | "workflow-board" | "unpaid-workflows";
type WorkflowEditAction = "absence" | "revoke";

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
  primaryStepOrder: number;
  primaryStepTitle: string;
  workflowTitle: string;
  recurrence: AppWorkflow["recurrence"];
  absence: AppImproverAbsencePeriod | null;
  canRevokeAbsence: boolean;
  workflows: AppWorkflow[];
};

type RecurringClaimOption = {
  key: string;
  seriesId: string;
  stepOrder: number;
  workflowTitle: string;
  stepTitle: string;
  recurrence: AppWorkflow["recurrence"];
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

const MAX_MOBILE_WORKFLOW_PHOTO_BYTES = 2 * 1024 * 1024;
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
  requestEmailInput: string;
  selectedVerifiedEmailId: string | null;
  workflows: AppWorkflow[];
  unpaidWorkflows: AppWorkflow[];
  activeCredentials: AppCredentialType[];
  credentialTypes: AppGlobalCredentialType[];
  credentialRequests: AppCredentialRequest[];
  absencePeriods: AppImproverAbsencePeriod[];
  verifiedEmails: VerifiedEmail[];
  requestDataLoaded: boolean;
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
    requestEmailInput: "",
    selectedVerifiedEmailId: null,
    workflows: [],
    unpaidWorkflows: [],
    activeCredentials: [],
    credentialTypes: [],
    credentialRequests: [],
    absencePeriods: [],
    verifiedEmails: [],
    requestDataLoaded: false,
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
    return "Finalized";
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
    dpw_certified: "DPW Certified",
    sfluv_verifier: "SFLuv Verifier",
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
      ? "Any count"
      : `${Math.max(1, item.photoRequiredCount || 1)} photo${Math.max(1, item.photoRequiredCount || 1) === 1 ? "" : "s"}`;
    const aspectLabel =
      item.photoAspectRatio === "vertical"
        ? "vertical"
        : item.photoAspectRatio === "horizontal"
          ? "horizontal"
          : "square";
    const sourceLabel = item.cameraCaptureOnly ? "live camera only" : "camera or upload";
    requirements.push(`Photo (${countLabel}, ${aspectLabel}, ${sourceLabel})`);
  }
  if (item.requiresWrittenResponse) {
    requirements.push("Written response");
  }
  if (item.requiresDropdown) {
    requirements.push("Choice");
  }
  return requirements.length > 0 ? requirements.join(" + ") : "No requirement";
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
  const parts = (input || "")
    .trim()
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
  backendClient,
  onRefreshProfile,
}: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const topInset = Math.max(Constants.statusBarHeight, Platform.OS === "ios" ? spacing.md : 0);
  const userId = user?.id ?? null;
  const initialCache = getImproverScreenCache(userId);
  const [section, setSection] = useState<ImproverSection>(initialCache.section);
  const [workflowView, setWorkflowView] = useState<WorkflowView>(initialCache.workflowView);
  const [includePastWorkflows, setIncludePastWorkflows] = useState(initialCache.includePastWorkflows);
  const [workflowSelectorVisible, setWorkflowSelectorVisible] = useState(false);
  const [workflowEditMode, setWorkflowEditMode] = useState(false);
  const [workflowEditAction, setWorkflowEditAction] = useState<WorkflowEditAction>("absence");
  const [selectedWorkflowKeys, setSelectedWorkflowKeys] = useState<string[]>([]);
  const [badgesVisible, setBadgesVisible] = useState(false);
  const [badgeSearch, setBadgeSearch] = useState(initialCache.badgeSearch);
  const [boardSearch, setBoardSearch] = useState(initialCache.boardSearch);
  const [myWorkflowsSearch, setMyWorkflowsSearch] = useState(initialCache.myWorkflowsSearch);
  const [unpaidSearch, setUnpaidSearch] = useState(initialCache.unpaidSearch);
  const [credentialSearch, setCredentialSearch] = useState(initialCache.credentialSearch);
  const [requestFirstName, setRequestFirstName] = useState(initialCache.requestFirstName);
  const [requestLastName, setRequestLastName] = useState(initialCache.requestLastName);
  const [requestEmailInput, setRequestEmailInput] = useState(initialCache.requestEmailInput);
  const [selectedVerifiedEmailId, setSelectedVerifiedEmailId] = useState<string | null>(initialCache.selectedVerifiedEmailId);
  const [absenceFrom, setAbsenceFrom] = useState("");
  const [absenceUntil, setAbsenceUntil] = useState("");
  const [workflows, setWorkflows] = useState<AppWorkflow[]>(initialCache.workflows);
  const [unpaidWorkflows, setUnpaidWorkflows] = useState<AppWorkflow[]>(initialCache.unpaidWorkflows);
  const [activeCredentials, setActiveCredentials] = useState<AppCredentialType[]>(initialCache.activeCredentials);
  const [credentialTypes, setCredentialTypes] = useState<AppGlobalCredentialType[]>(initialCache.credentialTypes);
  const [credentialRequests, setCredentialRequests] = useState<AppCredentialRequest[]>(initialCache.credentialRequests);
  const [absencePeriods, setAbsencePeriods] = useState<AppImproverAbsencePeriod[]>(initialCache.absencePeriods);
  const [verifiedEmails, setVerifiedEmails] = useState<VerifiedEmail[]>(initialCache.verifiedEmails);
  const [requestDataLoaded, setRequestDataLoaded] = useState(initialCache.requestDataLoaded);
  const [requestDataLoading, setRequestDataLoading] = useState(false);
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
  const [stepNotPossibleForms, setStepNotPossibleForms] = useState<Record<string, StepNotPossibleForm>>({});
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [badgePreview, setBadgePreview] = useState<{ label: string; imageUri: string } | null>(null);
  const [photoPreviewUris, setPhotoPreviewUris] = useState<Record<string, string>>({});
  const [photoPreviewLoading, setPhotoPreviewLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const requestDataRequestRef = useRef<Promise<void> | null>(null);
  const workflowDataRequestRef = useRef<Promise<void> | null>(null);
  const unpaidDataRequestRef = useRef<Promise<void> | null>(null);
  const credentialDataRequestRef = useRef<Promise<void> | null>(null);
  const absenceDataRequestRef = useRef<Promise<void> | null>(null);
  const cacheUserIdRef = useRef(userId);
  const skipCachePersistRef = useRef(false);

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
    setRequestEmailInput(nextCache.requestEmailInput);
    setSelectedVerifiedEmailId(nextCache.selectedVerifiedEmailId);
    setWorkflows(nextCache.workflows);
    setUnpaidWorkflows(nextCache.unpaidWorkflows);
    setActiveCredentials(nextCache.activeCredentials);
    setCredentialTypes(nextCache.credentialTypes);
    setCredentialRequests(nextCache.credentialRequests);
    setAbsencePeriods(nextCache.absencePeriods);
    setVerifiedEmails(nextCache.verifiedEmails);
    setRequestDataLoaded(nextCache.requestDataLoaded);
    setWorkflowDataLoaded(nextCache.workflowDataLoaded);
    setUnpaidDataLoaded(nextCache.unpaidDataLoaded);
    setCredentialDataLoaded(nextCache.credentialDataLoaded);
    setAbsenceDataLoaded(nextCache.absenceDataLoaded);
    setRequestDataLoading(false);
    setWorkflowDataLoading(false);
    setUnpaidDataLoading(false);
    setCredentialDataLoading(false);
    setAbsenceDataLoading(false);
    setWorkflowSelectorVisible(false);
    setWorkflowEditMode(false);
    setSelectedWorkflowKeys([]);
    setBadgesVisible(false);
    setBadgePreview(null);
    setSelectedWorkflow(null);
    setDetailVisible(false);
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
      requestEmailInput,
      selectedVerifiedEmailId,
      workflows,
      unpaidWorkflows,
      activeCredentials,
      credentialTypes,
      credentialRequests,
      absencePeriods,
      verifiedEmails,
      requestDataLoaded,
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
    requestDataLoaded,
    requestEmailInput,
    requestFirstName,
    requestLastName,
    section,
    selectedVerifiedEmailId,
    unpaidDataLoaded,
    unpaidSearch,
    unpaidWorkflows,
    userId,
    verifiedEmails,
    workflowDataLoaded,
    workflows,
    workflowView,
  ]);

  const loadRequestData = useCallback(
    async (force = false, options?: LoadOptions) => {
      if (!backendClient) {
        return;
      }
      const silent = options?.silent === true;
      if (requestDataRequestRef.current && (!force || silent)) {
        return requestDataRequestRef.current;
      }

      const request = (async () => {
        if (!silent) {
          setRequestDataLoading(true);
        }
        try {
          const [emails, loadedCredentialTypes] = await Promise.all([
            backendClient.getVerifiedEmails(),
            backendClient.getCredentialTypes(),
          ]);
          setVerifiedEmails(emails);
          setCredentialTypes(loadedCredentialTypes);
          if (!silent) {
            setError(null);
          }
        } catch (nextError) {
          if (!silent) {
            setError((nextError as Error)?.message || "Unable to load improver request details.");
          }
        } finally {
          setRequestDataLoaded(true);
          if (!silent) {
            setRequestDataLoading(false);
          }
          requestDataRequestRef.current = null;
        }
      })();

      requestDataRequestRef.current = request;
      return request;
    },
    [backendClient],
  );

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
            setError((nextError as Error)?.message || "Unable to load workflows.");
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
            setError((nextError as Error)?.message || "Unable to load workflow absence.");
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
            setError((nextError as Error)?.message || "Unable to load unpaid workflows.");
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
            setError((nextError as Error)?.message || "Unable to load credentials.");
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
    [activeCredentials.length, backendClient, workflowDataLoaded],
  );

  useEffect(() => {
    if (!backendClient) {
      return;
    }
    if (!canUsePanel) {
      void loadRequestData(requestDataLoaded, { silent: requestDataLoaded });
      return;
    }
    void loadWorkflowData(workflowDataLoaded, { silent: workflowDataLoaded });
  }, [backendClient, canUsePanel, loadRequestData, loadWorkflowData, userId]);

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
    setBadgePreview(null);
  }, []);

  useEffect(() => {
    if (!badgesVisible) {
      setBadgePreview(null);
    }
  }, [badgesVisible]);

  const hasClaimedRoleInWorkflow = useCallback(
    (workflow: AppWorkflow) => workflow.steps.some((step) => step.assignedImproverId === user?.id),
    [user?.id],
  );

  const isWorkflowActiveForUser = useCallback(
    (workflow: AppWorkflow) =>
      workflow.steps.some(
        (step) =>
          step.assignedImproverId === user?.id &&
          (step.status === "available" || step.status === "in_progress"),
      ),
    [user?.id],
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
      if (hasClaimedRoleInWorkflow(workflow)) {
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
    [credentialSet, hasClaimedRoleInWorkflow, isStepCoveredByAbsence, user?.id],
  );

  const myClaimedWorkflows = useMemo(
    () => workflows.filter((workflow) => hasClaimedRoleInWorkflow(workflow)),
    [hasClaimedRoleInWorkflow, workflows],
  );

  const myWorkflowGroups = useMemo<WorkflowSeriesGroup[]>(() => {
    if (!user?.id) {
      return [];
    }
    const groups = new Map<string, WorkflowSeriesGroup>();

    for (const workflow of myClaimedWorkflows) {
      const assignedStep = resolveAssignedStep(workflow, user.id);
      if (!assignedStep) {
        continue;
      }
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
        workflows: [...existing.workflows, workflow].sort((left, right) => right.startAt - left.startAt),
      });
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

        const canRevokeAbsence =
          Boolean(matchingAbsence) &&
          !workflows.some((candidateWorkflow) => {
            if (!matchingAbsence) {
              return false;
            }
            if (candidateWorkflow.seriesId !== matchingAbsence.seriesId) {
              return false;
            }
            if (
              candidateWorkflow.startAt < matchingAbsence.absentFrom ||
              candidateWorkflow.startAt >= matchingAbsence.absentUntil
            ) {
              return false;
            }
            return candidateWorkflow.steps.some(
              (step) =>
                step.stepOrder === matchingAbsence.stepOrder &&
                Boolean(step.assignedImproverId) &&
                step.assignedImproverId !== user.id,
            );
          });

        return {
          ...group,
          absence: matchingAbsence,
          canRevokeAbsence,
          workflows: [...group.workflows].sort((left, right) => right.startAt - left.startAt),
        };
      })
      .sort((left, right) => {
        const leftActive = left.workflows.some((workflow) => isWorkflowActiveForUser(workflow));
        const rightActive = right.workflows.some((workflow) => isWorkflowActiveForUser(workflow));
        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1;
        }
        return (right.workflows[0]?.startAt || 0) - (left.workflows[0]?.startAt || 0);
      });
  }, [absencePeriods, isWorkflowActiveForUser, myClaimedWorkflows, user?.id, workflows]);

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
          group.primaryStepTitle.toLowerCase().includes(search)
        );
      });
  }, [includePastWorkflows, myWorkflowGroups, myWorkflowsSearch]);

  const workflowBoardWorkflows = useMemo(
    () =>
      workflows.filter((workflow) => {
        if (hasClaimedRoleInWorkflow(workflow)) {
          return false;
        }
        return workflow.steps.some((step) => canClaimStep(workflow, step));
      }),
    [canClaimStep, hasClaimedRoleInWorkflow, workflows],
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
        { value: "my-workflows", label: "My workflows" },
        { value: "workflow-board", label: "Workflow board" },
        ...(hasUnpaidWorkflowOption ? [{ value: "unpaid-workflows" as const, label: "Unpaid workflows" }] : []),
      ],
    [hasUnpaidWorkflowOption],
  );

  useEffect(() => {
    if (workflowView === "unpaid-workflows" && !hasUnpaidWorkflowOption) {
      setWorkflowView("my-workflows");
    }
  }, [hasUnpaidWorkflowOption, workflowView]);

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

  const myBadgeItems = useMemo(() => {
    const typeByValue = new Map<string, AppGlobalCredentialType>();
    for (const credentialType of credentialTypes) {
      typeByValue.set(credentialType.value, credentialType);
    }
    return activeCredentials
      .map((credential) => {
        const type = typeByValue.get(credential);
        return {
          credential,
          label: formatCredentialLabel(credential, labelMap),
          badgeUri: buildCredentialBadgeUri(type),
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [activeCredentials, credentialTypes, labelMap]);

  const filteredBadgeItems = useMemo(() => {
    const search = badgeSearch.trim().toLowerCase();
    if (!search) {
      return myBadgeItems;
    }
    return myBadgeItems.filter((badge) => badge.label.toLowerCase().includes(search));
  }, [badgeSearch, myBadgeItems]);

  const verifiedEmailsByStatus = useMemo(
    () => ({
      verified: verifiedEmails.filter((email) => email.status === "verified"),
      pending: verifiedEmails.filter((email) => email.status !== "verified"),
    }),
    [verifiedEmails],
  );

  useEffect(() => {
    if (!selectedVerifiedEmailId && verifiedEmailsByStatus.verified[0]) {
      setSelectedVerifiedEmailId(verifiedEmailsByStatus.verified[0].id);
    }
  }, [selectedVerifiedEmailId, verifiedEmailsByStatus.verified]);

  const mergeWorkflow = useCallback((updatedWorkflow: AppWorkflow) => {
    setWorkflows((current) => {
      const existing = current.some((workflow) => workflow.id === updatedWorkflow.id);
      return existing
        ? current.map((workflow) => (workflow.id === updatedWorkflow.id ? updatedWorkflow : workflow))
        : [updatedWorkflow, ...current];
    });
    setUnpaidWorkflows((current) => {
      const existing = current.some((workflow) => workflow.id === updatedWorkflow.id);
      return existing
        ? current.map((workflow) => (workflow.id === updatedWorkflow.id ? updatedWorkflow : workflow))
        : [updatedWorkflow, ...current];
    });
    setSelectedWorkflow((current) => (current?.id === updatedWorkflow.id ? updatedWorkflow : current));
  }, []);

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
    async (workflow: AppWorkflow) => {
      setSelectedWorkflow(workflow);
      setDetailStepIndex(getInitialStepIndexForWorkflow(workflow));
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
        setSelectedWorkflow(refreshedWorkflow);
        setDetailStepIndex(getInitialStepIndexForWorkflow(refreshedWorkflow));
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to load workflow details.");
      } finally {
        setDetailLoading(false);
      }
    },
    [backendClient, getInitialStepIndexForWorkflow, loadAbsenceData],
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

  const setItemForm = useCallback((stepId: string, itemId: string, patch: Partial<CompletionItemForm>) => {
    setStepErrors((current) => {
      if (!current[stepId]) {
        return current;
      }
      const next = { ...current };
      delete next[stepId];
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

  const openCameraCapture = useCallback(
    async (stepId: string, itemId: string, title: string, aspectRatio: AppWorkflowPhotoAspectRatio, maxCount: number | null) => {
      const currentPermission = permission?.granted ? permission : await requestPermission();
      if (!currentPermission?.granted) {
        setCameraError("Camera permission is required to add workflow photos.");
        return;
      }
      setCameraError(null);
      setCameraTarget({
        stepId,
        itemId,
        title,
        aspectRatio,
        maxCount,
      });
    },
    [permission, requestPermission],
  );

  const captureWorkflowPhoto = useCallback(async () => {
    if (!cameraTarget) {
      return;
    }
    setCameraError(null);
    try {
      const result = await (cameraRef.current as any)?.takePictureAsync({
        base64: true,
        quality: 0.45,
        skipProcessing: false,
      });
      const base64 = typeof result?.base64 === "string" ? result.base64.trim() : "";
      if (!base64) {
        throw new Error("Unable to capture a photo right now.");
      }
      const photo = createCompletionPhoto(base64, cameraTarget.title, "image/jpeg");
      if (photo.sizeBytes > MAX_MOBILE_WORKFLOW_PHOTO_BYTES) {
        throw new Error("That photo is too large. Try again with a simpler shot.");
      }
      addPhotosToItem(cameraTarget.stepId, cameraTarget.itemId, [photo], cameraTarget.maxCount);
      setCameraTarget(null);
    } catch (nextError) {
      setCameraError((nextError as Error)?.message || "Unable to capture a workflow photo.");
    }
  }, [addPhotosToItem, cameraTarget, createCompletionPhoto]);

  const pickLibraryPhotos = useCallback(
    async (stepId: string, itemId: string, title: string, maxCount: number | null) => {
      if (!OPTIONAL_IMAGE_PICKER?.launchImageLibraryAsync) {
        setError("Photo library uploads are not available on this build yet.");
        setNotice(null);
        return;
      }
      try {
        const permissionResult = await OPTIONAL_IMAGE_PICKER.requestMediaLibraryPermissionsAsync();
        if (!permissionResult?.granted) {
          throw new Error("Photo library permission is required to attach workflow photos.");
        }

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
            throw new Error("One of the selected photos could not be read.");
          }
          const contentType = typeof asset?.mimeType === "string" && asset.mimeType.startsWith("image/")
            ? asset.mimeType
            : "image/jpeg";
          const photo = createCompletionPhoto(base64, `${title}_${index + 1}`, contentType);
          if (photo.sizeBytes > MAX_MOBILE_WORKFLOW_PHOTO_BYTES) {
            throw new Error("One of the selected photos is too large after compression.");
          }
          return photo;
        });

        if (nextPhotos.length > 0) {
          addPhotosToItem(stepId, itemId, nextPhotos, maxCount);
          setError(null);
        }
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to attach library photos.");
        setNotice(null);
      }
    },
    [addPhotosToItem, createCompletionPhoto],
  );

  const buildCompletionPayload = useCallback(
    (workflow: AppWorkflow, step: AppWorkflowStep): AppWorkflowStepCompletionInput => {
      const notPossibleForm = stepNotPossibleForms[step.id] || emptyStepNotPossibleForm();
      if (step.allowStepNotPossible && notPossibleForm.selected) {
        const details = notPossibleForm.details.trim();
        if (!details) {
          throw new Error("Explain why this step cannot be completed.");
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
          throw new Error(`Missing response for ${item.title}.`);
        }
        if (item.requiresDropdown && !dropdownValue) {
          throw new Error(`Choose an option for ${item.title}.`);
        }
        if (requiresWritten && !writtenResponse) {
          throw new Error(`Enter a written response for ${item.title}.`);
        }
        if (requiresPhoto) {
          if (item.requiresPhoto && item.photoAllowAnyCount) {
            if (form.photos.length === 0) {
              throw new Error(`Add at least one photo for ${item.title}.`);
            }
          } else if (item.requiresPhoto) {
            const requiredCount = Math.max(1, item.photoRequiredCount || 1);
            if (form.photos.length !== requiredCount) {
              throw new Error(`Add exactly ${requiredCount} photo${requiredCount === 1 ? "" : "s"} for ${item.title}.`);
            }
          } else if (form.photos.length === 0) {
            throw new Error(`Add a photo for ${item.title}.`);
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
        setNotice(payload.stepNotPossible ? "Step marked not possible." : "Workflow step completed.");
        setError(null);
        setCompletionForms((current) => {
          if (!current[step.id]) {
            return current;
          }
          const next = { ...current };
          delete next[step.id];
          return next;
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
        const message = (nextError as Error)?.message || "Unable to complete this workflow step.";
        setStepErrors((current) => ({
          ...current,
          [step.id]: message,
        }));
      } finally {
        setActionKey("");
      }
    },
    [backendClient, buildCompletionPayload, mergeWorkflow, refreshSelectedWorkflow, refreshWorkflowSurfaces],
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
        setNotice("Payout retry requested.");
        setError(null);
        await loadUnpaidData(true);
        await refreshSelectedWorkflow(workflowId);
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to request payout retry.");
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
        setNotice(failedSteps.length === 1 ? "Payout retry requested." : `${failedSteps.length} payout retries requested.`);
        setError(null);
        await loadUnpaidData(true);
        await refreshSelectedWorkflow(workflow.id);
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to request payout retries.");
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
        setNotice("Workflow step claimed.");
        setError(null);
        await refreshWorkflowSurfaces();
        await refreshSelectedWorkflow(workflowId);
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to claim this workflow step.");
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, mergeWorkflow, refreshSelectedWorkflow, refreshWorkflowSurfaces],
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
        setNotice("Workflow step started.");
        setError(null);
        await refreshWorkflowSurfaces();
        await refreshSelectedWorkflow(workflowId);
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to start this workflow step.");
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
        setNotice(`Requested ${formatCredentialLabel(credentialType, labelMap)}.`);
        setError(null);
        await loadCredentialData(true);
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to request that credential.");
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, labelMap, loadCredentialData],
  );

  const requestImproverAccess = useCallback(async () => {
    if (!backendClient) {
      return;
    }
    const selectedEmail =
      verifiedEmailsByStatus.verified.find((email) => email.id === selectedVerifiedEmailId)?.email || "";
    if (!requestFirstName.trim() || !requestLastName.trim()) {
      setError("First and last name are required.");
      setNotice(null);
      return;
    }
    if (!selectedEmail) {
      setError("Select a verified email before requesting improver status.");
      setNotice(null);
      return;
    }
    setActionKey("request-improver");
    try {
      await backendClient.updateUserInfo({
        name: `${requestFirstName.trim()} ${requestLastName.trim()}`.trim(),
        email: selectedEmail,
      });
      await backendClient.requestImproverStatus({
        firstName: requestFirstName.trim(),
        lastName: requestLastName.trim(),
        email: selectedEmail,
      });
      await onRefreshProfile();
      await loadRequestData(true);
      setNotice("Improver status requested.");
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to request improver status.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  }, [
    backendClient,
    loadRequestData,
    onRefreshProfile,
    requestFirstName,
    requestLastName,
    selectedVerifiedEmailId,
    verifiedEmailsByStatus.verified,
  ]);

  const requestEmailVerification = useCallback(async () => {
    if (!backendClient) {
      return;
    }
    if (!requestEmailInput.trim()) {
      setError("Enter an email address to verify.");
      setNotice(null);
      return;
    }
    setActionKey("request-email");
    try {
      await backendClient.requestVerifiedEmail(requestEmailInput.trim());
      await loadRequestData(true);
      setRequestEmailInput("");
      setNotice("Verification email sent.");
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to send a verification email.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  }, [backendClient, loadRequestData, requestEmailInput]);

  const resendEmailVerification = useCallback(
    async (emailId: string) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`resend-email:${emailId}`);
      try {
        await backendClient.resendVerifiedEmail(emailId);
        await loadRequestData(true);
        setNotice("Verification email resent.");
        setError(null);
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to resend verification.");
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, loadRequestData],
  );

  const revokeAbsence = useCallback(
    async (absenceId: string) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`absence-delete:${absenceId}`);
      try {
        await backendClient.deleteImproverAbsencePeriod(absenceId);
        setNotice("Absence revoked.");
        setError(null);
        await refreshWorkflowSurfaces();
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to revoke absence.");
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, refreshWorkflowSurfaces],
  );

  const revokeWorkflowSeries = useCallback(
    async (seriesId: string, stepOrder: number) => {
      if (!backendClient) {
        return;
      }
      setActionKey(`unclaim:${seriesId}:${stepOrder}`);
      try {
        const result = await backendClient.unclaimImproverWorkflowSeries(seriesId, stepOrder);
        setNotice(
          result.skippedCount > 0
            ? `Released ${result.releasedCount} claims and skipped ${result.skippedCount} active assignments.`
            : `Released ${result.releasedCount} claims.`,
        );
        setError(null);
        await refreshWorkflowSurfaces();
        setDetailVisible(false);
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to revoke these workflow claims.");
        setNotice(null);
      } finally {
        setActionKey("");
      }
    },
    [backendClient, refreshWorkflowSurfaces],
  );

  const applyWorkflowEditAction = useCallback(() => {
    if (selectedWorkflowGroups.length === 0 || !backendClient) {
      return;
    }

    if (workflowEditAction === "revoke") {
      Alert.alert(
        "Revoke selected workflows?",
        "This will release the selected recurring workflow claims to other improvers.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Revoke",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setActionKey("bulk-revoke");
                try {
                  for (const group of selectedWorkflowGroups) {
                    await backendClient.unclaimImproverWorkflowSeries(group.seriesId, group.primaryStepOrder);
                  }
                  setNotice(
                    selectedWorkflowGroups.length === 1
                      ? "Selected workflow revoked."
                      : `${selectedWorkflowGroups.length} workflows revoked.`,
                  );
                  setError(null);
                  setWorkflowEditMode(false);
                  setSelectedWorkflowKeys([]);
                  await refreshWorkflowSurfaces();
                } catch (nextError) {
                  setError((nextError as Error)?.message || "Unable to revoke selected workflows.");
                  setNotice(null);
                } finally {
                  setActionKey("");
                }
              })();
            },
          },
        ],
      );
      return;
    }

    if (!isValidDateInput(absenceFrom) || !isValidDateInput(absenceUntil)) {
      setError("Enter absence dates in YYYY-MM-DD format.");
      setNotice(null);
      return;
    }
    if (absenceFrom > absenceUntil) {
      setError("Absent end date must be on or after the start date.");
      setNotice(null);
      return;
    }

    void (async () => {
      setActionKey("bulk-absence");
      try {
        const summaries: AppImproverAbsencePeriodCreateResult[] = [];
        for (const group of selectedWorkflowGroups) {
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
            ? `Absence saved. Released ${released} assignments and skipped ${skipped} active ones.`
            : `Absence saved. Released ${released} assignments.`,
        );
        setError(null);
        setWorkflowEditMode(false);
        setSelectedWorkflowKeys([]);
        setAbsenceFrom("");
        setAbsenceUntil("");
        await refreshWorkflowSurfaces();
      } catch (nextError) {
        setError((nextError as Error)?.message || "Unable to save absence coverage.");
        setNotice(null);
      } finally {
        setActionKey("");
      }
    })();
  }, [
    absenceFrom,
    absenceUntil,
    backendClient,
    refreshWorkflowSurfaces,
    selectedWorkflowGroups,
    workflowEditAction,
  ]);

  const currentWorkflowOptionsLabel =
    workflowSelectorOptions.find((option) => option.value === workflowView)?.label || "My workflows";

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
    return !workflows.some((workflow) => {
      if (workflow.seriesId !== selectedWorkflowAbsence.seriesId) {
        return false;
      }
      if (
        workflow.startAt < selectedWorkflowAbsence.absentFrom ||
        workflow.startAt >= selectedWorkflowAbsence.absentUntil
      ) {
        return false;
      }
      return workflow.steps.some(
        (step) =>
          step.stepOrder === selectedWorkflowAssignedStep.stepOrder &&
          Boolean(step.assignedImproverId) &&
          step.assignedImproverId !== user.id,
      );
    });
  }, [selectedWorkflowAbsence, selectedWorkflowAssignedStep, selectedWorkflow, user?.id, workflows]);

  const sortedDetailSteps = useMemo(
    () => (selectedWorkflow ? [...selectedWorkflow.steps].sort((left, right) => left.stepOrder - right.stepOrder) : []),
    [selectedWorkflow],
  );
  const currentDetailStepIndex = Math.min(detailStepIndex, Math.max(sortedDetailSteps.length - 1, 0));
  const currentDetailStep = sortedDetailSteps[currentDetailStepIndex] || null;
  const detailSubmissionExpanded = currentDetailStep ? Boolean(submissionDetailsOpen[currentDetailStep.id]) : false;

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
      <ActivityIndicator size="small" color={palette.primary} />
      <Text style={styles.loadingInlineText}>{label}</Text>
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

    return (
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {renderBannerStack()}

        {improver ? (
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Current request</Text>
              {renderStatusChip(formatStatusLabel(improver.status), statusTone)}
            </View>
            <Text style={styles.meta}>{`${improver.firstName} ${improver.lastName}`.trim()}</Text>
            <Text style={styles.meta}>{improver.email}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Verified email</Text>
          {requestDataLoading && !requestDataLoaded ? renderLoadingCard("Loading verified emails...") : null}
          {verifiedEmailsByStatus.verified.map((email) => {
            const selected = selectedVerifiedEmailId === email.id;
            return (
              <Pressable
                key={email.id}
                style={[styles.choiceRow, selected ? styles.choiceRowActive : undefined]}
                onPress={() => setSelectedVerifiedEmailId(email.id)}
              >
                <View style={styles.choiceCopy}>
                  <Text style={styles.choiceTitle}>{email.email}</Text>
                  <Text style={styles.choiceBody}>
                    Verified {email.verifiedAt ? new Date(email.verifiedAt).toLocaleDateString() : "recently"}
                  </Text>
                </View>
                {selected ? <Ionicons name="checkmark-circle" size={20} color={palette.primaryStrong} /> : null}
              </Pressable>
            );
          })}
          {verifiedEmailsByStatus.verified.length === 0 && requestDataLoaded ? (
            <Text style={styles.meta}>No verified emails yet.</Text>
          ) : null}

          <View style={styles.inlineForm}>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="name@example.com"
              placeholderTextColor={palette.textMuted}
              value={requestEmailInput}
              onChangeText={setRequestEmailInput}
            />
            <Pressable
              style={[styles.primaryButton, actionKey === "request-email" ? styles.buttonDisabled : undefined]}
              disabled={actionKey === "request-email"}
              onPress={() => {
                void requestEmailVerification();
              }}
            >
              <Text style={styles.primaryButtonText}>
                {actionKey === "request-email" ? "Sending..." : "Send verification"}
              </Text>
            </Pressable>
          </View>

          {verifiedEmailsByStatus.pending.length > 0 ? (
            <View style={styles.stack}>
              {verifiedEmailsByStatus.pending.map((email) => (
                <View key={email.id} style={styles.pendingEmailRow}>
                  <View style={styles.choiceCopy}>
                    <Text style={styles.choiceTitle}>{email.email}</Text>
                    <Text style={styles.choiceBody}>
                      {email.status === "expired" ? "Expired" : "Waiting for verification"}
                    </Text>
                  </View>
                  <Pressable
                    style={[
                      styles.secondaryButton,
                      actionKey === `resend-email:${email.id}` ? styles.buttonDisabled : undefined,
                    ]}
                    disabled={actionKey === `resend-email:${email.id}`}
                    onPress={() => {
                      void resendEmailVerification(email.id);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {actionKey === `resend-email:${email.id}` ? "Sending..." : "Resend"}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Request improver status</Text>
          <TextInput
            style={styles.input}
            placeholder="First name"
            placeholderTextColor={palette.textMuted}
            value={requestFirstName}
            onChangeText={setRequestFirstName}
          />
          <TextInput
            style={styles.input}
            placeholder="Last name"
            placeholderTextColor={palette.textMuted}
            value={requestLastName}
            onChangeText={setRequestLastName}
          />
          <Pressable
            style={[styles.primaryButton, actionKey === "request-improver" ? styles.buttonDisabled : undefined]}
            disabled={
              actionKey === "request-improver" ||
              !requestFirstName.trim() ||
              !requestLastName.trim() ||
              !selectedVerifiedEmailId
            }
            onPress={() => {
              void requestImproverAccess();
            }}
          >
            <Text style={styles.primaryButtonText}>
              {actionKey === "request-improver" ? "Submitting..." : "Request improver status"}
            </Text>
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
      group.workflows.find((workflow) => isWorkflowActiveForUser(workflow)) || group.workflows[0];
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
              Step {group.primaryStepOrder}: {group.primaryStepTitle}
            </Text>
            <Text style={styles.meta}>Next: {formatWorkflowDate(focusWorkflow.startAt)}</Text>
          </View>
          <View style={styles.cardBadgeStack}>
            {renderStatusChip(formatWorkflowDisplayStatus(focusWorkflow), resolveWorkflowTone(focusWorkflow))}
            {group.absence ? (
              renderStatusChip(
                `Absent until ${formatDateFromUnix(group.absence.absentUntil, true)}`,
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
            {group.workflows.length} upcoming assignments
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const renderWorkflowBoardCard = (workflow: AppWorkflow) => {
    const claimableStep = workflow.steps.find((step) => canClaimStep(workflow, step));
    return (
      <Pressable key={workflow.id} style={styles.card} onPress={() => void openWorkflowDetail(workflow)}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.workflowTitle} numberOfLines={2}>
              {workflow.title}
            </Text>
            {claimableStep ? (
              <Text style={styles.meta}>
                Claimable: Step {claimableStep.stepOrder}
                {claimableStep.title ? ` - ${claimableStep.title}` : ""}
              </Text>
            ) : null}
            <Text style={styles.meta}>Starts: {formatWorkflowDate(workflow.startAt)}</Text>
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
              {actionKey === `claim:${claimableStep.id}` ? "Claiming..." : `Claim Step ${claimableStep.stepOrder}`}
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
            <Text style={styles.meta}>Pending payouts: {unpaidSteps.length}</Text>
            {failedSteps.length > 0 ? (
              <Text style={styles.inlineError}>
                {failedSteps.length === 1 ? "1 payout needs attention" : `${failedSteps.length} payouts need attention`}
              </Text>
            ) : null}
          </View>
          {renderStatusChip(
            failedSteps.length > 0 ? "Action needed" : "Pending",
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
                ? "Requesting..."
                : failedSteps.length === 1
                  ? "Retry failed payout"
                  : "Retry failed payouts"}
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
        ? "Search your workflows"
        : workflowView === "workflow-board"
          ? "Search the workflow board"
          : "Search unpaid workflows";

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
                    Past
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
                  <Text style={styles.compactActionButtonText}>{workflowEditMode ? "Done" : "Edit"}</Text>
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

        {workflowView === "my-workflows" && !workflowDataLoaded ? renderLoadingCard("Loading workflows...") : null}
        {workflowView === "workflow-board" && (!workflowDataLoaded || !absenceDataLoaded)
          ? renderLoadingCard("Loading workflow board...")
          : null}
        {workflowView === "unpaid-workflows" && !unpaidDataLoaded ? renderLoadingCard("Loading unpaid workflows...") : null}

        {workflowView === "my-workflows" && workflowDataLoaded
          ? filteredMyWorkflowGroups.length === 0
            ? renderEmptyCard("No claimed workflows", "Claimed workflows will appear here.")
            : filteredMyWorkflowGroups.map(renderMyWorkflowCard)
          : null}

        {workflowView === "workflow-board" && workflowDataLoaded && absenceDataLoaded
          ? filteredWorkflowBoard.length === 0
            ? renderEmptyCard("No eligible workflows", "Nothing is claimable for your credentials right now.")
            : filteredWorkflowBoard.map(renderWorkflowBoardCard)
          : null}

        {workflowView === "unpaid-workflows" && unpaidDataLoaded
          ? filteredUnpaidWorkflowCards.length === 0
            ? renderEmptyCard("No unpaid workflows", "Completed payouts waiting on settlement will appear here.")
            : filteredUnpaidWorkflowCards.map(renderUnpaidWorkflowCard)
          : null}
      </View>
    );
  };

  const renderCredentialsContent = () => (
    <View style={styles.sectionStack}>
      <View style={styles.card}>
        <Pressable style={styles.primaryButton} onPress={() => setBadgesVisible(true)}>
          <Text style={styles.primaryButtonText}>My badges</Text>
        </Pressable>
        {activeCredentials.length > 0 ? (
          <View style={styles.chipWrap}>
            {activeCredentials.map((credential) =>
              renderStatusChip(formatCredentialLabel(credential, labelMap), "default"),
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search credential types"
            placeholderTextColor={palette.textMuted}
            value={credentialSearch}
            onChangeText={setCredentialSearch}
          />
        </View>

        {credentialDataLoading && !credentialDataLoaded ? renderLoadingCard("Loading credentials...") : null}

        {credentialSuggestions.length > 0 ? (
          <View style={styles.stack}>
            {credentialSuggestions.map((credentialType) => (
              <View key={credentialType.value} style={styles.choiceRow}>
                <View style={styles.choiceCopy}>
                  <Text style={styles.choiceTitle}>{credentialType.label}</Text>
                  <Text style={styles.choiceBody}>
                    {pendingCredentialSet.has(credentialType.value) ? "Request already pending." : "Available to request."}
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.secondaryButton,
                    pendingCredentialSet.has(credentialType.value) || Boolean(actionKey) ? styles.buttonDisabled : undefined,
                  ]}
                  disabled={pendingCredentialSet.has(credentialType.value) || Boolean(actionKey)}
                  onPress={() => {
                    void requestCredential(credentialType.value);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>
                    {actionKey === `credential:${credentialType.value}` ? "Sending..." : "Request"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {credentialRequests.length > 0 ? (
          <View style={styles.stack}>
            <Text style={styles.stackLabel}>Request history</Text>
            {credentialRequests.map((request) => (
              <View key={request.id} style={styles.subCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.cardHeaderCopy}>
                    <Text style={styles.choiceTitle}>
                      {formatCredentialLabel(request.credentialType, labelMap)}
                    </Text>
                    <Text style={styles.choiceBody}>
                      Requested {new Date(request.requestedAt).toLocaleString()}
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
                    Resolved {new Date(request.resolvedAt).toLocaleString()}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : credentialDataLoaded ? (
          <Text style={styles.meta}>No credential requests yet.</Text>
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
            response.photos?.find((photo) => photo.id === photoId)?.fileName || `Photo ${photoIndex + 1}`;
          return (
            <Pressable
              key={photoId}
              style={styles.photoCard}
              disabled={!previewUri}
              onPress={() => {
                if (previewUri) {
                  setBadgePreview({ label: fileName, imageUri: previewUri });
                }
              }}
            >
              {previewUri ? (
                <Image source={{ uri: previewUri }} style={styles.photoPreview} resizeMode="cover" />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderText}>
                    {previewLoading ? "Loading..." : "Preview unavailable"}
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
            onPress={() => setBadgePreview({ label: `Photo ${photoIndex + 1}`, imageUri: photoUrl })}
          >
            <Image source={{ uri: photoUrl }} style={styles.photoPreview} resizeMode="cover" />
            <Text style={styles.photoLabel} numberOfLines={1}>
              Photo {photoIndex + 1}
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
              Item {item.itemOrder}: {item.title}
            </Text>
            {item.description ? <Text style={styles.choiceBody}>{item.description}</Text> : null}
          </View>
          {item.optional ? renderStatusChip("Optional", "default") : null}
        </View>
        <Text style={styles.meta}>Requirements: {formatWorkItemRequirements(item)}</Text>

                {itemResponses.length > 0 ? (
          itemResponses.map((response, index) => {
            const dropdownLabel = response.dropdownValue
              ? item.dropdownOptions.find((option) => option.value === response.dropdownValue)?.label || response.dropdownValue
              : "";
            return (
              <View key={`${item.id}-response-${index}`} style={styles.responseCard}>
                {itemResponses.length > 1 ? (
                  <Text style={styles.responseLabel}>Submitted response {index + 1}</Text>
                ) : null}
                {dropdownLabel ? (
                  <View style={styles.responseRow}>
                    <Text style={styles.responseKey}>Selected option</Text>
                    <Text style={styles.responseValue}>{dropdownLabel}</Text>
                  </View>
                ) : null}
                {response.writtenResponse ? (
                  <View style={styles.stack}>
                    <Text style={styles.responseKey}>Notes</Text>
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
          <Text style={styles.meta}>No response submitted for this item.</Text>
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
              {actionKey === `claim:${step.id}` ? "Claiming..." : `Claim step ${step.stepOrder}`}
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
              {actionKey === `start:${step.id}` ? "Starting..." : "Start step"}
            </Text>
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
                  <Text style={styles.choiceTitle}>Step not possible</Text>
                  <Text style={styles.choiceBody}>Ends the workflow without payout if the work cannot be completed.</Text>
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
                placeholder="Explain why this step cannot be completed."
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
                        Item {item.itemOrder}: {item.title}
                      </Text>
                      {item.description ? <Text style={styles.choiceBody}>{item.description}</Text> : null}
                      <Text style={styles.meta}>Requirements: {formatWorkItemRequirements(item)}</Text>

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
                          placeholder="Enter your response"
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
                              <View key={photo.id} style={styles.photoCard}>
                                <Image source={{ uri: photo.previewUri }} style={styles.photoPreview} resizeMode="cover" />
                                <Text style={styles.photoLabel} numberOfLines={1}>
                                  {photo.fileName}
                                </Text>
                                <Pressable
                                  style={styles.photoRemoveButton}
                                  onPress={() => removeCompletionPhoto(step.id, item.id, photo.id)}
                                >
                                  <Text style={styles.photoRemoveText}>Remove</Text>
                                </Pressable>
                              </View>
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
                                {form.photos.length > 0 ? "Capture another live photo" : "Capture live photo"}
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
                                <Text style={styles.secondaryButtonText}>Upload from library</Text>
                              </Pressable>
                            ) : null}
                          </View>
                          {!imagePickerAvailable && !effectiveCameraOnly ? (
                            <Text style={styles.meta}>Photo library uploads will work once the image picker dependency is installed.</Text>
                          ) : null}
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
                  ? "Submitting..."
                  : notPossibleForm.selected
                    ? "Mark step not possible"
                    : "Complete step"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          workflowEditMode && workflowView === "my-workflows" ? styles.containerWithActionBar : undefined,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {renderBannerStack()}

        <View style={styles.segmentWrap}>
          {([
            ["workflows", "Workflows"],
            ["credentials", "Credentials"],
          ] as Array<[ImproverSection, string]>).map(([value, label]) => (
            <Pressable
              key={value}
              style={[styles.segmentButton, section === value ? styles.segmentButtonActive : undefined]}
              onPress={() => setSection(value)}
            >
              <Text style={[styles.segmentText, section === value ? styles.segmentTextActive : undefined]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {section === "workflows" ? renderWorkflowsContent() : renderCredentialsContent()}
      </ScrollView>

      {workflowEditMode && workflowView === "my-workflows" ? (
        <View style={[styles.bulkActionBar, { paddingBottom: spacing.lg }]}>
          <Text style={styles.bulkActionTitle}>
            {selectedWorkflowGroups.length === 0
              ? "Select workflows"
              : `${selectedWorkflowGroups.length} selected`}
          </Text>
          <View style={styles.segmentWrap}>
            <Pressable
              style={[styles.segmentButton, workflowEditAction === "revoke" ? styles.segmentButtonActive : undefined]}
              onPress={() => setWorkflowEditAction("revoke")}
            >
              <Text style={[styles.segmentText, workflowEditAction === "revoke" ? styles.segmentTextActive : undefined]}>
                Revoke
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, workflowEditAction === "absence" ? styles.segmentButtonActive : undefined]}
              onPress={() => setWorkflowEditAction("absence")}
            >
              <Text style={[styles.segmentText, workflowEditAction === "absence" ? styles.segmentTextActive : undefined]}>
                Absence
              </Text>
            </Pressable>
          </View>

          {workflowEditAction === "absence" ? (
            <View style={styles.stack}>
              <TextInput
                style={styles.input}
                placeholder="Absent from (YYYY-MM-DD)"
                placeholderTextColor={palette.textMuted}
                value={absenceFrom}
                onChangeText={setAbsenceFrom}
              />
              <TextInput
                style={styles.input}
                placeholder="Absent until (YYYY-MM-DD)"
                placeholderTextColor={palette.textMuted}
                value={absenceUntil}
                onChangeText={setAbsenceUntil}
              />
            </View>
          ) : null}

          <Pressable
            style={[
              styles.primaryButton,
              selectedWorkflowGroups.length === 0 || Boolean(actionKey) ? styles.buttonDisabled : undefined,
            ]}
            disabled={selectedWorkflowGroups.length === 0 || Boolean(actionKey)}
            onPress={applyWorkflowEditAction}
          >
            <Text style={styles.primaryButtonText}>
              {actionKey === "bulk-revoke"
                ? "Revoking..."
                : actionKey === "bulk-absence"
                  ? "Saving..."
                  : workflowEditAction === "revoke"
                    ? "Revoke selected workflows"
                    : "Save absence"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={workflowSelectorVisible}
        transparent
        presentationStyle="overFullScreen"
        animationType="none"
        onRequestClose={() => setWorkflowSelectorVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setWorkflowSelectorVisible(false)}>
          <Pressable style={styles.selectorSheetCard} onPress={() => {}}>
            <Text style={styles.sectionTitle}>Workflow view</Text>
            <View style={styles.stack}>
              {workflowSelectorOptions.map((option) => {
                const selected = option.value === workflowView;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.choiceRow, selected ? styles.choiceRowActive : undefined]}
                    onPress={() => {
                      setWorkflowView(option.value);
                      setWorkflowSelectorVisible(false);
                    }}
                  >
                    <Text style={styles.choiceTitle}>{option.label}</Text>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={palette.primaryStrong} /> : null}
                  </Pressable>
                );
              })}
              {unpaidDataLoading && !unpaidDataLoaded ? renderLoadingCard("Checking unpaid workflows...") : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={detailVisible} animationType="slide" onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: topInset + spacing.sm }]}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalTitle}>{selectedWorkflow?.title || "Workflow"}</Text>
              <Text style={styles.modalSubtitle}>
                {selectedWorkflow ? formatWorkflowDisplayStatus(selectedWorkflow) : "Details"}
              </Text>
            </View>
            <Pressable style={styles.iconButton} onPress={() => setDetailVisible(false)}>
              <Ionicons name="close" size={20} color={palette.primaryStrong} />
            </Pressable>
          </View>

          {!selectedWorkflow && detailLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={palette.primary} />
              <Text style={styles.loadingText}>Loading workflow details...</Text>
            </View>
          ) : selectedWorkflow ? (
            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              {detailLoading ? renderLoadingCard("Refreshing workflow details...") : null}

              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.cardHeaderCopy}>
                    <Text style={styles.sectionTitle}>{selectedWorkflow.title}</Text>
                    <Text style={styles.meta}>Status: {formatWorkflowDisplayStatus(selectedWorkflow)}</Text>
                    <Text style={styles.meta}>Start: {formatWorkflowDate(selectedWorkflow.startAt)}</Text>
                    {selectedWorkflow.supervisorRequired ? (
                      <Text style={styles.meta}>
                        Supervisor: {selectedWorkflow.supervisorTitle || selectedWorkflow.supervisorOrganization || "Assigned"}
                      </Text>
                    ) : null}
                  </View>
                  {renderStatusChip(formatWorkflowDisplayStatus(selectedWorkflow), resolveWorkflowTone(selectedWorkflow))}
                </View>

                {selectedWorkflow.description ? <Text style={styles.body}>{selectedWorkflow.description}</Text> : null}

                {selectedWorkflow.roles.length > 0 ? (
                  <View style={styles.stack}>
                    <Text style={styles.stackLabel}>Roles</Text>
                    {selectedWorkflow.roles.map((role) => (
                      <View key={role.id} style={styles.subCard}>
                        <Text style={styles.choiceTitle}>{role.title}</Text>
                        <View style={styles.chipWrap}>
                          {role.requiredCredentials.length === 0 ? (
                            renderStatusChip("No required credentials", "default")
                          ) : (
                            role.requiredCredentials.map((credential) =>
                              renderStatusChip(formatCredentialLabel(credential, labelMap), "default"),
                            )
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.inlineActions}>
                  {selectedWorkflowAssignedStep && selectedWorkflow.recurrence !== "one_time" ? (
                    <Pressable
                      style={[
                        styles.secondaryButton,
                        actionKey === `unclaim:${selectedWorkflow.seriesId}:${selectedWorkflowAssignedStep.stepOrder}`
                          ? styles.buttonDisabled
                          : undefined,
                      ]}
                      disabled={Boolean(actionKey)}
                      onPress={() =>
                        Alert.alert(
                          "Revoke workflow?",
                          "This will release future recurring claims for this workflow to other improvers.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Revoke",
                              style: "destructive",
                              onPress: () => {
                                void revokeWorkflowSeries(selectedWorkflow.seriesId, selectedWorkflowAssignedStep.stepOrder);
                              },
                            },
                          ],
                        )
                      }
                    >
                      <Text style={styles.secondaryButtonText}>
                        {actionKey === `unclaim:${selectedWorkflow.seriesId}:${selectedWorkflowAssignedStep.stepOrder}`
                          ? "Revoking..."
                          : "Revoke workflow"}
                      </Text>
                    </Pressable>
                  ) : null}

                  {selectedWorkflowAbsence && canRevokeSelectedWorkflowAbsence ? (
                    <Pressable
                      style={[
                        styles.secondaryButton,
                        actionKey === `absence-delete:${selectedWorkflowAbsence.id}` ? styles.buttonDisabled : undefined,
                      ]}
                      disabled={Boolean(actionKey)}
                      onPress={() =>
                        Alert.alert(
                          "Revoke absence?",
                          "This will remove the saved absence period for this workflow.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Revoke",
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
                        {actionKey === `absence-delete:${selectedWorkflowAbsence.id}` ? "Revoking..." : "Revoke absence"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {sortedDetailSteps.length > 0 ? (
                <>
                  <View style={styles.stepPagerRow}>
                    <Text style={styles.stepPagerTitle}>
                      Step {currentDetailStepIndex + 1} of {sortedDetailSteps.length}
                    </Text>
                    <View style={styles.inlineActions}>
                      <Pressable
                        style={[styles.compactActionButton, currentDetailStepIndex === 0 ? styles.buttonDisabled : undefined]}
                        disabled={currentDetailStepIndex === 0}
                        onPress={() => setDetailStepIndex((current) => Math.max(0, current - 1))}
                      >
                        <Text style={styles.compactActionButtonText}>Previous</Text>
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
                        <Text style={styles.compactActionButtonText}>Next</Text>
                      </Pressable>
                    </View>
                  </View>

                  {currentDetailStep ? (
                    <View style={styles.card}>
                      <View style={styles.cardHeaderRow}>
                        <View style={styles.cardHeaderCopy}>
                          <Text style={styles.sectionTitle}>
                            Step {currentDetailStep.stepOrder}: {currentDetailStep.title}
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

                      <Text style={styles.meta}>Bounty: {currentDetailStep.bounty} SFLUV</Text>
                      {currentDetailStep.assignedImproverName ? (
                        <Text style={styles.meta}>Assigned: {currentDetailStep.assignedImproverName}</Text>
                      ) : null}
                      {currentDetailStep.payoutError ? <Text style={styles.inlineError}>{currentDetailStep.payoutError}</Text> : null}

                      {currentDetailStep.submission ? (
                        currentDetailStep.submission.stepNotPossible ? (
                          <View style={styles.submissionCard}>
                            <Text style={styles.stackLabel}>Submitted as not possible</Text>
                            <Text style={styles.choiceBody}>
                              {currentDetailStep.submission.stepNotPossibleDetails || "No details provided."}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.submissionCard}>
                            <View style={styles.sectionHeaderRow}>
                              <Text style={styles.stackLabel}>
                                Submitted on {new Date(currentDetailStep.submission.submittedAt * 1000).toLocaleString()}
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
                                  {detailSubmissionExpanded ? "Hide details" : "View details"}
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
                            {actionKey === `retry:${currentDetailStep.id}` ? "Requesting..." : "Retry payout"}
                          </Text>
                        </Pressable>
                      ) : null}

                      {renderStepActions(selectedWorkflow, currentDetailStep)}
                    </View>
                  ) : null}
                </>
              ) : renderEmptyCard("No workflow steps", "No workflow steps were configured.")}
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      <Modal visible={Boolean(cameraTarget)} animationType="slide" onRequestClose={() => setCameraTarget(null)}>
        <View style={[styles.cameraScreen, { paddingTop: topInset + spacing.xl }]}>
          <View style={styles.cameraHeader}>
            <View style={styles.cameraHeaderCopy}>
              <Text style={styles.cameraTitle}>Capture workflow photo</Text>
              <Text style={styles.cameraSubtitle}>{cameraTarget?.title || "Workflow item"}</Text>
            </View>
            <Pressable style={styles.iconButtonInverse} onPress={() => setCameraTarget(null)}>
              <Ionicons name="close" size={20} color={palette.white} />
            </Pressable>
          </View>
          <View style={styles.cameraFrame}>
            <CameraView ref={cameraRef} style={styles.cameraView} facing="back" />
          </View>
          {cameraError ? <Text style={styles.cameraError}>{cameraError}</Text> : null}
          <View style={styles.cameraActions}>
            <Pressable style={styles.cameraCaptureButton} onPress={() => void captureWorkflowPhoto()}>
              <Ionicons name="camera" size={22} color={palette.white} />
              <Text style={styles.cameraCaptureText}>Capture</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={badgesVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeBadges}
        onDismiss={closeBadges}
      >
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: topInset + spacing.sm }]}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalTitle}>My badges</Text>
              <Text style={styles.modalSubtitle}>
                {filteredBadgeItems.length} result{filteredBadgeItems.length === 1 ? "" : "s"}
              </Text>
            </View>
            <Pressable style={styles.iconButton} onPress={closeBadges}>
              <Ionicons name="arrow-back" size={20} color={palette.primaryStrong} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color={palette.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search badges"
                placeholderTextColor={palette.textMuted}
                value={badgeSearch}
                onChangeText={setBadgeSearch}
              />
            </View>
            {filteredBadgeItems.length === 0 ? (
              renderEmptyCard("No badges found", "No badges match your search.")
            ) : (
              <View style={styles.badgeGrid}>
                {filteredBadgeItems.map((badge) => (
                  <Pressable
                    key={badge.credential}
                    style={styles.badgeCard}
                    disabled={!badge.badgeUri}
                    onPress={() => {
                      if (badge.badgeUri) {
                        setBadgePreview({ label: badge.label, imageUri: badge.badgeUri });
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
        </View>
      </Modal>

      <Modal
        visible={Boolean(badgePreview)}
        transparent
        presentationStyle="overFullScreen"
        animationType="none"
        onRequestClose={() => setBadgePreview(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setBadgePreview(null)}>
          <Pressable style={styles.badgePreviewCard} onPress={() => {}}>
            <Text style={styles.sectionTitle}>{badgePreview?.label || "Preview"}</Text>
            {badgePreview?.imageUri ? (
              <Image source={{ uri: badgePreview.imageUri }} style={styles.badgePreviewImage} resizeMode="contain" />
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={() => setBadgePreview(null)}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
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
      paddingTop: spacing.md,
      paddingBottom: 140,
      gap: spacing.md,
    },
    containerWithActionBar: {
      paddingBottom: 240,
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
      fontWeight: "900",
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
      fontWeight: "900",
    },
    workflowTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "900",
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
    segmentWrap: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.lg,
      padding: 6,
      borderWidth: 1,
      borderColor: palette.border,
    },
    segmentButton: {
      flex: 1,
      minWidth: 0,
      borderRadius: radii.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentButtonActive: {
      backgroundColor: palette.primary,
    },
    segmentText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 13,
    },
    segmentTextActive: {
      color: palette.white,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flexShrink: 0,
    },
    selectorButton: {
      flex: 1,
      minWidth: 0,
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
    },
    cameraSubtitle: {
      color: "rgba(255,255,255,0.78)",
      lineHeight: 18,
    },
    cameraFrame: {
      flex: 1,
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: "#000000",
    },
    cameraView: {
      flex: 1,
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
      fontWeight: "900",
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
      bottom: spacing.lg,
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
      fontWeight: "900",
    },
    badgePreviewCard: {
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
    badgePreviewImage: {
      width: "100%",
      height: 320,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
    },
    choiceList: {
      gap: spacing.sm,
    },
  });
}
