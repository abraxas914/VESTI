import type {
  AstNode,
  AstTableAlign,
  AstTableCellV2,
  AstTableNode,
  AstTableRowV2,
} from "../../../types/ast";
import type { Platform } from "../../../types";
import { isLikelyMathElement, probeMathTex } from "./astMathProbes";

function normalizeCellText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeAlign(value: string | null | undefined): AstTableAlign {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "left" || normalized === "center" || normalized === "right") {
    return normalized;
  }
  return null;
}

function readCellAlign(cell: Element): AstTableAlign {
  return (
    normalizeAlign(cell.getAttribute("align")) ??
    normalizeAlign(cell.getAttribute("data-align")) ??
    normalizeAlign((cell as HTMLElement).style?.textAlign)
  );
}

function compactInlineNodes(nodes: AstNode[]): AstNode[] {
  const compacted: AstNode[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      if (!node.text.trim()) {
        continue;
      }
      const previous = compacted[compacted.length - 1];
      if (previous?.type === "text") {
        previous.text += node.text;
      } else {
        compacted.push(node);
      }
      continue;
    }

    compacted.push(node);
  }

  const first = compacted[0];
  if (first?.type === "text") {
    first.text = first.text.trimStart();
    if (!first.text) compacted.shift();
  }

  const last = compacted[compacted.length - 1];
  if (last?.type === "text") {
    last.text = last.text.trimEnd();
    if (!last.text) compacted.pop();
  }

  return compacted;
}

function parseInlineTextNode(node: Text): AstNode[] {
  const normalized = node.nodeValue?.replace(/\u00a0/g, " ").replace(/\s+/g, " ") ?? "";
  if (!normalized.trim()) {
    return [];
  }
  return [{ type: "text", text: normalized }];
}

function parseCellChildren(nodes: NodeListOf<ChildNode> | ChildNode[], platform: Platform): AstNode[] {
  const output: AstNode[] = [];
  for (const node of Array.from(nodes)) {
    output.push(...parseCellNode(node, platform));
  }
  return compactInlineNodes(output);
}

function parseCellNode(node: Node, platform: Platform): AstNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return parseInlineTextNode(node as Text);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (tag === "br") {
    return [{ type: "br" }];
  }

  if (tag === "code" && !element.closest("pre")) {
    const text = normalizeCellText(element.textContent ?? "");
    return text ? [{ type: "code_inline", text }] : [];
  }

  if (tag === "strong" || tag === "b") {
    const children = parseCellChildren(element.childNodes, platform);
    return children.length > 0 ? [{ type: "strong", children }] : [];
  }

  if (tag === "em" || tag === "i") {
    const children = parseCellChildren(element.childNodes, platform);
    return children.length > 0 ? [{ type: "em", children }] : [];
  }

  if (!element.closest("code") && isLikelyMathElement(element, platform)) {
    const math = probeMathTex(element, platform);
    if (math?.tex.trim()) {
      return [{ type: "math", tex: math.tex, display: math.display || undefined }];
    }
  }

  const children = parseCellChildren(element.childNodes, platform);
  if (children.length > 0) {
    return children;
  }

  const fallback = normalizeCellText(element.textContent ?? "");
  return fallback ? [{ type: "text", text: fallback }] : [];
}

function readRowCellsLegacy(row: Element): string[] {
  // Preserve empty cells positionally (alignment); callers drop all-empty rows.
  const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"));
  return cells.map((cell) => normalizeCellText(cell.textContent ?? ""));
}

function readHeaderCellsLegacy(tableEl: Element): string[] {
  const headerRows = Array.from(tableEl.querySelectorAll("thead > tr"));
  if (headerRows.length > 0) {
    const headers = readRowCellsLegacy(headerRows[0]);
    if (headers.some((cell) => cell.length > 0)) return headers;
  }

  const firstRow = tableEl.querySelector("tr");
  if (!firstRow) return [];

  const explicitHeaders = Array.from(firstRow.querySelectorAll(":scope > th"))
    .map((cell) => normalizeCellText(cell.textContent ?? ""))
    .filter((cell) => cell.length > 0);

  if (explicitHeaders.length > 0) {
    return explicitHeaders;
  }

  return [];
}

function readBodyRowsLegacy(tableEl: Element, hasHeaderRow: boolean): string[][] {
  const tbodyRows = Array.from(tableEl.querySelectorAll("tbody > tr"));
  const rows = tbodyRows.length > 0 ? tbodyRows : Array.from(tableEl.querySelectorAll("tr"));

  return rows
    .filter((row, index) => !(hasHeaderRow && index === 0 && tbodyRows.length === 0))
    .map((row) => readRowCellsLegacy(row))
    .filter((cells) => cells.some((cell) => cell.length > 0));
}

function buildTableNodeV2(
  headerCells: Element[],
  dataRows: Element[],
  platform: Platform,
): AstTableNode | null {
  const columns = headerCells.map((cell) => ({
    align: readCellAlign(cell),
    header: parseCellChildren(cell.childNodes, platform),
  }));

  const rows: AstTableRowV2[] = dataRows
    .map((row) => {
      // Keep empty cells positionally — dropping them shifts every later cell
      // under the wrong column header. Only fully-empty rows are discarded below.
      const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"))
        .map<AstTableCellV2>((cell, index) => ({
          align: readCellAlign(cell) ?? columns[index]?.align ?? null,
          children: parseCellChildren(cell.childNodes, platform),
        }));

      return { cells };
    })
    .filter((row) => row.cells.some((cell) => cell.children.length > 0));

  if (columns.length === 0 && rows.length === 0) {
    return null;
  }

  return {
    type: "table",
    kind: "v2",
    columns,
    rows,
  };
}

function extractTableNodeV2(tableEl: Element, platform: Platform): AstTableNode | null {
  const headerRows = Array.from(tableEl.querySelectorAll("thead > tr"));
  const firstRow = headerRows[0] ?? tableEl.querySelector("tr");
  const headerCells =
    firstRow ? Array.from(firstRow.querySelectorAll(":scope > th, :scope > td")) : [];

  const tbodyRows = Array.from(tableEl.querySelectorAll("tbody > tr"));
  const candidateRows = tbodyRows.length > 0 ? tbodyRows : Array.from(tableEl.querySelectorAll("tr"));
  const dataRows = candidateRows.filter(
    (row, index) => !(headerCells.length > 0 && index === 0 && tbodyRows.length === 0),
  );

  return buildTableNodeV2(headerCells, dataRows, platform);
}

export function extractDoubaoTableWrapperNode(
  containerEl: Element,
  platform: Platform,
): AstTableNode | null {
  const nestedTable = containerEl.querySelector("[class*='table-body'] table");
  if (nestedTable) {
    return extractTableNode(nestedTable, platform);
  }

  const tableBody = containerEl.querySelector("[class*='table-body']");
  if (!tableBody) {
    return null;
  }

  const rows = Array.from(tableBody.children).filter(
    (child): child is Element => child instanceof Element && child.childElementCount > 0,
  );
  if (rows.length === 0) {
    return null;
  }

  const headerCells = Array.from(rows[0].children).filter(
    (child): child is Element => child instanceof Element,
  );
  const dataRows = rows.slice(1);

  return buildTableNodeV2(headerCells, dataRows, platform);
}

export function extractTableNode(tableEl: Element, platform: Platform): AstTableNode | null {
  const tableV2 = extractTableNodeV2(tableEl, platform);
  if (tableV2) {
    return tableV2;
  }

  const headers = readHeaderCellsLegacy(tableEl);
  const rows = readBodyRowsLegacy(tableEl, headers.length > 0);

  if (headers.length === 0 && rows.length === 0) {
    return null;
  }

  if (headers.length === 0 && rows.length > 0) {
    const firstRow = rows[0];
    return {
      type: "table",
      headers: firstRow.map((_, index) => `Column ${index + 1}`),
      rows,
    };
  }

  return {
    type: "table",
    headers,
    rows,
  };
}
