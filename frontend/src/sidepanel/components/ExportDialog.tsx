import { useState, useMemo } from "react";
import { X, Download, Copy, FileText, FileJson, FileCode, Loader2, Check } from "lucide-react";
import { useI18n } from "~lib/i18n";
import type { Conversation } from "~lib/types";
import type {
  ConversationExportConfig,
  ConversationExportContentMode,
  ConversationExportFormat,
  ConversationExportResult,
} from "../types/export";

interface ExportDialogProps {
  open: boolean;
  conversations: Conversation[];
  onClose: () => void;
  onExport: (config: ConversationExportConfig) => Promise<ConversationExportResult>;
}

export function ExportDialog({ open, conversations, onClose, onExport }: ExportDialogProps) {
  const { t } = useI18n();
  const x = t.exportDialog;
  const [contentMode, setContentMode] = useState<ConversationExportContentMode>("full");
  const [format, setFormat] = useState<ConversationExportFormat>("md");
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const estimatedTokens = useMemo(() => {
    const base = conversations.length * 500;
    return {
      full: base,
      compact: Math.round(base * 0.15),
      summary: conversations.length * 50,
    }[contentMode];
  }, [conversations.length, contentMode]);

  if (!open) return null;

  const handleExport = async (action: "download" | "copy") => {
    setIsExporting(true);
    try {
      const result = await onExport({
        conversationIds: conversations.map((c) => c.id),
        contentMode,
        format,
      });

      if (action === "download") {
        const blob = new Blob([result.content], { type: result.mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = result.filename;
        link.click();
        URL.revokeObjectURL(url);
        onClose();
      } else {
        await navigator.clipboard.writeText(result.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[340px] rounded-xl border border-border-subtle bg-bg-primary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-text-primary">
              {(conversations.length > 1 ? x.titlePlural : x.title).replace(
                "{count}",
                String(conversations.length)
              )}
            </h3>
            <p className="text-xs text-text-tertiary">
              {x.tokens.replace("{count}", estimatedTokens.toLocaleString())}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={x.close}
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          {/* Content Mode */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.11em] text-text-secondary">
              {x.content}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "full", label: x.modeFull, desc: x.modeFullDesc },
                { key: "compact", label: x.modeCompact, desc: x.modeCompactDesc },
                { key: "summary", label: x.modeSummary, desc: x.modeSummaryDesc },
              ].map(({ key, label, desc }) => (
                <button
                  key={key}
                  onClick={() => setContentMode(key as ConversationExportContentMode)}
                  className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2.5 text-center transition-all ${
                    contentMode === key
                      ? "border-accent-primary bg-accent-primary/10"
                      : "border-border-subtle bg-bg-secondary hover:bg-bg-tertiary"
                  }`}
                >
                  <span
                    className={`text-xs font-medium ${
                      contentMode === key ? "text-accent-primary" : "text-text-primary"
                    }`}
                  >
                    {label}
                  </span>
                  <span className="mt-0.5 text-[10px] text-text-tertiary">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.11em] text-text-secondary">
              {x.format}
            </label>
            <div className="flex gap-2">
              {[
                { key: "md", label: x.formatMd, icon: FileCode },
                { key: "txt", label: x.formatTxt, icon: FileText },
                { key: "json", label: x.formatJson, icon: FileJson },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setFormat(key as ConversationExportFormat)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                    format === key
                      ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                      : "border-border-subtle bg-bg-secondary text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-border-subtle p-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleExport("download")}
              disabled={isExporting}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border-subtle bg-bg-secondary text-xs font-medium text-text-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {x.download}
            </button>
            <button
              onClick={() => handleExport("copy")}
              disabled={isExporting}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-white transition-all ${
                copied ? "bg-success" : "bg-accent-primary hover:bg-accent-primary/90"
              } disabled:opacity-50`}
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : copied ? (
                <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {copied ? x.copied : x.copy}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
