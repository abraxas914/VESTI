import { Check, Copy } from "lucide-react";
import katex from "katex";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "~lib/i18n";
import type { AstNode, AstRoot, AstTableNode } from "~lib/types/ast";
import { astNodeToPlainText } from "~lib/utils/astText";
import "katex/dist/katex.min.css";
import {
  buildAstNodeKey,
  buildHighlightSegments,
  formatAstPathSegment,
  sanitizeRootForRender,
  type OccurrenceIndexMap,
} from "../lib/readerSearch";

const COPY_FEEDBACK_MS = 1400;
const LANGUAGE_TOKEN_PATTERN = /^[a-z0-9+#.-]{1,24}$/i;
const LANGUAGE_NOISE_TOKENS = new Set(["copy", "copied", "code", "plain", "plaintext", "text"]);
const BLOCKQUOTE_ATTRIBUTION_PATTERN = /^\s*[-]\s*\S+/;

interface AstMessageRendererProps {
  root: AstRoot;
  messageId: number;
  occurrenceIndexMap?: OccurrenceIndexMap | null;
  currentIndex?: number | null;
}

interface MathNodeViewProps {
  tex: string;
  display: boolean;
}

interface CodeBlockViewProps {
  code: string;
  language?: string | null;
}

interface TableNodeViewProps {
  node: AstTableNode;
  path: string[];
  context: RenderContext;
}

interface NodeEntry {
  node: AstNode;
  index: number;
}

interface RenderContext {
  messageId: number;
  occurrenceIndexMap: OccurrenceIndexMap;
  currentIndex: number | null;
}

function MathNodeView({ tex, display }: MathNodeViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display,
      });
    } catch {
      return "";
    }
  }, [display, tex]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(tex).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  const copyButton = (
    <button
      type="button"
      className={`reader-ast-math-copy ${display ? "is-block" : "is-inline"}`}
      onClick={handleCopy}
      aria-label={t.reader.copyTeX}
    >
      {copied ? <Check className="h-3 w-3" strokeWidth={1.75} /> : <Copy className="h-3 w-3" strokeWidth={1.75} />}
      {copied ? t.reader.copied : t.reader.copyTeX}
    </button>
  );

  if (!html) {
    if (display) {
      return (
        <div className="reader-ast-math-shell reader-ast-math-shell-block">
          {copyButton}
          <span className="reader-ast-math-fallback">{tex}</span>
        </div>
      );
    }

    return (
      <span className="reader-ast-math-shell reader-ast-math-shell-inline">
        <span className="reader-ast-math-fallback">{tex}</span>
        {copyButton}
      </span>
    );
  }

  const className = display ? "reader-ast-math-block" : "reader-ast-math-inline";
  const formulaNode = (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );

  if (display) {
    return (
      <div className="reader-ast-math-shell reader-ast-math-shell-block">
        {copyButton}
        {formulaNode}
      </div>
    );
  }

  return (
    <span className="reader-ast-math-shell reader-ast-math-shell-inline">
      {formulaNode}
      {copyButton}
    </span>
  );
}

function CodeBlockView({ code, language }: CodeBlockViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  return (
    <div className="reader-ast-code-block">
      <div className="reader-ast-code-head">
        <span className="reader-ast-code-lang">{language || t.reader.plain}</span>
        <button
          type="button"
          className="reader-ast-code-copy"
          onClick={handleCopy}
          aria-label={t.reader.copyCode}
        >
          {copied ? <Check className="h-3 w-3" strokeWidth={1.75} /> : <Copy className="h-3 w-3" strokeWidth={1.75} />}
          {copied ? t.reader.copied : t.reader.copy}
        </button>
      </div>
      <pre className="reader-ast-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TableNodeView({ node, path, context }: TableNodeViewProps) {
  if (node.kind === "v2") {
    const normalizedHeaders =
      node.columns.length > 0
        ? node.columns
        : [{ header: [{ type: "text", text: "Column 1" }], align: null }];

    return (
      <div className="reader-ast-table-wrap">
        <table className="reader-ast-table">
          <thead>
            <tr>
              {normalizedHeaders.map((column, columnIndex) => (
                <th
                  key={`header-${columnIndex}`}
                  style={column.align ? { textAlign: column.align } : undefined}
                >
                  {renderNodes(
                    toEntries(column.header),
                    `table-header-${columnIndex}`,
                    [...path, `column[${columnIndex}]`, "header"],
                    context,
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.cells.map((cell, cellIndex) => {
                  const align = cell.align ?? normalizedHeaders[cellIndex]?.align ?? null;
                  return (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      style={align ? { textAlign: align } : undefined}
                    >
                      {renderNodes(
                        toEntries(cell.children),
                        `table-cell-${rowIndex}-${cellIndex}`,
                        [...path, `row[${rowIndex}]`, `cell[${cellIndex}]`],
                        context,
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const headers = node.headers;
  const rows = node.rows;
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 1);
  const normalizedHeaders =
    headers.length > 0
      ? headers
      : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
  const normalizedRows = rows.map((row) =>
    Array.from({ length: normalizedHeaders.length }, (_, index) => row[index] ?? "")
  );

  return (
    <div className="reader-ast-table-wrap">
      <table className="reader-ast-table">
        <thead>
          <tr>
            {normalizedHeaders.map((header, index) => (
              <th key={`header-${index}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {normalizedRows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toEntries(nodes: AstNode[], offset: number = 0): NodeEntry[] {
  return nodes.map((node, index) => ({ node, index: index + offset }));
}

function renderHighlightedText(
  text: string,
  nodeKey: string,
  context: RenderContext,
  keyPrefix: string
): ReactNode {
  const segments = buildHighlightSegments(text, context.occurrenceIndexMap[nodeKey]);
  if (segments.length === 1 && segments[0].occurrenceIndex === null) {
    return segments[0].text;
  }
  return segments.map((segment, index) => {
    if (segment.occurrenceIndex === null) {
      return <span key={`${keyPrefix}-tx-${index}`}>{segment.text}</span>;
    }
    const isActive = segment.occurrenceIndex === context.currentIndex;
    const className = isActive
      ? "rounded-xs bg-accent-primary px-0.5 text-text-inverse ring-1 ring-border-focus"
      : "rounded-xs bg-accent-primary-light px-0.5 text-text-primary ring-1 ring-border-focus";
    return (
      <mark
        key={`${keyPrefix}-hl-${index}`}
        data-occurrence-index={segment.occurrenceIndex}
        className={className}
      >
        {segment.text}
      </mark>
    );
  });
}

function renderNodes(
  entries: NodeEntry[],
  keyPrefix: string,
  path: string[],
  context: RenderContext
): ReactNode[] {
  return entries.map(({ node, index }) =>
    renderNode(
      node,
      `${keyPrefix}-${index}`,
      [...path, formatAstPathSegment(node, index)],
      context
    )
  );
}

function normalizeLanguageToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const prefixed = normalized.match(/^(?:language|lang)[:_\-\s]*([a-z0-9+#.-]{1,24})$/i);
  const token = (prefixed?.[1] ?? normalized).toLowerCase();
  if (!LANGUAGE_TOKEN_PATTERN.test(token) || LANGUAGE_NOISE_TOKENS.has(token)) {
    return null;
  }
  return token;
}

function extractLanguageLeakToken(node: AstNode): string | null {
  if (node.type === "text") {
    return normalizeLanguageToken(node.text);
  }
  if (node.type !== "p") {
    return null;
  }
  const text = astNodeToPlainText(node).trim();
  return normalizeLanguageToken(text);
}

function toParagraphNode(key: string, text: string): ReactNode {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  return <p key={key}>{normalized}</p>;
}

function renderUnsupportedAsParagraphs(node: AstNode, key: string): ReactNode {
  if (node.type === "attachment") {
    return toParagraphNode(key, astNodeToPlainText(node));
  }

  return null;
}

function isInlineBlockquoteAttributionNode(node: AstNode): boolean {
  switch (node.type) {
    case "text":
    case "code_inline":
    case "br":
      return true;
    case "strong":
    case "em":
      return node.children.every(isInlineBlockquoteAttributionNode);
    case "fragment":
      return node.children.every(isInlineBlockquoteAttributionNode);
    default:
      return false;
  }
}

function isBlockquoteAttributionText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return BLOCKQUOTE_ATTRIBUTION_PATTERN.test(normalized);
}

function splitBlockquoteChildrenForCitation(children: AstNode[]): {
  bodyEntries: NodeEntry[];
  citationEntries: NodeEntry[] | null;
} {
  if (children.length === 0) {
    return { bodyEntries: [], citationEntries: null };
  }

  const lastIndex = children.length - 1;
  const lastNode = children[lastIndex];
  if (lastNode?.type === "p") {
    const paragraphText = astNodeToPlainText(lastNode);
    if (isBlockquoteAttributionText(paragraphText)) {
      return {
        bodyEntries: toEntries(children.slice(0, lastIndex), 0),
        citationEntries: toEntries([lastNode], lastIndex),
      };
    }
  }

  let inlineStart = children.length;
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (!isInlineBlockquoteAttributionNode(children[index])) {
      break;
    }
    inlineStart = index;
  }

  if (inlineStart < children.length) {
    const inlineTail = children.slice(inlineStart);
    const tailText = inlineTail.map(astNodeToPlainText).join(" ");
    if (isBlockquoteAttributionText(tailText)) {
      return {
        bodyEntries: toEntries(children.slice(0, inlineStart), 0),
        citationEntries: toEntries(inlineTail, inlineStart),
      };
    }
  }

  return {
    bodyEntries: toEntries(children, 0),
    citationEntries: null,
  };
}

function renderNode(
  node: AstNode,
  key: string,
  path: string[],
  context: RenderContext
): ReactNode {
  switch (node.type) {
    case "text": {
      const nodeKey = buildAstNodeKey(context.messageId, path);
      return (
        <Fragment key={key}>
          {renderHighlightedText(node.text, nodeKey, context, key)}
        </Fragment>
      );
    }
    case "fragment":
      return (
        <Fragment key={key}>
          {renderNodes(toEntries(node.children), key, path, context)}
        </Fragment>
      );
    case "br":
      return <br key={key} />;
    case "p":
      return (
        <p key={key}>
          {renderNodes(toEntries(node.children), key, path, context)}
        </p>
      );
    case "h1":
    case "h2":
    case "h3": {
      const HeadingTag = node.type;
      return (
        <HeadingTag key={key}>
          {renderNodes(toEntries(node.children), key, path, context)}
        </HeadingTag>
      );
    }
    case "strong":
      return (
        <strong key={key}>
          {renderNodes(toEntries(node.children), key, path, context)}
        </strong>
      );
    case "em":
      return (
        <em key={key}>
          {renderNodes(toEntries(node.children), key, path, context)}
        </em>
      );
    case "code_inline": {
      const nodeKey = buildAstNodeKey(context.messageId, path);
      return (
        <code key={key} className="reader-ast-inline-code">
          {renderHighlightedText(node.text, nodeKey, context, key)}
        </code>
      );
    }
    case "code_block":
      return (
        <CodeBlockView
          key={key}
          code={node.code}
          language={node.language ?? null}
        />
      );
    case "math":
      return (
        <MathNodeView
          key={key}
          tex={node.tex}
          display={Boolean(node.display)}
        />
      );
    case "table":
      return (
        <TableNodeView
          key={key}
          node={node}
          path={path}
          context={context}
        />
      );
    case "ul":
      return (
        <ul key={key} className="reader-ast-list reader-ast-list-ul">
          {renderNodes(toEntries(node.children), key, path, context)}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="reader-ast-list reader-ast-list-ol">
          {renderNodes(toEntries(node.children), key, path, context)}
        </ol>
      );
    case "li":
      return (
        <li key={key} className="reader-ast-list-item">
          {renderNodes(toEntries(node.children), key, path, context)}
        </li>
      );
    case "blockquote": {
      const { bodyEntries, citationEntries } = splitBlockquoteChildrenForCitation(
        node.children
      );
      return (
        <blockquote key={key} className="reader-ast-blockquote">
          {renderNodes(bodyEntries, `${key}-body`, path, context)}
          {citationEntries ? (
            <cite className="reader-ast-blockquote-cite">
              {renderNodes(citationEntries, `${key}-cite`, path, context)}
            </cite>
          ) : null}
        </blockquote>
      );
    }
    case "attachment":
      return renderUnsupportedAsParagraphs(node, key);
    default: {
      const exhaustiveGuard: never = node;
      return exhaustiveGuard;
    }
  }
}

export function AstMessageRenderer({
  root,
  messageId,
  occurrenceIndexMap,
  currentIndex,
}: AstMessageRendererProps) {
  const sanitizedRoot = useMemo(() => sanitizeRootForRender(root), [root]);
  const context: RenderContext = {
    messageId,
    occurrenceIndexMap: occurrenceIndexMap ?? {},
    currentIndex: typeof currentIndex === "number" ? currentIndex : null,
  };
  return (
    <div className="reader-ast-content">
      {renderNodes(toEntries(sanitizedRoot.children), "ast", [], context)}
    </div>
  );
}

