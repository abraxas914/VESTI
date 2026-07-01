"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UiThemeMode } from "../../types";
import {
  getPlatformLabel,
} from "../../constants/platform";
import type { ThinkingMap as ThinkingMapData } from "./thinkingMap";
import {
  GRAPH_FONT_FAMILY,
  GRAPH_PLATFORM_COLORS,
  clamp,
  getGraphLabelFill,
  hexToRgba,
  truncateLabel,
} from "./temporal-graph-utils";

interface ThinkingMapProps {
  map: ThinkingMapData;
  themeMode?: UiThemeMode;
  selectedConceptId: string | null;
  onSelectConcept: (id: string | null) => void;
  onSelectConversation?: (conversationId: number) => void;
  height?: number;
}

type NodeKind = "concept" | "conversation";

interface LayoutNode {
  id: string;
  kind: NodeKind;
  x: number; // world x
  y: number; // world y
  radius: number; // world radius
  color: string;
  label: string;
  tooltip: string;
  conversationId: number | null;
}

interface RenderNode extends LayoutNode {
  screenX: number;
  screenY: number;
  screenRadius: number;
}

interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface PointerSnapshot {
  clientX: number;
  clientY: number;
}

interface GestureState {
  mode: "idle" | "pan";
  pointerId: number | null;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  moved: boolean;
}

const LANE_HEIGHT = 160;
const X_SPAN = 1000;
const VIEW_PADDING = 32;
const DRAG_THRESHOLD = 5;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.2;
const WHEEL_ZOOM_INTENSITY = 0.0016;
const DIM_NODE_ALPHA = 0.12;
const DIM_EDGE_ALPHA = 0.12;
const BASE_EDGE_ALPHA = 0.25;

// Deterministic small hash → jitter in [-amount, amount].
function hashJitter(id: string, amount: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  const normalized = ((hash >>> 0) % 1000) / 1000; // [0,1)
  return (normalized * 2 - 1) * amount;
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
  };
}

export function ThinkingMap({
  map,
  themeMode = "light",
  selectedConceptId,
  onSelectConcept,
  onSelectConversation,
  height = 420,
}: ThinkingMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ViewTransform>({ offsetX: 0, offsetY: 0, scale: 1 });
  const renderNodesRef = useRef<RenderNode[]>([]);
  const activePointersRef = useRef(new Map<number, PointerSnapshot>());
  const gestureRef = useRef<GestureState>(createGestureState());
  const didFitRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // ── Lane assignment from clusters ───────────────────────────────────────
  const conceptLaneById = useMemo(() => {
    const lane = new Map<string, number>();
    map.clusters.forEach((cluster, index) => {
      cluster.conceptIds.forEach((conceptId) => lane.set(conceptId, index));
    });
    return lane;
  }, [map.clusters]);

  const conceptColorById = useMemo(() => {
    const color = new Map<string, string>();
    map.clusters.forEach((cluster) => {
      cluster.conceptIds.forEach((conceptId) => color.set(conceptId, cluster.color));
    });
    return color;
  }, [map.clusters]);

  // conversationId → lane via its first "mentions" edge.
  const conversationLaneById = useMemo(() => {
    const lane = new Map<number, number>();
    for (const edge of map.edges) {
      if (edge.type !== "mentions") continue;
      // mentions edge: source = concept, target = conv:<id>
      const conceptId = edge.source.startsWith("concept:") ? edge.source : edge.target;
      const convNodeId = edge.source.startsWith("conv:") ? edge.source : edge.target;
      const conversationId = Number(convNodeId.slice("conv:".length));
      if (Number.isNaN(conversationId) || lane.has(conversationId)) continue;
      const conceptLane = conceptLaneById.get(conceptId);
      if (conceptLane === undefined) continue;
      lane.set(conversationId, conceptLane);
    }
    return lane;
  }, [map.edges, conceptLaneById]);

  // ── Build layout nodes (world coordinates) ──────────────────────────────
  const layoutNodes = useMemo<LayoutNode[]>(() => {
    const span = Math.max(1, map.timeRange.end - map.timeRange.start);
    const timeToX = (t: number) => ((t - map.timeRange.start) / span) * X_SPAN;
    const nodes: LayoutNode[] = [];

    for (const concept of map.concepts) {
      const lane = conceptLaneById.get(concept.id) ?? map.clusters.length;
      const jitter = hashJitter(concept.id, 28);
      nodes.push({
        id: concept.id,
        kind: "concept",
        x: timeToX(concept.firstSeenAt),
        y: lane * LANE_HEIGHT + jitter,
        radius: Math.min(46, 18 + concept.count * 4),
        color: conceptColorById.get(concept.id) ?? "#7F77DD",
        label: concept.term,
        tooltip: concept.term,
        conversationId: null,
      });
    }

    for (const conv of map.conversationNodes) {
      const lane = conversationLaneById.get(conv.conversationId) ?? map.clusters.length;
      const jitter = hashJitter(conv.id, 28);
      nodes.push({
        id: conv.id,
        kind: "conversation",
        x: timeToX(conv.originAt),
        y: lane * LANE_HEIGHT + 80 + jitter,
        radius: 8,
        color: GRAPH_PLATFORM_COLORS[conv.platform] ?? "#888888",
        label: conv.title,
        tooltip: `${getPlatformLabel(conv.platform)} · ${conv.title}`,
        conversationId: conv.conversationId,
      });
    }

    return nodes;
  }, [
    map.concepts,
    map.conversationNodes,
    map.clusters.length,
    map.timeRange.start,
    map.timeRange.end,
    conceptLaneById,
    conceptColorById,
    conversationLaneById,
  ]);

  const nodeById = useMemo(() => {
    const byId = new Map<string, LayoutNode>();
    for (const node of layoutNodes) byId.set(node.id, node);
    return byId;
  }, [layoutNodes]);

  // Adjacency for focus mode (neighbors of selected concept via any edge).
  const neighborsByNode = useMemo(() => {
    const neighbors = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      neighbors.get(a)!.add(b);
    };
    for (const edge of map.edges) {
      add(edge.source, edge.target);
      add(edge.target, edge.source);
    }
    return neighbors;
  }, [map.edges]);

  const focusedNodeIds = useMemo(() => {
    if (!selectedConceptId) return null;
    const set = new Set<string>([selectedConceptId]);
    const neighbors = neighborsByNode.get(selectedConceptId);
    if (neighbors) neighbors.forEach((id) => set.add(id));
    return set;
  }, [selectedConceptId, neighborsByNode]);

  // ── World bounds + fit transform ────────────────────────────────────────
  const worldBounds = useMemo(() => {
    if (layoutNodes.length === 0) {
      return { minX: 0, maxX: X_SPAN, minY: 0, maxY: LANE_HEIGHT };
    }
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const node of layoutNodes) {
      minX = Math.min(minX, node.x - node.radius);
      maxX = Math.max(maxX, node.x + node.radius);
      minY = Math.min(minY, node.y - node.radius);
      maxY = Math.max(maxY, node.y + node.radius);
    }
    return { minX, maxX, minY, maxY };
  }, [layoutNodes]);

  const getFitTransform = useCallback((): ViewTransform => {
    const worldWidth = Math.max(1, worldBounds.maxX - worldBounds.minX);
    const worldHeight = Math.max(1, worldBounds.maxY - worldBounds.minY);
    const availableWidth = Math.max(1, width - VIEW_PADDING * 2);
    const availableHeight = Math.max(1, height - VIEW_PADDING * 2);
    const scale = clamp(
      Math.min(availableWidth / worldWidth, availableHeight / worldHeight, 1.1),
      MIN_ZOOM,
      MAX_ZOOM
    );
    const worldCenterX = (worldBounds.minX + worldBounds.maxX) / 2;
    const worldCenterY = (worldBounds.minY + worldBounds.maxY) / 2;
    return {
      scale,
      offsetX: width / 2 - worldCenterX * scale,
      offsetY: height / 2 - worldCenterY * scale,
    };
  }, [worldBounds, width, height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const transform = transformRef.current;
    const projectX = (worldX: number) => worldX * transform.scale + transform.offsetX;
    const projectY = (worldY: number) => worldY * transform.scale + transform.offsetY;

    const rendered: RenderNode[] = layoutNodes.map((node) => ({
      ...node,
      screenX: projectX(node.x),
      screenY: projectY(node.y),
      screenRadius: Math.max(3, node.radius * transform.scale),
    }));
    const renderedById = new Map<string, RenderNode>();
    for (const node of rendered) renderedById.set(node.id, node);
    renderNodesRef.current = rendered;

    const isFocused = (id: string) => !focusedNodeIds || focusedNodeIds.has(id);

    // Edges first (under nodes).
    for (const edge of map.edges) {
      const source = renderedById.get(edge.source);
      const target = renderedById.get(edge.target);
      if (!source || !target) continue;

      const edgeFocused =
        !focusedNodeIds ||
        (focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target));

      let alpha: number;
      let lineWidth: number;
      if (edge.type === "relates") {
        alpha = BASE_EDGE_ALPHA + Math.min(0.45, edge.weight * 0.12);
        lineWidth = clamp(0.8 + edge.weight * 0.7, 0.8, 4) * clamp(transform.scale, 0.6, 1.4);
      } else {
        // mentions — thin / faint
        alpha = BASE_EDGE_ALPHA * 0.55;
        lineWidth = 0.6 * clamp(transform.scale, 0.6, 1.4);
      }
      if (!edgeFocused) alpha = DIM_EDGE_ALPHA;

      context.beginPath();
      context.moveTo(source.screenX, source.screenY);
      context.lineTo(target.screenX, target.screenY);
      const stroke =
        themeMode === "dark" ? "180, 178, 168" : "100, 98, 90";
      context.strokeStyle = `rgba(${stroke}, ${alpha})`;
      context.lineWidth = lineWidth;
      context.stroke();
    }

    // Nodes.
    const labelDraws: Array<{ x: number; y: number; text: string; alpha: number }> = [];
    for (const node of rendered) {
      const focused = isFocused(node.id);
      const baseAlpha = focused ? 1 : DIM_NODE_ALPHA;

      context.beginPath();
      context.arc(node.screenX, node.screenY, node.screenRadius, 0, Math.PI * 2);
      context.fillStyle = hexToRgba(node.color, baseAlpha * (node.kind === "concept" ? 0.92 : 0.85));
      context.fill();

      const isSelected = node.id === selectedConceptId;
      context.strokeStyle = isSelected
        ? themeMode === "dark"
          ? "rgba(229, 227, 219, 0.95)"
          : "rgba(26, 26, 26, 0.92)"
        : hexToRgba(node.color, Math.min(1, baseAlpha * 1.3));
      context.lineWidth = isSelected ? 2.4 : 1;
      context.stroke();

      // Concept labels are visible; conversation labels stay in tooltip only.
      if (node.kind === "concept" && (focused || !focusedNodeIds)) {
        labelDraws.push({
          x: node.screenX,
          y: node.screenY + node.screenRadius + 13,
          text: truncateLabel(node.label, 20),
          alpha: focused ? 1 : 0.4,
        });
      }
    }

    context.font = `11px ${GRAPH_FONT_FAMILY}`;
    context.textAlign = "center";
    for (const label of labelDraws) {
      context.fillStyle = getGraphLabelFill(themeMode, label.alpha);
      context.fillText(label.text, label.x, label.y);
    }
  }, [
    width,
    height,
    layoutNodes,
    map.edges,
    focusedNodeIds,
    selectedConceptId,
    themeMode,
  ]);

  // Resize observer.
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

  // Fit on first layout / size and whenever the underlying map identity changes.
  useEffect(() => {
    didFitRef.current = false;
  }, [layoutNodes]);

  useEffect(() => {
    if (width <= 0) return;
    if (!didFitRef.current) {
      transformRef.current = getFitTransform();
      didFitRef.current = true;
    }
    draw();
  }, [width, height, getFitTransform, draw]);

  // Redraw on focus/selection/theme change.
  useEffect(() => {
    draw();
  }, [draw, selectedConceptId, focusedNodeIds, themeMode]);

  const hitTest = useCallback((screenX: number, screenY: number): RenderNode | null => {
    const nodes = renderNodesRef.current;
    // Iterate so concepts (drawn first) and convs both hittable; prefer topmost.
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const dx = screenX - node.screenX;
      const dy = screenY - node.screenY;
      if (Math.sqrt(dx * dx + dy * dy) <= node.screenRadius + 4) return node;
    }
    return null;
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      gestureRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: transformRef.current.offsetX,
        startOffsetY: transformRef.current.offsetY,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
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
      transformRef.current = {
        scale: transformRef.current.scale,
        offsetX: gestureRef.current.startOffsetX + deltaX,
        offsetY: gestureRef.current.startOffsetY + deltaY,
      };
      draw();
    },
    [draw]
  );

  const releasePointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const shouldHandleClick =
        gestureRef.current.pointerId === event.pointerId && !gestureRef.current.moved;
      activePointersRef.current.delete(event.pointerId);
      gestureRef.current = createGestureState();
      setIsDragging(false);

      if (!shouldHandleClick) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = hitTest(x, y);
      if (!hit) {
        onSelectConcept(null);
        return;
      }
      if (hit.kind === "concept") {
        onSelectConcept(hit.id === selectedConceptId ? null : hit.id);
      } else if (hit.conversationId !== null) {
        onSelectConversation?.(hit.conversationId);
      }
    },
    [hitTest, onSelectConcept, onSelectConversation, selectedConceptId]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const transform = transformRef.current;
      const worldX = (screenX - transform.offsetX) / transform.scale;
      const worldY = (screenY - transform.offsetY) / transform.scale;
      const nextScale = clamp(
        transform.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_INTENSITY),
        MIN_ZOOM,
        MAX_ZOOM
      );
      transformRef.current = {
        scale: nextScale,
        offsetX: screenX - worldX * nextScale,
        offsetY: screenY - worldY * nextScale,
      };
      draw();
    },
    [draw]
  );

  // Tooltip via title attribute on hover (lightweight, no extra render loop).
  const [hoverTitle, setHoverTitle] = useState("");
  const handleHover = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (gestureRef.current.moved) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const hit = hitTest(event.clientX - rect.left, event.clientY - rect.top);
      setHoverTitle(hit ? hit.tooltip : "");
    },
    [hitTest]
  );

  return (
    <div ref={wrapperRef} className="relative h-full w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
        title={hoverTitle || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => {
          handlePointerMove(event);
          handleHover(event);
        }}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onWheel={handleWheel}
      />
    </div>
  );
}
