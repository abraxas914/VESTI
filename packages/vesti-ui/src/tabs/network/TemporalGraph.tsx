"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UiThemeMode } from "../../types";
import { buildFixedAnchorLayout } from "./network-layout";
import type { GraphNode, NetworkData } from "./temporal-graph-utils";
import {
  GRAPH_FONT_FAMILY,
  clamp,
  getEdgeAlpha,
  getGraphEdgeStroke,
  getGraphLabelFill,
  getNodeAlpha,
  hexToRgba,
  hitTestNode,
  truncateLabel,
} from "./temporal-graph-utils";

interface TemporalGraphProps {
  data: NetworkData;
  currentDay: number;
  height: number;
  themeMode?: UiThemeMode;
  scrubbing?: boolean;
  resetToken?: number;
  selectedNodeId?: number | null;
  highlightedNodeIds?: number[];
  onNodeClick?: (nodeId: number) => void;
  onBackgroundClick?: () => void;
  /** Extra hover-detail line for a node (e.g. digest one-liner, cluster date
   * range). Return null for title-only tooltips. */
  getNodeTooltip?: (node: GraphNode) => string | null;
}

interface RenderNode extends GraphNode {
  x: number;
  y: number;
}

interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface LabelCandidate {
  id: number;
  label: string;
  alpha: number;
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  priority: number;
  force: boolean;
}

interface PointerSnapshot {
  clientX: number;
  clientY: number;
}

interface GestureState {
  mode: "idle" | "pan" | "pinch";
  pointerId: number | null;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  moved: boolean;
  startScale: number;
  startDistance: number;
  worldX: number;
  worldY: number;
}

const VIEW_PADDING = 16;
const OVERSCROLL_X = 120;
const OVERSCROLL_Y = 80;
const DRAG_THRESHOLD = 5;
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.8;
const WHEEL_ZOOM_INTENSITY = 0.0016;

function createWorldBounds(): WorldBounds {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

function createGestureState(): GestureState {
  return {
    mode: "idle",
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    moved: false,
    startScale: 1,
    startDistance: 0,
    worldX: 0,
    worldY: 0,
  };
}

function buildWorldBounds(layout: ReturnType<typeof buildFixedAnchorLayout>) {
  if (layout.size === 0) return createWorldBounds();

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  layout.forEach((anchor) => {
    minX = Math.min(minX, anchor.anchorX - anchor.horizontalFootprint);
    maxX = Math.max(maxX, anchor.anchorX + anchor.horizontalFootprint);
    minY = Math.min(minY, anchor.anchorY - anchor.collisionRadius);
    maxY = Math.max(maxY, anchor.anchorY + anchor.verticalFootprint);
  });

  return { minX, maxX, minY, maxY };
}

function getFitScale(bounds: WorldBounds, width: number, height: number) {
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(1, width - VIEW_PADDING * 2);
  const availableHeight = Math.max(1, height - VIEW_PADDING * 2);
  return clamp(
    Math.min(availableWidth / worldWidth, availableHeight / worldHeight, 1.12),
    MIN_ZOOM,
    MAX_ZOOM
  );
}

function clampTransform(
  transform: ViewTransform,
  bounds: WorldBounds,
  width: number,
  height: number
) {
  const fitScale = getFitScale(bounds, width, height);
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scaledWidth = worldWidth * transform.scale;
  const scaledHeight = worldHeight * transform.scale;
  const allowOverscroll = transform.scale > fitScale + 0.02;
  const overscrollX = allowOverscroll ? OVERSCROLL_X : 0;
  const overscrollY = allowOverscroll ? OVERSCROLL_Y : 0;

  const minOffsetX =
    scaledWidth + VIEW_PADDING * 2 <= width
      ? (width - scaledWidth) / 2 - bounds.minX * transform.scale
      : width - VIEW_PADDING - bounds.maxX * transform.scale - overscrollX;
  const maxOffsetX =
    scaledWidth + VIEW_PADDING * 2 <= width
      ? (width - scaledWidth) / 2 - bounds.minX * transform.scale
      : VIEW_PADDING - bounds.minX * transform.scale + overscrollX;

  const minOffsetY =
    scaledHeight + VIEW_PADDING * 2 <= height
      ? (height - scaledHeight) / 2 - bounds.minY * transform.scale
      : height - VIEW_PADDING - bounds.maxY * transform.scale - overscrollY;
  const maxOffsetY =
    scaledHeight + VIEW_PADDING * 2 <= height
      ? (height - scaledHeight) / 2 - bounds.minY * transform.scale
      : VIEW_PADDING - bounds.minY * transform.scale + overscrollY;

  return {
    offsetX: clamp(transform.offsetX, Math.min(minOffsetX, maxOffsetX), Math.max(minOffsetX, maxOffsetX)),
    offsetY: clamp(transform.offsetY, Math.min(minOffsetY, maxOffsetY), Math.max(minOffsetY, maxOffsetY)),
    scale: clamp(transform.scale, MIN_ZOOM, MAX_ZOOM),
  };
}

function createCenteredTransform(bounds: WorldBounds, width: number, height: number): ViewTransform {
  const scale = getFitScale(bounds, width, height);
  const worldCenterX = (bounds.minX + bounds.maxX) / 2;
  const worldCenterY = (bounds.minY + bounds.maxY) / 2;
  return clampTransform(
    {
      scale,
      offsetX: width / 2 - worldCenterX * scale,
      offsetY: height / 2 - worldCenterY * scale,
    },
    bounds,
    width,
    height
  );
}

function labelsOverlap(left: LabelCandidate, right: LabelCandidate) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

function projectX(worldX: number, transform: ViewTransform) {
  return worldX * transform.scale + transform.offsetX;
}

function projectY(worldY: number, transform: ViewTransform) {
  return worldY * transform.scale + transform.offsetY;
}

function screenToWorld(screenX: number, screenY: number, transform: ViewTransform) {
  return {
    x: (screenX - transform.offsetX) / transform.scale,
    y: (screenY - transform.offsetY) / transform.scale,
  };
}

function getDistanceBetweenPointers(points: PointerSnapshot[]) {
  if (points.length < 2) return 0;
  const [left, right] = points;
  return Math.hypot(right.clientX - left.clientX, right.clientY - left.clientY);
}

function getPointerMidpoint(
  points: PointerSnapshot[],
  rect: DOMRect
) {
  if (points.length < 2) return { x: 0, y: 0 };
  const [left, right] = points;
  return {
    x: (left.clientX + right.clientX) / 2 - rect.left,
    y: (left.clientY + right.clientY) / 2 - rect.top,
  };
}

export function TemporalGraph({
  data,
  currentDay,
  height,
  themeMode = "light",
  scrubbing = false,
  resetToken = 0,
  selectedNodeId = null,
  highlightedNodeIds,
  onNodeClick,
  onBackgroundClick,
  getNodeTooltip,
}: TemporalGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const currentDayRef = useRef(currentDay);
  const activeNodesRef = useRef<RenderNode[]>([]);
  const layoutRef = useRef<ReturnType<typeof buildFixedAnchorLayout>>(new Map());
  const worldBoundsRef = useRef<WorldBounds>(createWorldBounds());
  const fitScaleRef = useRef(1);
  const transformRef = useRef<ViewTransform>({ offsetX: 0, offsetY: 0, scale: 1 });
  const activePointersRef = useRef(new Map<number, PointerSnapshot>());
  const gestureRef = useRef<GestureState>(createGestureState());
  const hoverIdRef = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<RenderNode | null>(null);

  const highlightedNodeIdSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds]
  );
  const degreeById = useMemo(() => {
    const next = new Map<number, number>();
    data.edges.forEach((edge) => {
      next.set(edge.source, (next.get(edge.source) ?? 0) + 1);
      next.set(edge.target, (next.get(edge.target) ?? 0) + 1);
    });
    return next;
  }, [data.edges]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    // Resizing the canvas clears it and reallocates the backing store — only
    // do it when the size actually changed (per-frame draws just clearRect).
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2 + 8;
    const transform = transformRef.current;
    const renderedNodes: RenderNode[] = [];
    const renderedNodesById = new Map<number, RenderNode>();
    const labelCandidates: LabelCandidate[] = [];

    // Viewport culling: skip work for nodes far outside the visible rect.
    const viewMargin = 60;
    const viewLeft = -transform.offsetX / transform.scale - viewMargin;
    const viewRight = (width - transform.offsetX) / transform.scale + viewMargin;
    const viewTop = -transform.offsetY / transform.scale - viewMargin;
    const viewBottom = (height - transform.offsetY) / transform.scale + viewMargin;

    for (const node of data.nodes) {
      if (node.timelineDay > currentDayRef.current) continue;
      const anchor = layoutRef.current.get(node.id);
      if (!anchor) continue;
      if (
        anchor.anchorX < viewLeft ||
        anchor.anchorX > viewRight ||
        anchor.anchorY < viewTop ||
        anchor.anchorY > viewBottom
      ) {
        continue;
      }

      const targetX = projectX(anchor.anchorX, transform);
      const targetY = projectY(anchor.anchorY, transform);
      const screenRadius = clamp(node.radius * transform.scale, 4, 30);
      const age = currentDayRef.current - node.timelineDay;
      const enterProgress = Math.max(0, Math.min(1, age / 0.8));
      const renderNode: RenderNode = {
        ...node,
        radius: screenRadius,
        x: centerX + (targetX - centerX) * enterProgress,
        y: centerY + (targetY - centerY) * enterProgress,
      };

      renderedNodes.push(renderNode);
      renderedNodesById.set(node.id, renderNode);
    }

    activeNodesRef.current = renderedNodes;

    const hasSelection = selectedNodeId !== null;

    for (const edge of data.edges) {
      const source = renderedNodesById.get(edge.source);
      const target = renderedNodesById.get(edge.target);
      if (!source || !target) continue;

      let alpha = getEdgeAlpha(edge, source, target, currentDayRef.current);
      if (alpha <= 0.01) continue;

      const isHighlightedEdge =
        selectedNodeId !== null &&
        (edge.source === selectedNodeId || edge.target === selectedNodeId);

      if (hasSelection && !isHighlightedEdge) {
        alpha *= 0.16;
      }

      if (alpha <= 0.01) continue;

      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = getGraphEdgeStroke(themeMode, isHighlightedEdge ? alpha * 1.12 : alpha);
      context.lineWidth =
        edge.weight * (isHighlightedEdge ? 2.3 : 1.8) * clamp(transform.scale, 0.66, 1.28);
      context.stroke();
    }

    for (const node of renderedNodes) {
      let alpha = getNodeAlpha(node, currentDayRef.current);
      if (alpha <= 0.01) continue;

      const isSelected = node.id === selectedNodeId;
      const isNeighbor = highlightedNodeIdSet.has(node.id);
      const nodeDegree = degreeById.get(node.id) ?? 0;
      if (hasSelection && !isSelected && !isNeighbor) {
        alpha *= 0.22;
      }

      const age = currentDayRef.current - node.timelineDay;
      if (age >= 0 && age < 0.8) {
        const birthProgress = Math.max(0, Math.min(1, age / 0.8));
        const rippleMultiplier = hasSelection && !isSelected && !isNeighbor ? 0.28 : 1;

        context.beginPath();
        context.arc(node.x, node.y, node.radius + birthProgress * 18, 0, Math.PI * 2);
        context.fillStyle = hexToRgba(node.color, (1 - birthProgress) * 0.15 * rippleMultiplier);
        context.fill();

        context.beginPath();
        context.arc(node.x, node.y, node.radius + birthProgress * 10, 0, Math.PI * 2);
        context.fillStyle = hexToRgba(node.color, (1 - birthProgress) * 0.1 * rippleMultiplier);
        context.fill();
      }

      const isCluster = node.kind === "cluster";

      context.beginPath();
      context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      context.fillStyle = hexToRgba(node.color, alpha * (isSelected ? 1 : isCluster ? 0.55 : 0.9));
      context.fill();
      context.strokeStyle = isSelected
        ? themeMode === "dark"
          ? "rgba(229, 227, 219, 0.95)"
          : "rgba(26, 26, 26, 0.92)"
        : hexToRgba(node.color, Math.min(1, alpha * 1.35));
      context.lineWidth = isSelected ? 2.2 : isCluster ? 1.6 : 1;
      context.stroke();

      // Clusters get a dashed outer ring so they read as "many" at a glance.
      if (isCluster) {
        context.save();
        context.setLineDash([3, 3]);
        context.beginPath();
        context.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
        context.strokeStyle = hexToRgba(node.color, alpha * 0.9);
        context.lineWidth = 1;
        context.stroke();
        context.restore();
      }

      const allowGeneralLabel =
        transform.scale >= fitScaleRef.current * 1.35 || nodeDegree === 0;

      if (isCluster || isSelected || isNeighbor || (alpha > 0.36 && allowGeneralLabel)) {
        const labelAlpha = isSelected
          ? 1
          : isCluster
            ? Math.max(0.55, Math.min(1, alpha + 0.25))
            : isNeighbor
              ? Math.max(0.62, Math.min(1, (alpha - 0.2) / 0.28))
              : Math.min(0.9, (alpha - 0.32) / 0.22);
        const label = truncateLabel(node.label, 18);
        const anchor = layoutRef.current.get(node.id);
        const labelHalfWidth = anchor?.labelHalfWidth ?? Math.max(36, label.length * 4);
        const labelY = node.y + node.radius + 13;

        labelCandidates.push({
          id: node.id,
          label,
          alpha: labelAlpha,
          x: node.x,
          y: labelY,
          left: node.x - labelHalfWidth - 10,
          right: node.x + labelHalfWidth + 10,
          top: labelY - 16,
          bottom: labelY + 8,
          priority:
            (isSelected ? 120 : 0) +
            (isNeighbor ? 30 : 0) +
            node.radius +
            labelAlpha * 10,
          force: isSelected,
        });
      }
    }

    const acceptedLabels: LabelCandidate[] = [];
    labelCandidates
      .sort((left, right) => right.priority - left.priority || left.id - right.id)
      .forEach((candidate) => {
        if (
          !candidate.force &&
          acceptedLabels.some((accepted) => labelsOverlap(candidate, accepted))
        ) {
          return;
        }
        acceptedLabels.push(candidate);
      });

    context.font = `11px ${GRAPH_FONT_FAMILY}`;
    context.textAlign = "center";
    acceptedLabels
      .sort((left, right) => left.priority - right.priority || left.id - right.id)
      .forEach((candidate) => {
        context.fillStyle = getGraphLabelFill(themeMode, candidate.alpha);
        context.fillText(candidate.label, candidate.x, candidate.y);
      });
  }, [
    data.edges,
    data.nodes,
    degreeById,
    height,
    highlightedNodeIdSet,
    selectedNodeId,
    themeMode,
    width,
  ]);

  const setTransformAndRedraw = useCallback(
    (nextTransform: ViewTransform) => {
      transformRef.current = clampTransform(
        nextTransform,
        worldBoundsRef.current,
        width,
        height
      );
      draw();
    },
    [draw, height, width]
  );

  const initializePanGesture = useCallback((pointerId: number, clientX: number, clientY: number) => {
    gestureRef.current = {
      mode: "pan",
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      startOffsetX: transformRef.current.offsetX,
      startOffsetY: transformRef.current.offsetY,
      moved: false,
      startScale: transformRef.current.scale,
      startDistance: 0,
      worldX: 0,
      worldY: 0,
    };
  }, []);

  const initializePinchGesture = useCallback((canvas: HTMLCanvasElement) => {
    const points = Array.from(activePointersRef.current.values());
    if (points.length < 2) return;

    const rect = canvas.getBoundingClientRect();
    const midpoint = getPointerMidpoint(points, rect);
    const worldPoint = screenToWorld(midpoint.x, midpoint.y, transformRef.current);

    gestureRef.current = {
      mode: "pinch",
      pointerId: null,
      startClientX: midpoint.x,
      startClientY: midpoint.y,
      startOffsetX: transformRef.current.offsetX,
      startOffsetY: transformRef.current.offsetY,
      moved: true,
      startScale: transformRef.current.scale,
      startDistance: Math.max(1, getDistanceBetweenPointers(points)),
      worldX: worldPoint.x,
      worldY: worldPoint.y,
    };
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? wrapper.clientWidth;
      setWidth(nextWidth);
    });

    observer.observe(wrapper);
    setWidth(wrapper.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  // Latest-draw ref: the layout effect must NOT re-run when only selection /
  // highlight / theme change (those redraw via the effect below). Layout is
  // O(n·iter) work and only depends on data + viewport size.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  useEffect(() => {
    if (width <= 0) {
      layoutRef.current = new Map();
      activeNodesRef.current = [];
      worldBoundsRef.current = createWorldBounds();
      transformRef.current = { offsetX: 0, offsetY: 0, scale: 1 };
      return;
    }

    const layout = buildFixedAnchorLayout(data.nodes, data.edges, width, height);
    layoutRef.current = layout;
    const worldBounds = buildWorldBounds(layout);
    worldBoundsRef.current = worldBounds;
    fitScaleRef.current = getFitScale(worldBounds, width, height);
    transformRef.current = createCenteredTransform(worldBounds, width, height);
    drawRef.current();
  }, [data.edges, data.nodes, height, width]);

  useEffect(() => {
    currentDayRef.current = currentDay;
    draw();
  }, [currentDay, draw, resetToken, scrubbing, selectedNodeId, highlightedNodeIdSet]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (activePointersRef.current.size === 1) {
      initializePanGesture(event.pointerId, event.clientX, event.clientY);
    } else if (activePointersRef.current.size === 2) {
      initializePinchGesture(event.currentTarget);
      setIsDragging(false);
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  }, [initializePanGesture, initializePinchGesture]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!activePointersRef.current.has(event.pointerId)) return;

      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (activePointersRef.current.size >= 2) {
        if (gestureRef.current.mode !== "pinch") {
          initializePinchGesture(event.currentTarget);
        }

        const points = Array.from(activePointersRef.current.values());
        const rect = event.currentTarget.getBoundingClientRect();
        const midpoint = getPointerMidpoint(points, rect);
        const distance = Math.max(1, getDistanceBetweenPointers(points));
        const nextScale = clamp(
          gestureRef.current.startScale * (distance / Math.max(1, gestureRef.current.startDistance)),
          MIN_ZOOM,
          MAX_ZOOM
        );

        setTransformAndRedraw({
          scale: nextScale,
          offsetX: midpoint.x - gestureRef.current.worldX * nextScale,
          offsetY: midpoint.y - gestureRef.current.worldY * nextScale,
        });
        return;
      }

      if (
        gestureRef.current.mode !== "pan" ||
        gestureRef.current.pointerId !== event.pointerId
      ) {
        return;
      }

      const deltaX = event.clientX - gestureRef.current.startClientX;
      const deltaY = event.clientY - gestureRef.current.startClientY;
      if (!gestureRef.current.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
        gestureRef.current.moved = true;
        setIsDragging(true);
      }

      if (!gestureRef.current.moved) return;

      setTransformAndRedraw({
        scale: transformRef.current.scale,
        offsetX: gestureRef.current.startOffsetX + deltaX,
        offsetY: gestureRef.current.startOffsetY + deltaY,
      });
    },
    [initializePinchGesture, setTransformAndRedraw]
  );

  const releasePointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const shouldHandleClick =
        gestureRef.current.mode === "pan" &&
        gestureRef.current.pointerId === event.pointerId &&
        !gestureRef.current.moved;

      activePointersRef.current.delete(event.pointerId);

      if (activePointersRef.current.size >= 2) {
        initializePinchGesture(event.currentTarget);
      } else if (activePointersRef.current.size === 1) {
        const [remainingPointerId, remainingPointer] = Array.from(activePointersRef.current.entries())[0];
        initializePanGesture(
          remainingPointerId,
          remainingPointer.clientX,
          remainingPointer.clientY
        );
      } else {
        gestureRef.current = createGestureState();
        setIsDragging(false);
      }

      if (!shouldHandleClick) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hitNode = hitTestNode(activeNodesRef.current, x, y, currentDayRef.current);
      if (hitNode) {
        onNodeClick?.(hitNode.id);
      } else {
        onBackgroundClick?.();
      }
    },
    [initializePanGesture, initializePinchGesture, onBackgroundClick, onNodeClick]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();

      const rect = event.currentTarget.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const worldPoint = screenToWorld(screenX, screenY, transformRef.current);
      const nextScale = clamp(
        transformRef.current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_INTENSITY),
        MIN_ZOOM,
        MAX_ZOOM
      );

      setTransformAndRedraw({
        scale: nextScale,
        offsetX: screenX - worldPoint.x * nextScale,
        offsetY: screenY - worldPoint.y * nextScale,
      });
    },
    [setTransformAndRedraw]
  );

  // Hover tooltip: hit-test only when no gesture is active, and only set
  // state when the hovered node changes (no per-move re-renders).
  const handleHoverMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointersRef.current.size > 0 || gestureRef.current.moved) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const hit = hitTestNode(
        activeNodesRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        currentDayRef.current
      );
      const nextId = hit ? hit.id : null;
      if (nextId === hoverIdRef.current) return;
      hoverIdRef.current = nextId;
      setHoveredNode(hit);
    },
    []
  );

  const handlePointerLeave = useCallback(() => {
    if (hoverIdRef.current === null) return;
    hoverIdRef.current = null;
    setHoveredNode(null);
  }, []);

  const hoveredTooltip = hoveredNode ? getNodeTooltip?.(hoveredNode) ?? null : null;

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => {
          handlePointerMove(event);
          handleHoverMove(event);
        }}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      />
      {hoveredNode && !isDragging && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-border-subtle bg-bg-primary px-2.5 py-1.5 shadow-md"
          style={{
            left: Math.min(hoveredNode.x + 12, Math.max(0, width - 270)),
            top: Math.max(4, hoveredNode.y - hoveredNode.radius - 8),
          }}
        >
          <div className="truncate text-[11px] font-sans font-medium text-text-primary">
            {hoveredNode.kind === "cluster"
              ? hoveredNode.label
              : truncateLabel(hoveredNode.label, 42)}
          </div>
          {hoveredTooltip && (
            <div className="mt-0.5 line-clamp-2 text-[10px] font-sans text-text-tertiary">
              {hoveredTooltip}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
