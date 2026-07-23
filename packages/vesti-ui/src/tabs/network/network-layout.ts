"use client";

import type { GraphEdge, GraphNode } from "./temporal-graph-utils";
import { clamp, truncateLabel } from "./temporal-graph-utils";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RELAXATION_ITERATIONS = 64;
const VIRTUAL_WIDTH_MULTIPLIER = 2.2;
const VIRTUAL_HEIGHT_MULTIPLIER = 1.72;

export interface LayoutAnchor {
  anchorX: number;
  anchorY: number;
  labelHalfWidth: number;
  horizontalFootprint: number;
  verticalFootprint: number;
  collisionRadius: number;
}

interface LayoutBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface LayoutNodeState extends LayoutAnchor {
  radius: number;
  color: string;
  label: string;
  originAt: number;
  firstCapturedAt: number;
  lastCapturedAt: number;
  createdAt: number;
  day: number;
  timelineDay: number;
  messageCount: number;
  platform: GraphNode["platform"];
  id: number;
  componentId: number;
  componentCenterX: number;
  componentCenterY: number;
  componentPull: number;
  x: number;
  y: number;
}

interface ComponentInfo {
  id: number;
  nodeIds: number[];
  nodeCount: number;
  totalWeight: number;
  earliestOriginAt: number;
  minId: number;
  maxCollisionRadius: number;
}

interface Slot {
  centerX: number;
  centerY: number;
  cellWidth: number;
  cellHeight: number;
}

function buildComponentSubslots(
  slot: Slot,
  componentNodeCount: number,
  maxCollisionRadius: number
) {
  const subslotCount =
    componentNodeCount >= 10
      ? Math.min(8, Math.max(3, Math.ceil(componentNodeCount / 4)))
      : componentNodeCount >= 6
        ? 2
        : 1;

  if (subslotCount <= 1) {
    return [
      {
        centerX: slot.centerX,
        centerY: slot.centerY,
      },
    ];
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(subslotCount)));
  const rows = Math.max(1, Math.ceil(subslotCount / columns));
  const spreadX = Math.min(
    slot.cellWidth * 0.82,
    Math.max(columns * maxCollisionRadius * 3.3, slot.cellWidth * 0.36)
  );
  const spreadY = Math.min(
    slot.cellHeight * 0.74,
    Math.max(rows * maxCollisionRadius * 3.05, slot.cellHeight * 0.3)
  );
  const originX = slot.centerX - spreadX / 2;
  const originY = slot.centerY - spreadY / 2;
  const cellWidth = spreadX / columns;
  const cellHeight = spreadY / rows;
  const subslots: Array<{ centerX: number; centerY: number; row: number; column: number }> = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      subslots.push({
        centerX: originX + cellWidth * (column + 0.5),
        centerY: originY + cellHeight * (row + 0.5),
        row,
        column,
      });
    }
  }

  subslots.sort((left, right) => {
    const leftDistance =
      (left.centerX - slot.centerX) * (left.centerX - slot.centerX) +
      (left.centerY - slot.centerY) * (left.centerY - slot.centerY);
    const rightDistance =
      (right.centerX - slot.centerX) * (right.centerX - slot.centerX) +
      (right.centerY - slot.centerY) * (right.centerY - slot.centerY);
    return (
      compareNumbers(leftDistance, rightDistance) ||
      compareNumbers(left.row, right.row) ||
      compareNumbers(left.column, right.column)
    );
  });

  return subslots.slice(0, subslotCount);
}

function getLabelHalfWidth(label: string, width: number) {
  return Math.min(
    Math.max(width * 0.2, 60),
    Math.max(34, truncateLabel(label, 18).length * 3.4)
  );
}

function buildNodeAnchorMetrics(node: GraphNode, width: number): LayoutAnchor {
  const labelHalfWidth = getLabelHalfWidth(node.label, width);
  return {
    anchorX: 0,
    anchorY: 0,
    labelHalfWidth,
    horizontalFootprint: Math.max(node.radius + 24, labelHalfWidth + 14),
    verticalFootprint: node.radius + 42,
    collisionRadius: Math.max(node.radius + 18, labelHalfWidth * 0.8),
  };
}

function buildLayoutBounds(
  nodes: GraphNode[],
  metricsById: Map<number, LayoutAnchor>,
  width: number,
  height: number
): LayoutBounds {
  const centerX = width / 2;
  const centerY = height / 2 + 8;
  const maxHorizontalFootprint = nodes.reduce(
    (value, node) =>
      Math.max(value, metricsById.get(node.id)?.horizontalFootprint ?? node.radius + 16),
    0
  );
  const maxVerticalFootprint = nodes.reduce(
    (value, node) =>
      Math.max(value, metricsById.get(node.id)?.verticalFootprint ?? node.radius + 32),
    0
  );
  const virtualWidth = Math.max(width + 160, width * VIRTUAL_WIDTH_MULTIPLIER);
  const virtualHeight = Math.max(height + 120, height * VIRTUAL_HEIGHT_MULTIPLIER);
  const left = centerX - virtualWidth / 2 + maxHorizontalFootprint;
  const right = centerX + virtualWidth / 2 - maxHorizontalFootprint;
  const top = centerY - virtualHeight / 2 + maxVerticalFootprint * 0.62;
  const bottom = centerY + virtualHeight / 2 - maxVerticalFootprint * 0.88;

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(96, right - left),
    height: Math.max(96, bottom - top),
  };
}

function compareNumbers(left: number, right: number) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function buildConnectedComponents(
  nodes: GraphNode[],
  edges: GraphEdge[],
  metricsById: Map<number, LayoutAnchor>
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<number, number[]>();
  const weightedDegree = new Map<number, number>();

  nodes.forEach((node) => {
    adjacency.set(node.id, []);
    weightedDegree.set(node.id, 0);
  });

  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
    weightedDegree.set(edge.source, (weightedDegree.get(edge.source) ?? 0) + edge.weight);
    weightedDegree.set(edge.target, (weightedDegree.get(edge.target) ?? 0) + edge.weight);
  });

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<number>();
  const components: ComponentInfo[] = [];
  const componentIndexByNodeId = new Map<number, number>();

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    const queue = [node.id];
    const componentNodeIds: number[] = [];
    visited.add(node.id);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      componentNodeIds.push(currentId);
      const neighbors = adjacency.get(currentId) ?? [];
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }

    const componentIndex = components.length;
    for (const nodeId of componentNodeIds) {
      componentIndexByNodeId.set(nodeId, componentIndex);
    }

    const componentNodes = componentNodeIds
      .map((id) => nodesById.get(id))
      .filter((entry): entry is GraphNode => Boolean(entry));

    components.push({
      id: node.id,
      nodeIds: componentNodeIds,
      nodeCount: componentNodeIds.length,
      totalWeight: 0,
      earliestOriginAt: Math.min(...componentNodes.map((entry) => entry.originAt)),
      minId: Math.min(...componentNodeIds),
      maxCollisionRadius: Math.max(
        ...componentNodeIds.map((id) => metricsById.get(id)?.collisionRadius ?? 22)
      ),
    });
  }

  // Single pass over edges to weight each component (was O(components × edges)).
  for (const edge of edges) {
    const componentIndex = componentIndexByNodeId.get(edge.source);
    if (componentIndex === undefined) continue;
    if (componentIndexByNodeId.get(edge.target) !== componentIndex) continue;
    components[componentIndex].totalWeight += edge.weight;
  }

  components.sort((left, right) => {
    return (
      compareNumbers(right.totalWeight, left.totalWeight) ||
      compareNumbers(right.nodeCount, left.nodeCount) ||
      compareNumbers(left.earliestOriginAt, right.earliestOriginAt) ||
      compareNumbers(left.minId, right.minId)
    );
  });

  return {
    components,
    weightedDegree,
  };
}

function buildSlots(componentCount: number, bounds: LayoutBounds): Slot[] {
  if (componentCount <= 0) return [];

  const aspectRatio = bounds.width / Math.max(bounds.height, 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(componentCount * aspectRatio)));
  const rows = Math.max(1, Math.ceil(componentCount / columns));
  const cellWidth = bounds.width / columns;
  const cellHeight = bounds.height / rows;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;

  const slots: Array<Slot & { row: number; column: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push({
        row,
        column,
        centerX: bounds.left + cellWidth * (column + 0.5),
        centerY: bounds.top + cellHeight * (row + 0.5),
        cellWidth,
        cellHeight,
      });
    }
  }

  slots.sort((left, right) => {
    const leftDistance =
      (left.centerX - centerX) * (left.centerX - centerX) +
      (left.centerY - centerY) * (left.centerY - centerY);
    const rightDistance =
      (right.centerX - centerX) * (right.centerX - centerX) +
      (right.centerY - centerY) * (right.centerY - centerY);
    return (
      compareNumbers(leftDistance, rightDistance) ||
      compareNumbers(left.row, right.row) ||
      compareNumbers(left.column, right.column)
    );
  });

  const limited = slots.slice(0, componentCount);
  if (limited.length <= 1) return limited;

  const [centerSlot, ...outerSlots] = limited;
  outerSlots.sort((left, right) => {
    const leftDistance =
      (left.centerX - centerX) * (left.centerX - centerX) +
      (left.centerY - centerY) * (left.centerY - centerY);
    const rightDistance =
      (right.centerX - centerX) * (right.centerX - centerX) +
      (right.centerY - centerY) * (right.centerY - centerY);
    return (
      compareNumbers(rightDistance, leftDistance) ||
      compareNumbers(left.row, right.row) ||
      compareNumbers(left.column, right.column)
    );
  });

  return [centerSlot, ...outerSlots];
}

function clampStateToBounds(state: LayoutNodeState, bounds: LayoutBounds) {
  state.x = clamp(
    state.x,
    bounds.left + state.horizontalFootprint,
    bounds.right - state.horizontalFootprint
  );
  state.y = clamp(
    state.y,
    bounds.top + state.radius + 6,
    bounds.bottom - state.verticalFootprint
  );
}

function buildInitialStates(
  nodes: GraphNode[],
  components: ComponentInfo[],
  weightedDegree: Map<number, number>,
  metricsById: Map<number, LayoutAnchor>,
  bounds: LayoutBounds
) {
  const slots = buildSlots(components.length, bounds);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const states: LayoutNodeState[] = [];
  const totalNodeCount = nodes.length;
  const totalWeight = components.reduce((sum, component) => sum + component.totalWeight, 0);

  components.forEach((component, index) => {
    const fallbackSlot = slots[index] ?? {
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      cellWidth: bounds.width,
      cellHeight: bounds.height,
    };
    const isDominantComponent =
      index === 0 &&
      (component.nodeCount >= Math.max(8, Math.ceil(totalNodeCount * 0.42)) ||
        component.totalWeight >= totalWeight * 0.52);
    const slot = isDominantComponent
      ? {
          centerX: bounds.left + bounds.width / 2,
          centerY: bounds.top + bounds.height / 2,
          cellWidth: bounds.width * 0.9,
          cellHeight: bounds.height * 0.82,
        }
      : fallbackSlot;

    const componentNodes = component.nodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((entry): entry is GraphNode => Boolean(entry))
      .sort((left, right) => {
        return (
          compareNumbers(
            weightedDegree.get(right.id) ?? 0,
            weightedDegree.get(left.id) ?? 0
          ) ||
          compareNumbers(left.originAt, right.originAt) ||
          compareNumbers(left.id, right.id)
        );
      });

    const spacing = Math.max(
      component.maxCollisionRadius * (isDominantComponent ? 1.86 : 1.38),
      isDominantComponent ? 74 : 52
    );
    const flattenY = 0.92;
    const componentPull =
      (isDominantComponent ? 0.0065 : 0.012) /
      Math.max(1, Math.sqrt(component.nodeCount));
    const subslots = buildComponentSubslots(
      slot,
      component.nodeCount,
      component.maxCollisionRadius
    );

    componentNodes.forEach((node, nodeIndex) => {
      const metrics = metricsById.get(node.id)!;
      const subslot = subslots[nodeIndex % subslots.length] ?? {
        centerX: slot.centerX,
        centerY: slot.centerY,
      };
      const orbitIndex = Math.floor(nodeIndex / subslots.length);
      const radialDistance =
        orbitIndex === 0 ? 0 : Math.sqrt(orbitIndex) * spacing;
      const angle =
        orbitIndex === 0
          ? 0
          : orbitIndex * GOLDEN_ANGLE + (nodeIndex % subslots.length) * ((Math.PI * 2) / subslots.length);

      const state: LayoutNodeState = {
        ...node,
        ...metrics,
        componentId: component.id,
        componentCenterX: slot.centerX,
        componentCenterY: slot.centerY,
        componentPull,
        x: subslot.centerX + Math.cos(angle) * radialDistance,
        y: subslot.centerY + Math.sin(angle) * radialDistance * flattenY,
      };

      clampStateToBounds(state, bounds);
      states.push(state);
    });
  });

  return states;
}

function resolveFallbackVector(leftId: number, rightId: number) {
  const angle = ((leftId * 92821 + rightId * 68917) % 360) * (Math.PI / 180);
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function relaxStates(
  states: LayoutNodeState[],
  edges: GraphEdge[],
  bounds: LayoutBounds
) {
  const statesById = new Map(states.map((state) => [state.id, state]));

  // Uniform spatial grid: collision pairs only ever involve nearby nodes, so
  // bucket nodes per iteration and test 3×3 neighbor cells instead of all
  // O(n²) pairs. Cell size covers the largest possible interaction distance.
  const maxInteractionDistance =
    states.reduce((value, state) => Math.max(value, state.collisionRadius), 0) *
      2 +
    18;
  const cellSize = Math.max(32, maxInteractionDistance);

  for (let iteration = 0; iteration < RELAXATION_ITERATIONS; iteration += 1) {
    const displacement = new Map<number, { x: number; y: number }>();
    states.forEach((state) => {
      displacement.set(state.id, { x: 0, y: 0 });
    });

    const grid = new Map<string, number[]>();
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      const cellKey = `${Math.floor(state.x / cellSize)}|${Math.floor(state.y / cellSize)}`;
      const bucket = grid.get(cellKey);
      if (bucket) {
        bucket.push(index);
      } else {
        grid.set(cellKey, [index]);
      }
    }

    for (let leftIndex = 0; leftIndex < states.length; leftIndex += 1) {
      const leftState = states[leftIndex];
      const cellX = Math.floor(leftState.x / cellSize);
      const cellY = Math.floor(leftState.y / cellSize);

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const bucket = grid.get(`${cellX + offsetX}|${cellY + offsetY}`);
          if (!bucket) continue;

          for (const rightIndex of bucket) {
            if (rightIndex <= leftIndex) continue;
            const rightState = states[rightIndex];
            const dx = leftState.x - rightState.x;
            const dy = leftState.y - rightState.y;
            const minimumDistance =
              leftState.collisionRadius + rightState.collisionRadius + 18;
            // Cheap squared-distance reject before the hypot.
            if (
              dx * dx + dy * dy >=
              minimumDistance * minimumDistance
            ) {
              continue;
            }
            const distance = Math.hypot(dx, dy);

            const vector =
              distance > 0.001
                ? { x: dx / distance, y: dy / distance }
                : resolveFallbackVector(leftState.id, rightState.id);
            const overlap = minimumDistance - Math.max(distance, 0.001);
            const push = overlap * 0.48;

            const leftDisplacement = displacement.get(leftState.id)!;
            const rightDisplacement = displacement.get(rightState.id)!;

            leftDisplacement.x += vector.x * push;
            leftDisplacement.y += vector.y * push;
            rightDisplacement.x -= vector.x * push;
            rightDisplacement.y -= vector.y * push;
          }
        }
      }
    }

    edges.forEach((edge) => {
      const source = statesById.get(edge.source);
      const target = statesById.get(edge.target);
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const targetDistance = 96 + (1 - edge.weight) * 48;
      const difference = distance - targetDistance;
      const attraction = difference * 0.024 * edge.weight;

      const sourceDisplacement = displacement.get(source.id)!;
      const targetDisplacement = displacement.get(target.id)!;
      sourceDisplacement.x += (dx / distance) * attraction;
      sourceDisplacement.y += (dy / distance) * attraction;
      targetDisplacement.x -= (dx / distance) * attraction;
      targetDisplacement.y -= (dy / distance) * attraction;
    });

    const maxStep = Math.max(3.5, 14 - iteration * 0.18);

    states.forEach((state) => {
      const next = displacement.get(state.id)!;
      next.x += (state.componentCenterX - state.x) * state.componentPull;
      next.y += (state.componentCenterY - state.y) * (state.componentPull * 1.08);

      state.x += clamp(next.x, -maxStep, maxStep);
      state.y += clamp(next.y, -maxStep, maxStep);
      clampStateToBounds(state, bounds);
    });
  }
}

export function buildFixedAnchorLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number
) {
  if (nodes.length === 0 || width <= 0 || height <= 0) {
    return new Map<number, LayoutAnchor>();
  }

  const metricsById = new Map<number, LayoutAnchor>();
  nodes.forEach((node) => {
    metricsById.set(node.id, buildNodeAnchorMetrics(node, width));
  });

  const bounds = buildLayoutBounds(nodes, metricsById, width, height);
  const { components, weightedDegree } = buildConnectedComponents(nodes, edges, metricsById);
  const states = buildInitialStates(nodes, components, weightedDegree, metricsById, bounds);
  relaxStates(states, edges, bounds);

  return new Map(
    states.map((state) => [
      state.id,
      {
        anchorX: state.x,
        anchorY: state.y,
        labelHalfWidth: state.labelHalfWidth,
        horizontalFootprint: state.horizontalFootprint,
        verticalFootprint: state.verticalFootprint,
        collisionRadius: state.collisionRadius,
      },
    ])
  );
}
