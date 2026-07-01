import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Trash2, TriangleAlert } from "lucide-react";
import type {
  AsyncStatus,
  DataLabels,
  ExportFormat,
  StorageApi,
  StorageUsageSnapshot,
} from "../types";

const FALLBACK_SOFT_LIMIT = 900 * 1024 * 1024;
const FALLBACK_HARD_LIMIT = 1024 * 1024 * 1024;

interface DataManagementPanelProps {
  storage: StorageApi;
  labels: DataLabels;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function buildLimitLabel(limit: number, unknownLabel: string): string {
  if (!Number.isFinite(limit) || limit <= 0) return unknownLabel;
  return formatBytes(limit);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function DataManagementPanel({ storage, labels }: DataManagementPanelProps) {
  const [storageUsage, setStorageUsage] = useState<StorageUsageSnapshot | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [dataAction, setDataAction] = useState<string | null>(null);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<AsyncStatus>("idle");

  const isAvailable =
    typeof storage.getStorageUsage === "function" &&
    typeof storage.exportData === "function" &&
    typeof storage.clearAllData === "function";

  const refreshStorageUsage = useCallback(async () => {
    if (!storage.getStorageUsage) return;
    setStorageLoading(true);
    try {
      const usage = await storage.getStorageUsage();
      setStorageUsage(usage);
    } catch (error) {
      setDataStatus("error");
      setDataMessage(getErrorMessage(error));
    } finally {
      setStorageLoading(false);
    }
  }, [storage]);

  useEffect(() => {
    if (!isAvailable) return;
    void refreshStorageUsage();
  }, [isAvailable, refreshStorageUsage]);

  const handleExport = async (format: ExportFormat) => {
    if (!storage.exportData) return;
    setDataAction(`export-${format}`);
    setDataStatus("loading");
    setDataMessage(null);
    try {
      const file = await storage.exportData(format);
      triggerDownload(file.blob, file.filename);
      setDataStatus("ready");
      setDataMessage(labels.exportedFile.replace("{filename}", file.filename));
    } catch (error) {
      setDataStatus("error");
      setDataMessage(getErrorMessage(error));
    } finally {
      setDataAction(null);
      await refreshStorageUsage();
    }
  };

  const handleClearData = async () => {
    if (!storage.clearAllData) return;
    const input = window.prompt(labels.clearPrompt);
    if (input !== "DELETE") {
      setDataStatus("idle");
      setDataMessage(labels.clearCancelled);
      return;
    }

    setDataAction("clear");
    setDataStatus("loading");
    setDataMessage(null);

    try {
      await storage.clearAllData();
      setDataStatus("ready");
      setDataMessage(labels.localDataCleared);
    } catch (error) {
      setDataStatus("error");
      setDataMessage(getErrorMessage(error));
    } finally {
      setDataAction(null);
      await refreshStorageUsage();
    }
  };

  const usage = storageUsage?.originUsed ?? 0;
  const hardLimit = storageUsage?.hardLimit ?? FALLBACK_HARD_LIMIT;
  const softLimit = storageUsage?.softLimit ?? FALLBACK_SOFT_LIMIT;
  const usagePercent = Math.min(100, Math.round((usage / hardLimit) * 100));
  const statusTone = useMemo(() => {
    if (!storageUsage || storageUsage.status === "ok") {
      return {
        bar: "bg-success",
        badge: "bg-success/10 text-success border-success/30",
        label: labels.healthy,
      };
    }
    if (storageUsage.status === "warning") {
      return {
        bar: "bg-warning",
        badge: "bg-warning/10 text-warning border-warning/30",
        label: labels.softLimitWarning,
      };
    }
    return {
      bar: "bg-danger",
      badge: "bg-danger/10 text-danger border-danger/30",
      label: labels.writeBlocked,
    };
  }, [storageUsage, labels]);

  const estimatedIndexedDbUsage = storageUsage
    ? Math.max(storageUsage.originUsed - storageUsage.localUsed, 0)
    : 0;

  if (!isAvailable) {
    return (
      <div className="rounded-md border border-border-subtle bg-bg-surface-hover p-3">
        <p className="text-[13px] font-medium text-text-primary">{labels.unavailableTitle}</p>
        <p className="mt-1 text-[12px] text-text-secondary">
          {labels.unavailableDesc}
        </p>
      </div>
    );
  }

  return (
    <div className="card-shadow-warm rounded-card border border-border-subtle bg-bg-surface p-4">
      <div className="grid gap-3">
        <div className="rounded-md border border-border-subtle bg-bg-surface-hover p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-text-primary">{labels.usedAppLimit}</span>
            <span className="text-[12px] text-text-secondary">
              {formatBytes(usage)} / {buildLimitLabel(hardLimit, labels.unknown)}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border-subtle/70">
            <div
              className={`h-full transition-all duration-200 ${statusTone.bar}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-text-tertiary">
              {labels.browserQuota}: {storageUsage?.originQuota ? formatBytes(storageUsage.originQuota) : labels.unknown}
            </p>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${statusTone.badge}`}
            >
              {statusTone.label}
            </span>
          </div>
          {storageUsage?.status === "warning" && (
            <p className="mt-1 text-[11px] text-warning">
              {labels.storageWarning}
            </p>
          )}
          {storageUsage?.status === "blocked" && (
            <p className="mt-1 text-[11px] text-danger">
              {labels.storageBlocked}
            </p>
          )}
        </div>

        <details className="rounded-md border border-border-subtle bg-bg-surface-hover p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-text-primary">
            {labels.advancedStorageDetails}
          </summary>
          <div className="mt-2 grid gap-1 text-[12px] text-text-secondary">
            <p>{labels.chromeStorageUsed}: {formatBytes(storageUsage?.localUsed ?? 0)}</p>
            <p>{labels.estimatedIndexedDb}: {formatBytes(estimatedIndexedDbUsage)}</p>
            <p>{labels.softLimit}: {buildLimitLabel(softLimit, labels.unknown)}</p>
            <p>
              {labels.unlimitedStorage}: {storageUsage?.unlimitedStorageEnabled ? labels.enabled : labels.disabled}
            </p>
          </div>
        </details>

        <div className="rounded-md border border-border-subtle bg-bg-surface-hover p-3">
          <p className="mb-2 text-[13px] font-medium text-text-primary">{labels.exportLocalData}</p>
          <div className="flex flex-wrap gap-2">
            {(["json", "txt", "md"] as const).map((format) => (
              <button
                key={format}
                type="button"
                disabled={dataAction !== null}
                onClick={() => handleExport(format)}
                className="inline-flex items-center gap-1 rounded-md border border-border-default bg-transparent px-3 py-1.5 text-[12px] font-medium text-text-primary transition-colors duration-200 hover:bg-bg-surface disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                {labels.exportFormat.replace("{format}", format.toUpperCase())}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">
            {labels.exportHint}
          </p>
        </div>

        <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-danger">
            <TriangleAlert className="h-4 w-4" strokeWidth={1.75} />
            {labels.dangerZone}
          </div>
          <p className="text-[11px] leading-[1.45] text-text-secondary">
            {labels.dangerDesc}
          </p>
          <button
            type="button"
            disabled={dataAction !== null}
            onClick={handleClearData}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-danger/40 bg-transparent px-3 py-1.5 text-[12px] font-medium text-danger transition-colors duration-200 hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            {labels.clearLocalData}
          </button>
        </div>

        {(storageLoading || dataAction) && (
          <div className="flex items-center gap-1 text-[12px] text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {dataAction ? labels.runningDataAction : labels.refreshingStorage}
          </div>
        )}

        {dataMessage && !storageLoading && (
          <p className={`text-[12px] ${dataStatus === "error" ? "text-danger" : "text-text-secondary"}`}>
            {dataMessage}
          </p>
        )}
      </div>
    </div>
  );
}
