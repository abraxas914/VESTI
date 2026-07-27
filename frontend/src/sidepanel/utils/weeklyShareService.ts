import type { WeeklyGrowthData } from "~lib/types/insightsPresentation";

const EXPORT_EXCLUDE_SELECTOR =
  "[data-weekly-export-exclude], [data-weekly-export-private]";
const MAX_CANVAS_EDGE = 12000;
const MAX_CANVAS_AREA = 32_000_000;
const EXPORT_BOTTOM_BREATHING_ROOM = 24;

export interface WeeklyExportHeightMetrics {
  scrollHeight: number;
  rootHeight: number;
  contentBottom: number | null;
  bottomInset?: number;
}

export interface WeeklyExportWidthMetrics {
  visibleWidth: number;
  scrollWidth: number;
}

/**
 * The share image is a snapshot of the side-panel report, so its horizontal
 * canvas must stay aligned with the report's visible width. A descendant's
 * intrinsic width may increase scrollWidth, but using that value would add a
 * blank strip beside the report instead of matching the side panel.
 */
export function resolveWeeklyExportWidth({
  visibleWidth,
  scrollWidth,
}: WeeklyExportWidthMetrics): number {
  const renderedWidth = Number.isFinite(visibleWidth)
    ? Math.ceil(visibleWidth)
    : 0;
  if (renderedWidth > 0) return renderedWidth;
  return Math.max(
    1,
    Math.ceil(Number.isFinite(scrollWidth) ? scrollWidth : 0)
  );
}

/**
 * Prefer the bottom edge of actual rendered content over a cloned layout's
 * scrollHeight. Computed min-heights and flex constraints can otherwise turn
 * into a large blank tail in the exported canvas.
 */
export function resolveWeeklyExportHeight({
  scrollHeight,
  rootHeight,
  contentBottom,
  bottomInset = EXPORT_BOTTOM_BREATHING_ROOM,
}: WeeklyExportHeightMetrics): number {
  const layoutHeight = Math.max(
    1,
    Math.ceil(Number.isFinite(scrollHeight) ? scrollHeight : 0),
    Math.ceil(Number.isFinite(rootHeight) ? rootHeight : 0)
  );
  if (contentBottom === null || !Number.isFinite(contentBottom)) {
    return layoutHeight;
  }
  const contentHeight = Math.max(
    1,
    Math.ceil(contentBottom + Math.max(0, bottomInset))
  );
  return Math.min(layoutHeight, contentHeight);
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function stripExternalImages(element: HTMLElement): void {
  element.style.backgroundImage = "none";
  element.style.maskImage = "none";
  element.style.webkitMaskImage = "none";
}

function inlineComputedStyles(source: Element, target: Element): void {
  if (source instanceof HTMLElement && target instanceof HTMLElement) {
    const computed = window.getComputedStyle(source);
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index);
      const value = computed.getPropertyValue(property);
      if (value.includes("url(")) continue;
      target.style.setProperty(
        property,
        value,
        computed.getPropertyPriority(property)
      );
    }
    stripExternalImages(target);
    target.style.animation = "none";
    target.style.transition = "none";
  } else if (source instanceof SVGElement && target instanceof SVGElement) {
    const computed = window.getComputedStyle(source);
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index);
      const value = computed.getPropertyValue(property);
      if (value.includes("url(")) continue;
      target.style.setProperty(property, value);
    }
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((sourceChild, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) inlineComputedStyles(sourceChild, targetChild);
  });
}

const VERTICAL_SIZE_PROPERTIES = [
  "height",
  "min-height",
  "max-height",
  "block-size",
  "min-block-size",
  "max-block-size",
] as const;

function collectReflowAncestors(
  root: HTMLElement,
  elements: Element[]
): Set<HTMLElement> {
  const ancestors = new Set<HTMLElement>();
  for (const element of elements) {
    let ancestor = element.parentElement;
    while (ancestor) {
      ancestors.add(ancestor);
      if (ancestor === root) break;
      ancestor = ancestor.parentElement;
    }
  }
  return ancestors;
}

function removePrivateContent(root: HTMLElement): void {
  const excluded = Array.from(root.querySelectorAll(EXPORT_EXCLUDE_SELECTOR));
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>(
      "input, textarea, select, [contenteditable='true']"
    )
  );
  const reflowAncestors = collectReflowAncestors(root, [
    ...excluded,
    ...controls,
  ]);

  [...excluded, ...controls].forEach((element) => element.remove());

  // Computed styles are inlined before sanitizing so the foreignObject can be
  // rendered without the extension stylesheet. Those styles include pixel
  // heights from the unsanitized UI. Clear only ancestor block sizing so the
  // remaining report content can close the gaps left by removed controls.
  reflowAncestors.forEach((element) => {
    VERTICAL_SIZE_PROPERTIES.forEach((property) => {
      element.style.removeProperty(property);
    });
  });
}

function hasDirectRenderableContent(element: Element): boolean {
  if (element.matches("img, svg, canvas, video, hr")) return true;
  return Array.from(element.childNodes).some(
    (node) =>
      node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
  );
}

function measureContentBottom(root: HTMLElement): number | null {
  const rootRect = root.getBoundingClientRect();
  let contentBottom: number | null = null;
  for (const element of root.querySelectorAll<HTMLElement | SVGElement>("*")) {
    if (!hasDirectRenderableContent(element)) continue;
    const computed = window.getComputedStyle(element);
    if (computed.display === "none" || computed.visibility === "hidden") {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const bottom = rect.bottom - rootRect.top;
    contentBottom =
      contentBottom === null ? bottom : Math.max(contentBottom, bottom);
  }
  return contentBottom;
}

async function buildSanitizedClone(
  source: HTMLElement
): Promise<{ clone: HTMLElement; width: number; height: number }> {
  await document.fonts?.ready;
  await nextAnimationFrame();
  await nextAnimationFrame();

  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width < 1 || sourceRect.height < 1) {
    throw new Error("WEEKLY_EXPORT_NOT_RENDERED");
  }

  const clone = source.cloneNode(true) as HTMLElement;
  inlineComputedStyles(source, clone);
  removePrivateContent(clone);
  const sourceBackground = window.getComputedStyle(source).backgroundColor;
  const bodyBackground = window.getComputedStyle(document.body).backgroundColor;
  const transparent = (value: string) =>
    !value ||
    value === "transparent" ||
    value === "rgba(0, 0, 0, 0)" ||
    value === "rgba(0,0,0,0)";
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.backgroundColor = transparent(sourceBackground)
    ? transparent(bodyBackground)
      ? "#ffffff"
      : bodyBackground
    : sourceBackground;
  clone.style.boxSizing = "border-box";
  clone.style.height = "auto";
  clone.style.minHeight = "0";
  clone.style.maxHeight = "none";
  clone.style.blockSize = "auto";
  clone.style.minBlockSize = "0";
  clone.style.maxBlockSize = "none";
  clone.style.overflow = "visible";
  clone.style.pointerEvents = "none";
  clone.style.width = `${Math.ceil(sourceRect.width)}px`;

  const staging = document.createElement("div");
  staging.setAttribute("aria-hidden", "true");
  staging.style.position = "fixed";
  staging.style.left = "-100000px";
  staging.style.top = "0";
  staging.style.visibility = "hidden";
  staging.style.width = `${Math.ceil(sourceRect.width)}px`;
  staging.style.zIndex = "-1";
  staging.appendChild(clone);
  document.body.appendChild(staging);

  try {
    const width = resolveWeeklyExportWidth({
      visibleWidth: sourceRect.width,
      scrollWidth: clone.scrollWidth,
    });
    const cloneRect = clone.getBoundingClientRect();
    const computed = window.getComputedStyle(clone);
    const rootBottomPadding = Number.parseFloat(computed.paddingBottom) || 0;
    const height = resolveWeeklyExportHeight({
      scrollHeight: clone.scrollHeight,
      rootHeight: cloneRect.height,
      contentBottom: measureContentBottom(clone),
      bottomInset: Math.max(
        EXPORT_BOTTOM_BREATHING_ROOM,
        rootBottomPadding + 2
      ),
    });
    if (width < 1 || height < 1) {
      throw new Error("WEEKLY_EXPORT_EMPTY");
    }
    clone.style.height = `${height}px`;
    clone.style.minHeight = `${height}px`;
    clone.style.maxHeight = `${height}px`;
    return { clone, width, height };
  } finally {
    clone.remove();
    staging.remove();
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("WEEKLY_EXPORT_SVG_ENCODING_FAILED"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("WEEKLY_EXPORT_SVG_ENCODING_FAILED"));
    };
    reader.readAsDataURL(blob);
  });
}

async function renderCloneToPng(
  clone: HTMLElement,
  width: number,
  height: number
): Promise<Blob> {
  const areaScale = Math.sqrt(MAX_CANVAS_AREA / Math.max(1, width * height));
  const scale = Math.max(
    0.25,
    Math.min(2, MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height, areaScale)
  );
  const outputWidth = Math.max(1, Math.floor(width * scale));
  const outputHeight = Math.max(1, Math.floor(height * scale));
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject></svg>`;
  // A blob: SVG containing foreignObject taints canvas in Chrome extension
  // pages, so canvas.toBlob() throws SecurityError. A data: URL keeps the
  // exact same SVG origin-clean and can be exported safely.
  const svgDataUrl = await readBlobAsDataUrl(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  );

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("WEEKLY_EXPORT_CANVAS_UNAVAILABLE"));
          return;
        }
        context.scale(scale, scale);
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("WEEKLY_EXPORT_PNG_ENCODING_FAILED"));
        }, "image/png");
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => {
      reject(new Error("WEEKLY_EXPORT_IMAGE_LOAD_FAILED"));
    };
    image.src = svgDataUrl;
  });
}

function formatFilenameDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function generateWeeklySharePNG(
  reportElement: HTMLElement,
  reportDate = Date.now()
): Promise<string> {
  const { clone, width, height } = await buildSanitizedClone(reportElement);
  const blob = await renderCloneToPng(clone, width, height);
  const filename = `vesti_weekly_${formatFilenameDate(reportDate)}.png`;
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  return filename;
}

export function buildPrivacySafeWeeklyText(data: WeeklyGrowthData): string {
  const report = data.report;
  const tags = (report.tags?.current ?? [])
    .map((tag) => tag.name?.trim())
    .filter((tag): tag is string => Boolean(tag));
  const emotions = (report.identity?.emotionKeywords ?? [])
    .map((emotion) => emotion.label?.trim())
    .filter((emotion): emotion is string => Boolean(emotion));
  const lines = [
    "VESTI · Personal Growth Weekly",
    data.meta.range_label ?? "",
    `Focus: ${Math.round(report.energy?.focusDepth?.score ?? 0)}`,
    `Rhythm: ${Math.round(report.energy?.rhythmHealth?.score ?? 0)}`,
    `Topic breadth: ${Math.round(report.energy?.topicBreadth?.score ?? 0)}`,
    emotions.length > 0 ? `Emotion map: ${emotions.join(", ")}` : "",
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
