import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
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
  AppWorkflow,
  AppWorkflowPhotoAspectRatio,
  AppWorkflowStep,
  AppWorkflowStepCompletionInput,
  VerifiedEmail,
} from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  user: AppUser | null;
  improver: AppImprover | null;
  backendClient?: AppBackendClient | null;
  primaryWalletAddress?: string;
  onRefreshProfile: () => Promise<void>;
};

type ImproverSection =
  | "my-workflows"
  | "workflow-board"
  | "unpaid-workflows"
  | "my-badges"
  | "credentials"
  | "absence";

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

const MAX_MOBILE_WORKFLOW_PHOTO_BYTES = 2 * 1024 * 1024;

function shortAddress(address?: string | null): string {
  if (!address) {
    return "Not set";
  }
  if (address.length <= 16) {
    return address;
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
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
  primaryWalletAddress,
  onRefreshProfile,
}: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const [section, setSection] = useState<ImproverSection>("my-workflows");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [workflows, setWorkflows] = useState<AppWorkflow[]>([]);
  const [unpaidWorkflows, setUnpaidWorkflows] = useState<AppWorkflow[]>([]);
  const [activeCredentials, setActiveCredentials] = useState<AppCredentialType[]>([]);
  const [credentialTypes, setCredentialTypes] = useState<AppGlobalCredentialType[]>([]);
  const [credentialRequests, setCredentialRequests] = useState<AppCredentialRequest[]>([]);
  const [absencePeriods, setAbsencePeriods] = useState<AppImproverAbsencePeriod[]>([]);
  const [verifiedEmails, setVerifiedEmails] = useState<VerifiedEmail[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<AppWorkflow | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState("");
  const [boardSearch, setBoardSearch] = useState("");
  const [myWorkflowsSearch, setMyWorkflowsSearch] = useState("");
  const [unpaidSearch, setUnpaidSearch] = useState("");
  const [absenceSearch, setAbsenceSearch] = useState("");
  const [credentialSearch, setCredentialSearch] = useState("");
  const [showFinishedSeries, setShowFinishedSeries] = useState(false);
  const [requestFirstName, setRequestFirstName] = useState("");
  const [requestLastName, setRequestLastName] = useState("");
  const [requestEmailInput, setRequestEmailInput] = useState("");
  const [selectedVerifiedEmailId, setSelectedVerifiedEmailId] = useState<string | null>(null);
  const [selectedCredentialType, setSelectedCredentialType] = useState<string | null>(null);
  const [rewardsWalletDraft, setRewardsWalletDraft] = useState(
    improver?.primaryRewardsAccount || primaryWalletAddress || "",
  );
  const [absenceTargetMode, setAbsenceTargetMode] = useState<"single" | "all">("single");
  const [absenceSelection, setAbsenceSelection] = useState<string | null>(null);
  const [absenceFrom, setAbsenceFrom] = useState("");
  const [absenceUntil, setAbsenceUntil] = useState("");
  const [editingAbsenceId, setEditingAbsenceId] = useState<string | null>(null);
  const [editAbsenceFrom, setEditAbsenceFrom] = useState("");
  const [editAbsenceUntil, setEditAbsenceUntil] = useState("");
  const [completionForms, setCompletionForms] = useState<Record<string, Record<string, CompletionItemForm>>>({});
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [stepNotPossibleForms, setStepNotPossibleForms] = useState<Record<string, StepNotPossibleForm>>({});
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [badgePreview, setBadgePreview] = useState<{ label: string; imageUri: string } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const canUsePanel = Boolean(user?.isImprover || user?.isAdmin);
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
    setRewardsWalletDraft(improver?.primaryRewardsAccount || primaryWalletAddress || "");
  }, [improver?.primaryRewardsAccount, primaryWalletAddress]);

  const requestableCredentialTypes = useMemo(
    () =>
      credentialTypes.filter((credentialType) => {
        if (credentialSet.has(credentialType.value)) {
          return false;
        }
        return credentialType.visibility === "public";
      }),
    [credentialSet, credentialTypes],
  );

  useEffect(() => {
    if (!selectedCredentialType) {
      setSelectedCredentialType(requestableCredentialTypes[0]?.value ?? null);
      return;
    }
    if (!requestableCredentialTypes.some((credentialType) => credentialType.value === selectedCredentialType)) {
      setSelectedCredentialType(requestableCredentialTypes[0]?.value ?? null);
    }
  }, [requestableCredentialTypes, selectedCredentialType]);

  const filteredCredentialTypes = useMemo(() => {
    const normalizedSearch = credentialSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return requestableCredentialTypes;
    }
    return requestableCredentialTypes.filter((credentialType) =>
      credentialType.label.toLowerCase().includes(normalizedSearch),
    );
  }, [credentialSearch, requestableCredentialTypes]);

  const myBadgeItems = useMemo(() => {
    const typeByValue = new Map<string, AppGlobalCredentialType>();
    for (const credentialType of credentialTypes) {
      typeByValue.set(credentialType.value, credentialType);
    }
    return activeCredentials
      .map((credential) => {
        const credentialType = typeByValue.get(credential);
        return {
          credential,
          label: formatCredentialLabel(credential, labelMap),
          badgeUri: buildCredentialBadgeUri(credentialType),
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [activeCredentials, credentialTypes, labelMap]);

  const recurringClaimOptions = useMemo<RecurringClaimOption[]>(() => {
    if (!user?.id) {
      return [];
    }
    const optionMap = new Map<string, RecurringClaimOption>();
    for (const workflow of workflows) {
      if (workflow.recurrence === "one_time") {
        continue;
      }
      for (const step of workflow.steps) {
        if (step.assignedImproverId !== user.id || step.status === "paid_out") {
          continue;
        }
        const key = `${workflow.seriesId}:${step.stepOrder}`;
        const current = optionMap.get(key);
        if (!current) {
          optionMap.set(key, {
            key,
            seriesId: workflow.seriesId,
            stepOrder: step.stepOrder,
            workflowTitle: workflow.title,
            stepTitle: step.title,
            recurrence: workflow.recurrence,
            claimedCount: 1,
          });
          continue;
        }
        optionMap.set(key, {
          ...current,
          claimedCount: current.claimedCount + 1,
        });
      }
    }
    return Array.from(optionMap.values()).sort((left, right) => {
      if (left.seriesId === right.seriesId) {
        return left.stepOrder - right.stepOrder;
      }
      return left.seriesId.localeCompare(right.seriesId);
    });
  }, [user?.id, workflows]);

  useEffect(() => {
    if (!absenceSelection) {
      setAbsenceSelection(recurringClaimOptions[0]?.key ?? null);
      return;
    }
    if (!recurringClaimOptions.some((option) => option.key === absenceSelection)) {
      setAbsenceSelection(recurringClaimOptions[0]?.key ?? null);
    }
  }, [absenceSelection, recurringClaimOptions]);

  const hasClaimedRoleInWorkflow = (workflow: AppWorkflow) =>
    workflow.steps.some((step) => step.assignedImproverId === user?.id);

  const isWorkflowActiveForUser = (workflow: AppWorkflow) =>
    workflow.steps.some(
      (step) =>
        step.assignedImproverId === user?.id &&
        (step.status === "available" || step.status === "in_progress"),
    );

  const isStepCoveredByAbsence = (workflow: AppWorkflow, step: AppWorkflowStep) =>
    workflow.recurrence !== "one_time" &&
    absencePeriods.some(
      (period) =>
        period.seriesId === workflow.seriesId &&
        period.stepOrder === step.stepOrder &&
        workflow.startAt >= period.absentFrom &&
        workflow.startAt < period.absentUntil,
    );

  const canClaimStep = (workflow: AppWorkflow, step: AppWorkflowStep) => {
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
  };

  const workflowBoardWorkflows = useMemo(() => {
    return workflows.filter((workflow) => {
      if (hasClaimedRoleInWorkflow(workflow)) {
        return false;
      }
      return workflow.steps.some((step) => canClaimStep(workflow, step));
    });
  }, [workflows, absencePeriods, user?.id, credentialSet]);

  const myClaimedWorkflows = useMemo(
    () => workflows.filter((workflow) => hasClaimedRoleInWorkflow(workflow)),
    [workflows, user?.id],
  );

  const myWorkflowSeriesGroups = useMemo<WorkflowSeriesGroup[]>(() => {
    if (!user?.id) {
      return [];
    }
    const groupMap = new Map<string, WorkflowSeriesGroup>();
    for (const workflow of myClaimedWorkflows) {
      const assignedStep = workflow.steps
        .filter((step) => step.assignedImproverId === user.id)
        .sort((left, right) => left.stepOrder - right.stepOrder)[0];
      const existing = groupMap.get(workflow.seriesId);
      if (!existing) {
        groupMap.set(workflow.seriesId, {
          key: workflow.seriesId,
          seriesId: workflow.seriesId,
          primaryStepOrder: assignedStep?.stepOrder ?? null,
          primaryStepTitle: assignedStep?.title ?? null,
          workflows: [workflow],
        });
        continue;
      }
      groupMap.set(workflow.seriesId, {
        ...existing,
        workflows: [...existing.workflows, workflow].sort(
          (left, right) => right.startAt - left.startAt,
        ),
      });
    }
    return Array.from(groupMap.values()).sort((left, right) => {
      const leftActive = left.workflows.some((workflow) => isWorkflowActiveForUser(workflow));
      const rightActive = right.workflows.some((workflow) => isWorkflowActiveForUser(workflow));
      if (leftActive !== rightActive) {
        return leftActive ? -1 : 1;
      }
      return (right.workflows[0]?.startAt || 0) - (left.workflows[0]?.startAt || 0);
    });
  }, [isWorkflowActiveForUser, myClaimedWorkflows, user?.id]);

  const filteredBoardWorkflows = useMemo(() => {
    const normalizedSearch = boardSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return workflowBoardWorkflows;
    }
    return workflowBoardWorkflows.filter((workflow) =>
      workflow.title.toLowerCase().includes(normalizedSearch),
    );
  }, [boardSearch, workflowBoardWorkflows]);

  const filteredSeriesGroups = useMemo(() => {
    const normalizedSearch = myWorkflowsSearch.trim().toLowerCase();
    const filtered = myWorkflowSeriesGroups.filter((group) => {
      if (showFinishedSeries) {
        return true;
      }
      return group.workflows.some(
        (workflow) =>
          workflow.recurrence !== "one_time" ||
          (workflow.status !== "completed" && workflow.status !== "paid_out"),
      );
    });
    if (!normalizedSearch) {
      return filtered;
    }
    return filtered.filter((group) =>
      group.workflows.some((workflow) => workflow.title.toLowerCase().includes(normalizedSearch)),
    );
  }, [myWorkflowSeriesGroups, myWorkflowsSearch, showFinishedSeries]);

  const filteredUnpaidWorkflows = useMemo(() => {
    const normalizedSearch = unpaidSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return unpaidWorkflows;
    }
    return unpaidWorkflows.filter((workflow) =>
      workflow.title.toLowerCase().includes(normalizedSearch),
    );
  }, [unpaidSearch, unpaidWorkflows]);

  const filteredAbsencePeriods = useMemo(() => {
    const normalizedSearch = absenceSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return absencePeriods;
    }
    return absencePeriods.filter((period) =>
      period.seriesId.toLowerCase().includes(normalizedSearch),
    );
  }, [absencePeriods, absenceSearch]);

  const verifiedEmailsByStatus = useMemo(() => {
    return {
      verified: verifiedEmails.filter((email) => email.status === "verified"),
      pending: verifiedEmails.filter((email) => email.status !== "verified"),
    };
  }, [verifiedEmails]);

  useEffect(() => {
    if (!selectedVerifiedEmailId && verifiedEmailsByStatus.verified[0]) {
      setSelectedVerifiedEmailId(verifiedEmailsByStatus.verified[0].id);
    }
  }, [selectedVerifiedEmailId, verifiedEmailsByStatus.verified]);

  const loadImproverPanelData = async () => {
    if (!backendClient) {
      return;
    }
    setLoading(true);
    try {
      const [workflowFeed, unpaid, loadedCredentialTypes, loadedCredentialRequests, loadedAbsencePeriods] =
        await Promise.all([
          backendClient.getImproverWorkflows(),
          backendClient.getImproverUnpaidWorkflows(),
          backendClient.getCredentialTypes(),
          backendClient.getImproverCredentialRequests(),
          backendClient.getImproverAbsencePeriods(),
        ]);
      setWorkflows(workflowFeed.workflows);
      setActiveCredentials(workflowFeed.activeCredentials);
      setUnpaidWorkflows(unpaid);
      setCredentialTypes(loadedCredentialTypes);
      setCredentialRequests(loadedCredentialRequests);
      setAbsencePeriods(loadedAbsencePeriods);
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to load the improver panel.");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  const loadImproverRequestData = async () => {
    if (!backendClient) {
      return;
    }
    setLoading(true);
    try {
      const [emails, loadedCredentialTypes] = await Promise.all([
        backendClient.getVerifiedEmails(),
        backendClient.getCredentialTypes(),
      ]);
      setVerifiedEmails(emails);
      setCredentialTypes(loadedCredentialTypes);
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to load improver request details.");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    if (!backendClient) {
      setInitialLoading(false);
      return;
    }
    if (canUsePanel) {
      void loadImproverPanelData();
      return;
    }
    void loadImproverRequestData();
  }, [backendClient, canUsePanel]);

  const refreshAllData = async () => {
    if (canUsePanel) {
      await loadImproverPanelData();
      return;
    }
    await loadImproverRequestData();
  };

  const setItemForm = (stepId: string, itemId: string, patch: Partial<CompletionItemForm>) => {
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
      const itemForm = stepForms[itemId] || emptyItemForm();
      return {
        ...current,
        [stepId]: {
          ...stepForms,
          [itemId]: {
            ...itemForm,
            ...patch,
          },
        },
      };
    });
  };

  const setStepNotPossibleForm = (stepId: string, patch: Partial<StepNotPossibleForm>) => {
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
  };

  const mergeWorkflow = (updatedWorkflow: AppWorkflow) => {
    setWorkflows((current) =>
      current.map((workflow) => (workflow.id === updatedWorkflow.id ? updatedWorkflow : workflow)),
    );
    setUnpaidWorkflows((current) =>
      current.map((workflow) => (workflow.id === updatedWorkflow.id ? updatedWorkflow : workflow)),
    );
    setSelectedWorkflow((current) => (current?.id === updatedWorkflow.id ? updatedWorkflow : current));
  };

  const openWorkflowDetail = async (workflow: AppWorkflow) => {
    setSelectedWorkflow(workflow);
    setDetailVisible(true);
    if (!backendClient) {
      return;
    }
    setDetailLoading(true);
    try {
      const refreshed = await backendClient.getWorkflow(workflow.id);
      setSelectedWorkflow(refreshed);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to load workflow details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshSelectedWorkflow = async (workflowId: string) => {
    if (!backendClient) {
      return;
    }
    try {
      const refreshed = await backendClient.getWorkflow(workflowId);
      mergeWorkflow(refreshed);
    } catch {
      // Keep current in-memory workflow state if detail refresh fails.
    }
  };

  const claimWorkflowStep = async (workflowId: string, stepId: string) => {
    if (!backendClient) {
      return;
    }
    setActionKey(`claim:${stepId}`);
    try {
      const updatedWorkflow = await backendClient.claimWorkflowStep(workflowId, stepId);
      mergeWorkflow(updatedWorkflow);
      setNotice("Workflow step claimed.");
      setError(null);
      await refreshAllData();
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to claim this workflow step.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const startWorkflowStep = async (workflowId: string, stepId: string) => {
    if (!backendClient) {
      return;
    }
    setActionKey(`start:${stepId}`);
    try {
      const updatedWorkflow = await backendClient.startWorkflowStep(workflowId, stepId);
      mergeWorkflow(updatedWorkflow);
      setNotice("Workflow step started.");
      setError(null);
      await refreshAllData();
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to start this workflow step.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const removeCompletionPhoto = (stepId: string, itemId: string, photoId: string) => {
    const currentPhotos = completionForms[stepId]?.[itemId]?.photos || [];
    setItemForm(stepId, itemId, {
      photos: currentPhotos.filter((photo) => photo.id !== photoId),
    });
  };

  const openCameraCapture = async (
    stepId: string,
    itemId: string,
    title: string,
    aspectRatio: AppWorkflowPhotoAspectRatio,
    maxCount: number | null,
  ) => {
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
  };

  const captureWorkflowPhoto = async () => {
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
      const sizeBytes = estimateBase64Bytes(base64);
      if (sizeBytes > MAX_MOBILE_WORKFLOW_PHOTO_BYTES) {
        throw new Error("That photo is too large. Try again with a simpler shot.");
      }
      const contentType = "image/jpeg";
      const previewUri = `data:${contentType};base64,${base64}`;
      const photo: CompletionPhoto = {
        id: `photo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        fileName: `${slugifyFileName(cameraTarget.title)}_${Date.now()}.jpg`,
        contentType,
        dataBase64: base64,
        previewUri,
        sizeBytes,
      };
      const currentPhotos = completionForms[cameraTarget.stepId]?.[cameraTarget.itemId]?.photos || [];
      let nextPhotos = [...currentPhotos, photo];
      if (typeof cameraTarget.maxCount === "number" && cameraTarget.maxCount > 0) {
        nextPhotos = nextPhotos.slice(-cameraTarget.maxCount);
      }
      setItemForm(cameraTarget.stepId, cameraTarget.itemId, {
        photos: nextPhotos,
      });
      setCameraTarget(null);
    } catch (nextError) {
      setCameraError((nextError as Error)?.message || "Unable to capture a workflow photo.");
    }
  };

  const buildCompletionPayload = (workflow: AppWorkflow, step: AppWorkflowStep): AppWorkflowStepCompletionInput => {
    const notPossibleForm = stepNotPossibleForms[step.id] || emptyStepNotPossibleForm();
    if (step.allowStepNotPossible && notPossibleForm.selected) {
      const details = notPossibleForm.details.trim();
      if (!details) {
        throw new Error("Explain why this step is not possible.");
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
      const requiresWritten =
        item.requiresWrittenResponse ||
        (dropdownValue ? Boolean(item.dropdownRequiresWrittenResponse[dropdownValue]) : false);
      const requiresPhoto = item.requiresPhoto || Boolean(selectedOption?.requiresPhotoAttachment);
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
            throw new Error(
              `Add exactly ${requiredCount} photo${requiredCount === 1 ? "" : "s"} for ${item.title}.`,
            );
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
  };

  const completeWorkflowStep = async (workflow: AppWorkflow, step: AppWorkflowStep) => {
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
      setNotice(
        (stepNotPossibleForms[step.id] || emptyStepNotPossibleForm()).selected
          ? "Step marked not possible."
          : "Workflow step completed.",
      );
      setError(null);
      setCameraTarget(null);
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
      await refreshAllData();
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
  };

  const requestPayoutRetry = async (workflowId: string, stepId: string) => {
    if (!backendClient) {
      return;
    }
    setActionKey(`retry:${stepId}`);
    try {
      const updatedWorkflow = await backendClient.requestWorkflowStepPayoutRetry(workflowId, stepId);
      mergeWorkflow(updatedWorkflow);
      setNotice("Payout retry requested.");
      setError(null);
      await refreshAllData();
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to request payout retry.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const requestWorkflowPayoutRetries = async (workflow: AppWorkflow) => {
    const failedSteps = workflow.steps.filter(
      (step) =>
        step.assignedImproverId === user?.id &&
        step.status === "completed" &&
        step.bounty > 0 &&
        Boolean(step.payoutError?.trim()),
    );
    if (failedSteps.length === 0 || !backendClient) {
      return;
    }
    setActionKey(`retry-workflow:${workflow.id}`);
    try {
      for (const step of failedSteps) {
        await backendClient.requestWorkflowStepPayoutRetry(workflow.id, step.id);
      }
      setNotice(
        failedSteps.length === 1 ? "Payout retry requested." : `${failedSteps.length} payout retries requested.`,
      );
      setError(null);
      await refreshAllData();
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to request payout retries.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const requestCredential = async (credentialType: string) => {
    if (!backendClient) {
      return;
    }
    setActionKey(`credential:${credentialType}`);
    try {
      await backendClient.createImproverCredentialRequest(credentialType);
      setNotice(`Requested ${formatCredentialLabel(credentialType, labelMap)}.`);
      setError(null);
      await refreshAllData();
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to request that credential.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const requestImproverAccess = async () => {
    if (!backendClient) {
      return;
    }
    const selectedEmail = verifiedEmailsByStatus.verified.find((email) => email.id === selectedVerifiedEmailId)?.email;
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
      await refreshAllData();
      setNotice("Improver status requested.");
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to request improver status.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const requestEmailVerification = async () => {
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
      const emails = await backendClient.getVerifiedEmails();
      setVerifiedEmails(emails);
      setRequestEmailInput("");
      setNotice("Verification email sent.");
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to send a verification email.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const resendEmailVerification = async (emailId: string) => {
    if (!backendClient) {
      return;
    }
    setActionKey(`resend-email:${emailId}`);
    try {
      await backendClient.resendVerifiedEmail(emailId);
      const emails = await backendClient.getVerifiedEmails();
      setVerifiedEmails(emails);
      setNotice("Verification email resent.");
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to resend verification.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const updateRewardsWallet = async () => {
    if (!backendClient) {
      return;
    }
    if (!rewardsWalletDraft.trim()) {
      setError("Enter a rewards wallet address.");
      setNotice(null);
      return;
    }
    setActionKey("update-rewards-wallet");
    try {
      await backendClient.updateImproverPrimaryRewardsAccount(rewardsWalletDraft.trim());
      await onRefreshProfile();
      await refreshAllData();
      setNotice("Improver rewards wallet updated.");
      setError(null);
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to update the rewards wallet.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const parseAbsenceSelection = (value: string | null) => {
    if (!value) {
      return null;
    }
    const separator = value.lastIndexOf(":");
    if (separator <= 0) {
      return null;
    }
    const seriesId = value.slice(0, separator);
    const stepOrder = Number.parseInt(value.slice(separator + 1), 10);
    if (!seriesId || Number.isNaN(stepOrder) || stepOrder <= 0) {
      return null;
    }
    return { seriesId, stepOrder };
  };

  const saveAbsencePeriod = async () => {
    if (!backendClient) {
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
    setActionKey("absence-create");
    try {
      let summaries: AppImproverAbsencePeriodCreateResult[] = [];
      if (absenceTargetMode === "all") {
        for (const option of recurringClaimOptions) {
          summaries.push(
            await backendClient.createImproverAbsencePeriod({
              seriesId: option.seriesId,
              stepOrder: option.stepOrder,
              absentFrom: absenceFrom,
              absentUntil: absenceUntil,
            }),
          );
        }
      } else {
        const target = parseAbsenceSelection(absenceSelection);
        if (!target) {
          throw new Error("Choose a recurring workflow series step.");
        }
        summaries = [
          await backendClient.createImproverAbsencePeriod({
            seriesId: target.seriesId,
            stepOrder: target.stepOrder,
            absentFrom: absenceFrom,
            absentUntil: absenceUntil,
          }),
        ];
      }
      const released = summaries.reduce((sum, entry) => sum + entry.releasedCount, 0);
      const skipped = summaries.reduce((sum, entry) => sum + entry.skippedCount, 0);
      setNotice(
        skipped > 0
          ? `Absence saved. Released ${released} assignments and skipped ${skipped} active ones.`
          : `Absence saved. Released ${released} assignments.`,
      );
      setError(null);
      setAbsenceFrom("");
      setAbsenceUntil("");
      await refreshAllData();
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to save absence coverage.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const saveEditedAbsence = async () => {
    if (!backendClient || !editingAbsenceId) {
      return;
    }
    if (!isValidDateInput(editAbsenceFrom) || !isValidDateInput(editAbsenceUntil)) {
      setError("Enter absence dates in YYYY-MM-DD format.");
      setNotice(null);
      return;
    }
    if (editAbsenceFrom > editAbsenceUntil) {
      setError("Absent end date must be on or after the start date.");
      setNotice(null);
      return;
    }
    setActionKey(`absence-update:${editingAbsenceId}`);
    try {
      const result = await backendClient.updateImproverAbsencePeriod(editingAbsenceId, {
        absentFrom: editAbsenceFrom,
        absentUntil: editAbsenceUntil,
      });
      setNotice(
        result.skippedCount > 0
          ? `Absence updated. Released ${result.releasedCount} assignments and skipped ${result.skippedCount} active ones.`
          : `Absence updated. Released ${result.releasedCount} assignments.`,
      );
      setError(null);
      setEditingAbsenceId(null);
      await refreshAllData();
    } catch (nextError) {
      setError((nextError as Error)?.message || "Unable to update absence coverage.");
      setNotice(null);
    } finally {
      setActionKey("");
    }
  };

  const deleteAbsence = (absenceId: string) => {
    if (!backendClient) {
      return;
    }
    Alert.alert("Delete absence coverage?", "This will reopen those recurring claims to other improvers.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setActionKey(`absence-delete:${absenceId}`);
            try {
              await backendClient.deleteImproverAbsencePeriod(absenceId);
              setNotice("Absence coverage deleted.");
              setError(null);
              setEditingAbsenceId(null);
              await refreshAllData();
            } catch (nextError) {
              setError((nextError as Error)?.message || "Unable to delete absence coverage.");
              setNotice(null);
            } finally {
              setActionKey("");
            }
          })();
        },
      },
    ]);
  };

  const unclaimSeries = (seriesId: string, stepOrder: number) => {
    if (!backendClient) {
      return;
    }
    Alert.alert(
      "Unclaim this series?",
      "Future claimable assignments for this recurring series step will be released to other improvers.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unclaim",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setActionKey(`unclaim:${seriesId}:${stepOrder}`);
              try {
                const result = await backendClient.unclaimImproverWorkflowSeries(seriesId, stepOrder);
                setNotice(
                  result.skippedCount > 0
                    ? `Series unclaimed. Released ${result.releasedCount} claims and skipped ${result.skippedCount} active assignments.`
                    : `Series unclaimed. Released ${result.releasedCount} claims.`,
                );
                setError(null);
                setDetailVisible(false);
                setSelectedWorkflow(null);
                await refreshAllData();
              } catch (nextError) {
                setError((nextError as Error)?.message || "Unable to unclaim this workflow series.");
                setNotice(null);
              } finally {
                setActionKey("");
              }
            })();
          },
        },
      ],
    );
  };

  const selectedWorkflowSeriesStep = useMemo(() => {
    if (!selectedWorkflow || !user?.id) {
      return null;
    }
    const assignedStep = selectedWorkflow.steps
      .filter((step) => step.assignedImproverId === user.id)
      .sort((left, right) => left.stepOrder - right.stepOrder)[0];
    if (!assignedStep) {
      return null;
    }
    return {
      seriesId: selectedWorkflow.seriesId,
      stepOrder: assignedStep.stepOrder,
      title: assignedStep.title,
    };
  }, [selectedWorkflow, user?.id]);

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

  const renderRequestAccess = () => {
    const statusTone =
      improver?.status === "approved"
        ? "success"
        : improver?.status === "rejected"
          ? "danger"
          : "warning";

    return (
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.title}>Improver Access</Text>
          <Text style={styles.subtitle}>
            Request improver status here, then come back once your role has been approved.
          </Text>
        </View>

        {improver ? (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.sectionTitle}>Current Request</Text>
              {renderStatusChip(formatStatusLabel(improver.status), statusTone)}
            </View>
            <Text style={styles.body}>
              {improver.status === "approved"
                ? "This account is already enabled for improver access."
                : improver.status === "rejected"
                  ? "This improver request was rejected. You can update your information and try again."
                  : "Your improver request is pending review."}
            </Text>
            <Text style={styles.meta}>Name: {`${improver.firstName} ${improver.lastName}`.trim()}</Text>
            <Text style={styles.meta}>Email: {improver.email}</Text>
            <Text style={styles.meta}>Requested: {new Date(improver.createdAt).toLocaleString()}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Verified Email</Text>
          <Text style={styles.body}>
            Improver requests require a verified email address.
          </Text>
          {verifiedEmailsByStatus.verified.length > 0 ? (
            verifiedEmailsByStatus.verified.map((email) => {
              const selected = selectedVerifiedEmailId === email.id;
              return (
                <Pressable
                  key={email.id}
                  style={[
                    styles.choiceRow,
                    selected ? styles.choiceRowActive : undefined,
                  ]}
                  onPress={() => setSelectedVerifiedEmailId(email.id)}
                >
                  <View style={styles.choiceCopy}>
                    <Text style={styles.choiceTitle}>{email.email}</Text>
                    <Text style={styles.choiceBody}>Verified {email.verifiedAt ? new Date(email.verifiedAt).toLocaleString() : "recently"}</Text>
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={20} color={palette.primaryStrong} /> : null}
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.meta}>No verified emails yet.</Text>
          )}

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
              <Text style={styles.stackLabel}>Pending emails</Text>
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
          <Text style={styles.sectionTitle}>Request Improver Status</Text>
          <Text style={styles.body}>
            Tell us who you are so the improver admin team can review this account.
          </Text>
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

  const renderWorkflowCard = (
    workflow: AppWorkflow,
    extra?: React.ReactNode,
  ) => {
    const displayStatus = formatWorkflowDisplayStatus(workflow);
    const tone =
      workflow.status === "completed" || workflow.status === "paid_out"
        ? "success"
        : workflow.status === "failed" || workflow.status === "rejected"
          ? "danger"
          : workflow.status === "blocked" || displayStatus === "Upcoming"
            ? "warning"
            : "default";
    return (
      <Pressable style={styles.card} onPress={() => void openWorkflowDetail(workflow)}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.sectionTitle}>{workflow.title}</Text>
            <Text style={styles.body}>{workflow.description}</Text>
          </View>
          {renderStatusChip(displayStatus || "Workflow", tone)}
        </View>
        <View style={styles.metadataWrap}>
          <Text style={styles.meta}>Start: {formatWorkflowDate(workflow.startAt)}</Text>
          <Text style={styles.meta}>Series: {workflow.seriesId}</Text>
        </View>
        {extra}
        <View style={styles.inlineActions}>
          <Pressable style={styles.secondaryButton} onPress={() => void openWorkflowDetail(workflow)}>
            <Text style={styles.secondaryButtonText}>View details</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  const renderWorkflowBoard = () => (
    <View style={styles.sectionStack}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search workflows"
          placeholderTextColor={palette.textMuted}
          value={boardSearch}
          onChangeText={setBoardSearch}
        />
      </View>
      {filteredBoardWorkflows.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>No Eligible Workflows</Text>
          <Text style={styles.body}>Nothing is claimable for your credentials right now.</Text>
        </View>
      ) : (
        filteredBoardWorkflows.map((workflow) => {
          const claimableStep = workflow.steps.find((step) => canClaimStep(workflow, step));
          return renderWorkflowCard(
            workflow,
            claimableStep ? (
              <View style={styles.inlineActions}>
                <Pressable
                  style={[
                    styles.primaryButton,
                    actionKey === `claim:${claimableStep.id}` ? styles.buttonDisabled : undefined,
                  ]}
                  disabled={Boolean(actionKey)}
                  onPress={() => {
                    void claimWorkflowStep(workflow.id, claimableStep.id);
                  }}
                >
                  <Text style={styles.primaryButtonText}>
                    {actionKey === `claim:${claimableStep.id}` ? "Claiming..." : `Claim Step ${claimableStep.stepOrder}`}
                  </Text>
                </Pressable>
              </View>
            ) : null,
          );
        })
      )}
    </View>
  );

  const renderMyWorkflows = () => (
    <View style={styles.sectionStack}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search your workflows"
          placeholderTextColor={palette.textMuted}
          value={myWorkflowsSearch}
          onChangeText={setMyWorkflowsSearch}
        />
      </View>
      <Pressable
        style={styles.choiceRow}
        onPress={() => setShowFinishedSeries((current) => !current)}
      >
        <View style={styles.choiceCopy}>
          <Text style={styles.choiceTitle}>Show finished series</Text>
          <Text style={styles.choiceBody}>Toggle whether completed one-time work stays visible here.</Text>
        </View>
        <Ionicons
          name={showFinishedSeries ? "checkmark-circle" : "ellipse-outline"}
          size={20}
          color={showFinishedSeries ? palette.primaryStrong : palette.textMuted}
        />
      </Pressable>
      {filteredSeriesGroups.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>No Claimed Workflows</Text>
          <Text style={styles.body}>Claimed workflows will show up here.</Text>
        </View>
      ) : (
        filteredSeriesGroups.map((group) => {
          const focusWorkflow =
            group.workflows.find((workflow) => isWorkflowActiveForUser(workflow)) || group.workflows[0];
          return renderWorkflowCard(
            focusWorkflow,
            <View style={styles.stack}>
              {group.primaryStepOrder != null && group.primaryStepTitle ? (
                <Text style={styles.meta}>
                  Assigned step {group.primaryStepOrder}: {group.primaryStepTitle}
                </Text>
              ) : null}
              <Text style={styles.meta}>
                {group.workflows.length} workflow{group.workflows.length === 1 ? "" : "s"} in this series
              </Text>
              {focusWorkflow.recurrence !== "one_time" && group.primaryStepOrder != null ? (
                <View style={styles.inlineActions}>
                  <Pressable
                    style={[
                      styles.secondaryButton,
                      actionKey === `unclaim:${group.seriesId}:${group.primaryStepOrder}` ? styles.buttonDisabled : undefined,
                    ]}
                    disabled={Boolean(actionKey)}
                    onPress={() => unclaimSeries(group.seriesId, group.primaryStepOrder as number)}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {actionKey === `unclaim:${group.seriesId}:${group.primaryStepOrder}`
                        ? "Unclaiming..."
                        : "Unclaim series"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>,
          );
        })
      )}
    </View>
  );

  const renderUnpaidWorkflows = () => (
    <View style={styles.sectionStack}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search unpaid workflows"
          placeholderTextColor={palette.textMuted}
          value={unpaidSearch}
          onChangeText={setUnpaidSearch}
        />
      </View>
      {filteredUnpaidWorkflows.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>No Unpaid Workflows</Text>
          <Text style={styles.body}>Completed payouts waiting on settlement will show up here.</Text>
        </View>
      ) : (
        filteredUnpaidWorkflows.map((workflow) => {
          const unpaidSteps = workflow.steps.filter(
            (step) => step.assignedImproverId === user?.id && step.status === "completed" && step.bounty > 0,
          );
          const failedSteps = unpaidSteps.filter((step) => Boolean(step.payoutError?.trim()));
          if (unpaidSteps.length === 0) {
            return null;
          }
          return renderWorkflowCard(
            workflow,
            <View style={styles.stack}>
              <Text style={styles.meta}>Pending payouts: {unpaidSteps.length}</Text>
              <Text style={styles.meta}>Needs attention: {failedSteps.length}</Text>
              {failedSteps.length > 0 ? (
                <Pressable
                  style={[
                    styles.primaryButton,
                    actionKey === `retry-workflow:${workflow.id}` ? styles.buttonDisabled : undefined,
                  ]}
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
              {unpaidSteps.map((step) => (
                <View key={step.id} style={[styles.subCard, step.payoutError ? styles.subCardDanger : undefined]}>
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.cardHeaderCopy}>
                      <Text style={styles.choiceTitle}>
                        Step {step.stepOrder}: {step.title}
                      </Text>
                      <Text style={styles.choiceBody}>Bounty: {step.bounty} SFLUV</Text>
                    </View>
                    {renderStatusChip(step.payoutError ? "Payout Error" : "Pending", step.payoutError ? "danger" : "warning")}
                  </View>
                  <Text style={styles.choiceBody}>
                    {step.payoutError
                      ? step.payoutError
                      : "Payout is waiting for earlier series work to finish and settle."}
                  </Text>
                  {step.payoutError ? (
                    <Pressable
                      style={[
                        styles.secondaryButton,
                        actionKey === `retry:${step.id}` ? styles.buttonDisabled : undefined,
                      ]}
                      disabled={Boolean(actionKey)}
                      onPress={() => {
                        void requestPayoutRetry(workflow.id, step.id);
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {actionKey === `retry:${step.id}` ? "Requesting..." : "Retry payout"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>,
          );
        })
      )}
    </View>
  );

  const renderBadges = () => (
    <View style={styles.sectionStack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>My Badges</Text>
        <Text style={styles.body}>
          Credential badges tied to your active improver credentials.
        </Text>
        {myBadgeItems.length === 0 ? (
          <Text style={styles.meta}>No active credential badges yet.</Text>
        ) : (
          <View style={styles.badgeGrid}>
            {myBadgeItems.map((badge) => (
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
      </View>
    </View>
  );

  const renderCredentials = () => (
    <View style={styles.sectionStack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Active Credentials</Text>
        <Text style={styles.body}>These credential types currently unlock workflow claims for you.</Text>
        {activeCredentials.length === 0 ? (
          <Text style={styles.meta}>No active credentials yet.</Text>
        ) : (
          <View style={styles.chipWrap}>
            {activeCredentials.map((credential) =>
              renderStatusChip(formatCredentialLabel(credential, labelMap), "default"),
            )}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Request Credentials</Text>
        <Text style={styles.body}>Ask for additional credentials for future workflow claims.</Text>
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
        {filteredCredentialTypes.length === 0 ? (
          <Text style={styles.meta}>No additional public credentials are available to request.</Text>
        ) : (
          filteredCredentialTypes.map((credentialType) => (
            <View key={credentialType.value} style={styles.choiceRow}>
              <View style={styles.choiceCopy}>
                <Text style={styles.choiceTitle}>{credentialType.label}</Text>
                <Text style={styles.choiceBody}>
                  {pendingCredentialSet.has(credentialType.value)
                    ? "Request already pending."
                    : "Available to request."}
                </Text>
              </View>
              <Pressable
                style={[
                  styles.secondaryButton,
                  pendingCredentialSet.has(credentialType.value) || Boolean(actionKey)
                    ? styles.buttonDisabled
                    : undefined,
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
          ))
        )}

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
        ) : null}
      </View>
    </View>
  );

  const renderAbsenceCoverage = () => (
    <View style={styles.sectionStack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recurring Absence Coverage</Text>
        <Text style={styles.body}>
          Release recurring claims while you are away so other qualified improvers can cover them.
        </Text>
        {recurringClaimOptions.length === 0 ? (
          <Text style={styles.meta}>Claim a recurring workflow step first to configure absence coverage.</Text>
        ) : (
          <>
            <View style={styles.segmentWrap}>
              <Pressable
                style={[styles.segmentButton, absenceTargetMode === "single" ? styles.segmentButtonActive : undefined]}
                onPress={() => setAbsenceTargetMode("single")}
              >
                <Text style={[styles.segmentText, absenceTargetMode === "single" ? styles.segmentTextActive : undefined]}>
                  One Step
                </Text>
              </Pressable>
              <Pressable
                style={[styles.segmentButton, absenceTargetMode === "all" ? styles.segmentButtonActive : undefined]}
                onPress={() => setAbsenceTargetMode("all")}
              >
                <Text style={[styles.segmentText, absenceTargetMode === "all" ? styles.segmentTextActive : undefined]}>
                  All Series
                </Text>
              </Pressable>
            </View>
            {absenceTargetMode === "single" ? (
              <View style={styles.stack}>
                {recurringClaimOptions.map((option) => {
                  const selected = option.key === absenceSelection;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.choiceRow, selected ? styles.choiceRowActive : undefined]}
                      onPress={() => setAbsenceSelection(option.key)}
                    >
                      <View style={styles.choiceCopy}>
                        <Text style={styles.choiceTitle}>
                          {option.workflowTitle} • Step {option.stepOrder}
                        </Text>
                        <Text style={styles.choiceBody}>
                          {option.stepTitle} • {formatStatusLabel(option.recurrence)}
                        </Text>
                      </View>
                      {selected ? <Ionicons name="checkmark-circle" size={20} color={palette.primaryStrong} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
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
            <Pressable
              style={[styles.primaryButton, actionKey === "absence-create" ? styles.buttonDisabled : undefined]}
              disabled={actionKey === "absence-create"}
              onPress={() => {
                void saveAbsencePeriod();
              }}
            >
              <Text style={styles.primaryButtonText}>
                {actionKey === "absence-create" ? "Saving..." : "Save absence coverage"}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Current Absence Periods</Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Filter by series id"
            placeholderTextColor={palette.textMuted}
            value={absenceSearch}
            onChangeText={setAbsenceSearch}
          />
        </View>
        {filteredAbsencePeriods.length === 0 ? (
          <Text style={styles.meta}>No absence coverage saved yet.</Text>
        ) : (
          filteredAbsencePeriods.map((period) => (
            <View key={period.id} style={styles.subCard}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderCopy}>
                  <Text style={styles.choiceTitle}>Step {period.stepOrder}</Text>
                  <Text style={styles.choiceBody}>Series: {period.seriesId}</Text>
                </View>
                {renderStatusChip(
                  period.absentUntil * 1000 < Date.now() ? "Ended" : "Scheduled",
                  period.absentUntil * 1000 < Date.now() ? "default" : "warning",
                )}
              </View>
              {editingAbsenceId === period.id ? (
                <View style={styles.stack}>
                  <TextInput
                    style={styles.input}
                    placeholder="Absent from (YYYY-MM-DD)"
                    placeholderTextColor={palette.textMuted}
                    value={editAbsenceFrom}
                    onChangeText={setEditAbsenceFrom}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Absent until (YYYY-MM-DD)"
                    placeholderTextColor={palette.textMuted}
                    value={editAbsenceUntil}
                    onChangeText={setEditAbsenceUntil}
                  />
                  <View style={styles.inlineActions}>
                    <Pressable
                      style={[styles.primaryButton, actionKey === `absence-update:${period.id}` ? styles.buttonDisabled : undefined]}
                      disabled={actionKey === `absence-update:${period.id}`}
                      onPress={() => {
                        void saveEditedAbsence();
                      }}
                    >
                      <Text style={styles.primaryButtonText}>
                        {actionKey === `absence-update:${period.id}` ? "Saving..." : "Save"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => setEditingAbsenceId(null)}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.stack}>
                  <Text style={styles.choiceBody}>From: {formatDateFromUnix(period.absentFrom)}</Text>
                  <Text style={styles.choiceBody}>Until: {formatDateFromUnix(period.absentUntil, true)}</Text>
                  <View style={styles.inlineActions}>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => {
                        setEditingAbsenceId(period.id);
                        setEditAbsenceFrom(toDateInputValueFromUnix(period.absentFrom));
                        setEditAbsenceUntil(toDateInputValueFromUnix(period.absentUntil, true));
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={styles.deleteButton}
                      onPress={() => deleteAbsence(period.id)}
                    >
                      <Text style={styles.deleteButtonText}>
                        {actionKey === `absence-delete:${period.id}` ? "Deleting..." : "Delete"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ))
        )}
      </View>
    </View>
  );

  const renderPanelContent = () => {
    switch (section) {
      case "workflow-board":
        return renderWorkflowBoard();
      case "unpaid-workflows":
        return renderUnpaidWorkflows();
      case "my-badges":
        return renderBadges();
      case "credentials":
        return renderCredentials();
      case "absence":
        return renderAbsenceCoverage();
      case "my-workflows":
      default:
        return renderMyWorkflows();
    }
  };

  const renderSubmittedResponses = (step: AppWorkflowStep) => {
    if (!step.submission) {
      return null;
    }
    return (
      <View style={styles.submissionCard}>
        <Text style={styles.stackLabel}>Submitted</Text>
        {step.submission.stepNotPossible ? (
          <Text style={styles.choiceBody}>
            Step marked not possible: {step.submission.stepNotPossibleDetails || "No details provided."}
          </Text>
        ) : (
          step.submission.itemResponses.map((response) => (
            <View key={response.itemId} style={styles.submissionRow}>
              <Text style={styles.choiceTitle}>Item {response.itemId}</Text>
              {response.dropdownValue ? (
                <Text style={styles.choiceBody}>Choice: {response.dropdownValue}</Text>
              ) : null}
              {response.writtenResponse ? (
                <Text style={styles.choiceBody}>{response.writtenResponse}</Text>
              ) : null}
              {(response.photos?.length || response.photoIds?.length) ? (
                <Text style={styles.choiceBody}>
                  Photos: {response.photos?.length || response.photoIds?.length}
                </Text>
              ) : null}
            </View>
          ))
        )}
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
              {actionKey === `claim:${step.id}` ? "Claiming..." : `Claim Step ${step.stepOrder}`}
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
                onPress={() =>
                  setStepNotPossibleForm(step.id, {
                    selected: !notPossibleForm.selected,
                  })
                }
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
              step.workItems.map((item) => {
                const form = completionForms[step.id]?.[item.id] || emptyItemForm();
                const selectedOption = form.dropdown
                  ? item.dropdownOptions.find((option) => option.value === form.dropdown)
                  : undefined;
                const requiresPhoto = item.requiresPhoto || Boolean(selectedOption?.requiresPhotoAttachment);
                const requiresWritten =
                  item.requiresWrittenResponse ||
                  (form.dropdown ? Boolean(item.dropdownRequiresWrittenResponse[form.dropdown]) : false);
                const photoLimit = item.requiresPhoto
                  ? item.photoAllowAnyCount
                    ? null
                    : Math.max(1, item.photoRequiredCount || 1)
                  : 1;
                return (
                  <View key={item.id} style={styles.subCard}>
                    <Text style={styles.choiceTitle}>{item.title}</Text>
                    <Text style={styles.choiceBody}>{item.description}</Text>
                    {item.requiresDropdown ? (
                      <View style={styles.choiceList}>
                        {item.dropdownOptions.map((option) => {
                          const selected = option.value === form.dropdown;
                          return (
                            <Pressable
                              key={option.value}
                              style={[styles.choiceRow, selected ? styles.choiceRowActive : undefined]}
                              onPress={() =>
                                setItemForm(step.id, item.id, {
                                  dropdown: option.value,
                                })
                              }
                            >
                              <View style={styles.choiceCopy}>
                                <Text style={styles.choiceTitle}>{option.label}</Text>
                              </View>
                              {selected ? (
                                <Ionicons name="checkmark-circle" size={20} color={palette.primaryStrong} />
                              ) : null}
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
                        onChangeText={(value) =>
                          setItemForm(step.id, item.id, {
                            written: value,
                          })
                        }
                      />
                    ) : null}
                    {requiresPhoto ? (
                      <View style={styles.stack}>
                        <Text style={styles.choiceBody}>
                          {photoLimit
                            ? `Capture ${photoLimit} photo${photoLimit === 1 ? "" : "s"} for this item.`
                            : "Capture one or more photos for this item."}
                        </Text>
                        {selectedOption?.photoInstructions ? (
                          <Text style={styles.choiceBody}>{selectedOption.photoInstructions}</Text>
                        ) : null}
                        <View style={styles.photoGrid}>
                          {form.photos.map((photo) => (
                            <View key={photo.id} style={styles.photoCard}>
                              <Image source={{ uri: photo.previewUri }} style={styles.photoPreview} resizeMode="cover" />
                              <Text style={styles.photoLabel}>{photo.fileName}</Text>
                              <Pressable
                                style={styles.photoRemoveButton}
                                onPress={() => removeCompletionPhoto(step.id, item.id, photo.id)}
                              >
                                <Text style={styles.photoRemoveText}>Remove</Text>
                              </Pressable>
                            </View>
                          ))}
                        </View>
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
                            {form.photos.length > 0 ? "Capture another photo" : "Open camera"}
                          </Text>
                        </Pressable>
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

  if (initialLoading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={palette.primary} />
        <Text style={styles.loadingText}>Loading improver tools...</Text>
      </View>
    );
  }

  if (!canUsePanel) {
    return renderRequestAccess();
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.title}>Improver</Text>
          <Text style={styles.subtitle}>
            Claim workflow steps, complete assigned work, track payouts, and manage credentials.
          </Text>
        </View>

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

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Improver Profile</Text>
          <Text style={styles.meta}>Status: {formatStatusLabel(improver?.status || "approved")}</Text>
          <Text style={styles.meta}>Rewards wallet: {shortAddress(improver?.primaryRewardsAccount)}</Text>
          <Text style={styles.meta}>Primary app wallet: {shortAddress(primaryWalletAddress)}</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Improver rewards wallet"
            placeholderTextColor={palette.textMuted}
            value={rewardsWalletDraft}
            onChangeText={setRewardsWalletDraft}
          />
          <View style={styles.inlineActions}>
            <Pressable
              style={[styles.primaryButton, actionKey === "update-rewards-wallet" ? styles.buttonDisabled : undefined]}
              disabled={actionKey === "update-rewards-wallet"}
              onPress={() => {
                void updateRewardsWallet();
              }}
            >
              <Text style={styles.primaryButtonText}>
                {actionKey === "update-rewards-wallet" ? "Saving..." : "Save rewards wallet"}
              </Text>
            </Pressable>
            {primaryWalletAddress ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setRewardsWalletDraft(primaryWalletAddress)}
              >
                <Text style={styles.secondaryButtonText}>Use primary wallet</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.segmentWrap}>
          {(
            [
              ["my-workflows", "Mine"],
              ["workflow-board", "Board"],
              ["unpaid-workflows", "Unpaid"],
              ["my-badges", "Badges"],
              ["credentials", "Credentials"],
              ["absence", "Absence"],
            ] as Array<[ImproverSection, string]>
          ).map(([value, label]) => (
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

        {loading ? (
          <View style={styles.loadingInlineCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={styles.loadingInlineText}>Refreshing improver data...</Text>
          </View>
        ) : null}

        {renderPanelContent()}
      </ScrollView>

      <Modal visible={detailVisible} animationType="slide" onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
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

          {detailLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={palette.primary} />
              <Text style={styles.loadingText}>Loading workflow details...</Text>
            </View>
          ) : selectedWorkflow ? (
            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{selectedWorkflow.title}</Text>
                <Text style={styles.body}>{selectedWorkflow.description}</Text>
                <Text style={styles.meta}>Start: {formatWorkflowDate(selectedWorkflow.startAt)}</Text>
                <Text style={styles.meta}>Series: {selectedWorkflow.seriesId}</Text>
                {selectedWorkflowSeriesStep && selectedWorkflow.recurrence !== "one_time" ? (
                  <Pressable
                    style={[
                      styles.secondaryButton,
                      actionKey === `unclaim:${selectedWorkflowSeriesStep.seriesId}:${selectedWorkflowSeriesStep.stepOrder}`
                        ? styles.buttonDisabled
                        : undefined,
                    ]}
                    disabled={Boolean(actionKey)}
                    onPress={() =>
                      unclaimSeries(
                        selectedWorkflowSeriesStep.seriesId,
                        selectedWorkflowSeriesStep.stepOrder,
                      )
                    }
                  >
                    <Text style={styles.secondaryButtonText}>
                      {actionKey === `unclaim:${selectedWorkflowSeriesStep.seriesId}:${selectedWorkflowSeriesStep.stepOrder}`
                        ? "Unclaiming..."
                        : "Unclaim series"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {selectedWorkflow.steps
                .slice()
                .sort((left, right) => left.stepOrder - right.stepOrder)
                .map((step) => (
                  <View key={step.id} style={styles.card}>
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.cardHeaderCopy}>
                        <Text style={styles.sectionTitle}>
                          Step {step.stepOrder}: {step.title}
                        </Text>
                        <Text style={styles.body}>{step.description}</Text>
                      </View>
                      {renderStatusChip(
                        formatStatusLabel(step.status),
                        step.status === "paid_out"
                          ? "success"
                          : step.status === "completed"
                            ? "warning"
                            : "default",
                      )}
                    </View>
                    <Text style={styles.meta}>Bounty: {step.bounty} SFLUV</Text>
                    {step.assignedImproverName ? (
                      <Text style={styles.meta}>Assigned: {step.assignedImproverName}</Text>
                    ) : null}
                    {step.payoutError ? <Text style={styles.inlineError}>{step.payoutError}</Text> : null}
                    {step.workItems.length > 0 ? (
                      <View style={styles.stack}>
                        <Text style={styles.stackLabel}>Work items</Text>
                        {step.workItems.map((item) => (
                          <View key={item.id} style={styles.submissionRow}>
                            <Text style={styles.choiceTitle}>{item.title}</Text>
                            <Text style={styles.choiceBody}>{item.description}</Text>
                            <Text style={styles.choiceBody}>
                              {[
                                item.requiresDropdown ? "Dropdown" : null,
                                item.requiresWrittenResponse ? "Written response" : null,
                                item.requiresPhoto ? "Photo" : null,
                                item.optional ? "Optional" : "Required",
                              ]
                                .filter(Boolean)
                                .join(" • ")}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {renderSubmittedResponses(step)}
                    {step.status === "completed" &&
                    step.assignedImproverId === user?.id &&
                    step.bounty > 0 &&
                    step.payoutError ? (
                      <Pressable
                        style={[
                          styles.secondaryButton,
                          actionKey === `retry:${step.id}` ? styles.buttonDisabled : undefined,
                        ]}
                        disabled={Boolean(actionKey)}
                        onPress={() => {
                          void requestPayoutRetry(selectedWorkflow.id, step.id);
                        }}
                      >
                        <Text style={styles.secondaryButtonText}>
                          {actionKey === `retry:${step.id}` ? "Requesting..." : "Retry payout"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {renderStepActions(selectedWorkflow, step)}
                  </View>
                ))}
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      <Modal visible={Boolean(cameraTarget)} animationType="slide" onRequestClose={() => setCameraTarget(null)}>
        <View style={styles.cameraScreen}>
          <View style={styles.cameraHeader}>
            <View>
              <Text style={styles.cameraTitle}>Capture Workflow Photo</Text>
              <Text style={styles.cameraSubtitle}>{cameraTarget?.title || "Workflow item"}</Text>
            </View>
            <Pressable style={styles.iconButton} onPress={() => setCameraTarget(null)}>
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

      <Modal visible={Boolean(badgePreview)} transparent animationType="fade" onRequestClose={() => setBadgePreview(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setBadgePreview(null)}>
          <Pressable style={styles.badgePreviewCard} onPress={() => {}}>
            <Text style={styles.sectionTitle}>{badgePreview?.label || "Badge"}</Text>
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
      letterSpacing: -0.4,
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
    sectionStack: {
      gap: spacing.md,
    },
    cardHeaderRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    cardHeaderCopy: {
      flex: 1,
      gap: 4,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "900",
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
      flexWrap: "wrap",
      gap: spacing.sm,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.lg,
      padding: 6,
      borderWidth: 1,
      borderColor: palette.border,
    },
    segmentButton: {
      minWidth: 88,
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
      alignItems: "center",
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
      gap: 4,
    },
    choiceTitle: {
      color: palette.text,
      fontWeight: "800",
      lineHeight: 18,
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
      width: "47%",
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
      width: "47%",
      gap: spacing.xs,
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
      letterSpacing: -0.3,
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
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
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
