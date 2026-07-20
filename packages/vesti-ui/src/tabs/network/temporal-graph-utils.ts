import type { Conversation, Platform, UiThemeMode } from "../../types";

export const DAY_MS = 86_400_000;
export const GRAPH_FONT_FAMILY =
  '"Inter", "SF Pro Text", -apple-system, "PingFang SC", sans-serif';
export const GRAPH_HEIGHT = 420;
export const TIMEBAR_HEIGHT = 72;
export const TIMEBAR_HORIZONTAL_PADDING = 12;
export const TIMEBAR_CHART_TOP = 8;
export const TIMEBAR_CHART_HEIGHT = 42;
export const TIMEBAR_TICK_Y = 66;

export interface GraphNode {
  id: number;
  /** "conversation" = one captured talk; "cluster" = an aggregated stand-in
   * for `memberIds` when the graph exceeds the node budget. Cluster ids are
   * negative so they never collide with conversation ids. */
  kind: "conversation" | "cluster";
  label: string;
  platform: Platform;
  /** Semantic bucket this node belongs to (e.g. "platform:Claude",
   * "topic:12", "project:vesti"). Drives color + cluster aggregation. */
  groupKey: string;
  day: number;
  timelineDay: number;
  messageCount: number;
  originAt: number;
  firstCapturedAt: number;
  lastCapturedAt: number;
  createdAt: number;
  radius: number;
  color: string;
  /** Cluster only: conversation ids folded into this node. */
  memberIds?: number[];
  /** Cluster only: member count (== memberIds.length). */
  memberCount?: number;
}

export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
}

export type NetworkGroupBy = "platform" | "topic" | "project";

export interface NetworkGroupInfo {
  key: string;
  label: string;
  color: string;
  count: number;
}

/** Minimal structural shape the network tab needs from a conversation digest
 * (APP's ConversationDigest satisfies it; the extension passes nothing). */
export interface DigestGroupHint {
  projectKey?: string | null;
  projectLabel?: string | null;
}

export interface BuildTemporalNetworkOptions {
  /** conversationId → group key. Defaults to `platform:<platform>`. */
  groupKeyById?: Map<number, string>;
  /** group key → color. Defaults to the platform palette. */
  groupColorByKey?: Map<string, string>;
  /** Node budget. Above this, chronological same-group runs collapse into
   * cluster nodes. Pass `Infinity` to disable clustering. */
  maxNodes?: number;
  /** Edge budget; strongest edges by weight survive. */
  maxEdges?: number;
}

/** Node budget for the temporal graph — beyond ~260 nodes the hairball is
 * both slow to lay out and unreadable, so we aggregate. */
export const DEFAULT_MAX_NODES = 260;
/** Edge budget — canvas stays fluid and the strongest links are the ones
 * that matter. */
export const DEFAULT_MAX_EDGES = 900;

/** Categorical palette for topic/project groups (matches the thinking-map
 * cluster palette so both views speak the same color language). */
export const GROUP_PALETTE = [
  "#7F77DD",
  "#1D9E75",
  "#D85A30",
  "#378ADD",
  "#D4537E",
  "#BA7517",
  "#639922",
  "#5DCAA5",
];

export interface NetworkData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalDays: number;
}

export interface TemporalNetworkDataset {
  data: NetworkData;
  dayCounts: number[];
  newestNodeByDay: Map<number, GraphNode>;
}

export const GRAPH_PLATFORM_COLORS: Record<Platform, string> = {
  ChatGPT: "#4a90d9",
  Claude: "#bf7b3a",
  Gemini: "#5c6bc0",
  DeepSeek: "#2979c0",
  Qwen: "#C026D3",
  Doubao: "#1E6FFF",
  Kimi: "#181C28",
  Yuanbao: "#00C5A3",
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export function truncateLabel(label: string, maxLength = 18) {
  const normalized = label.trim() || "Untitled";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

export function getNodeRadius(messageCount: number) {
  const safeCount = Math.max(0, Number.isFinite(messageCount) ? messageCount : 0);
  return clamp(10 + Math.log(safeCount + 1) * 3, 10, 22);
}

export function getNodeAlpha(node: GraphNode, currentDay: number) {
  if (node.timelineDay > currentDay) return 0;
  const age = currentDay - node.timelineDay;
  return Math.max(0.15, 0.2 + 0.8 * sigmoid(3 - age * 0.6));
}

export function getEdgeAlpha(
  edge: GraphEdge,
  sourceNode: GraphNode,
  targetNode: GraphNode,
  currentDay: number
) {
  const latestDay = Math.max(sourceNode.timelineDay, targetNode.timelineDay);
  if (latestDay > currentDay) return 0;
  const edgeAge = currentDay - latestDay;
  return edge.weight * Math.max(0.08, 0.15 + 0.6 * sigmoid(2.5 - edgeAge * 0.55));
}

export function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getDisplayDay(currentDay: number, totalDays: number) {
  if (totalDays <= 0) return 0;
  return clamp(Math.ceil(currentDay) || 1, 1, totalDays);
}

export function getVisibleConversationCount(nodes: GraphNode[], currentDay: number) {
  return nodes.reduce((count, node) => count + (node.timelineDay <= currentDay ? 1 : 0), 0);
}

export function getGraphEdgeStroke(themeMode: UiThemeMode, alpha: number) {
  const rgb = themeMode === "dark" ? "180, 178, 168" : "100, 98, 90";
  return `rgba(${rgb}, ${alpha})`;
}

export function getGraphLabelFill(themeMode: UiThemeMode, alpha: number) {
  const rgb = themeMode === "dark" ? "200, 198, 190" : "65, 63, 58";
  return `rgba(${rgb}, ${alpha})`;
}

export function getTimebarMetrics(width: number, totalDays: number) {
  const safeWidth = Math.max(0, width);
  const usableWidth = Math.max(0, safeWidth - TIMEBAR_HORIZONTAL_PADDING * 2);
  const dayWidth = totalDays > 0 ? usableWidth / totalDays : 0;
  return {
    usableWidth,
    dayWidth,
    chartTop: TIMEBAR_CHART_TOP,
    chartHeight: TIMEBAR_CHART_HEIGHT,
    chartBottom: TIMEBAR_CHART_TOP + TIMEBAR_CHART_HEIGHT,
    tickY: TIMEBAR_TICK_Y,
  };
}

export function dayToPixel(day: number, totalDays: number, width: number) {
  if (totalDays <= 0) return TIMEBAR_HORIZONTAL_PADDING;
  const { usableWidth } = getTimebarMetrics(width, totalDays);
  const x = TIMEBAR_HORIZONTAL_PADDING + ((day - 0.5) / totalDays) * usableWidth;
  return clamp(x, TIMEBAR_HORIZONTAL_PADDING, TIMEBAR_HORIZONTAL_PADDING + usableWidth);
}

export function pixelToDay(x: number, totalDays: number, width: number) {
  if (totalDays <= 0) return 0;
  const { usableWidth } = getTimebarMetrics(width, totalDays);
  if (usableWidth <= 0) return 0;
  const fraction = clamp((x - TIMEBAR_HORIZONTAL_PADDING) / usableWidth, 0, 1);
  return fraction * totalDays;
}

export function timelineToPixel(day: number, totalDays: number, width: number) {
  if (totalDays <= 0) return TIMEBAR_HORIZONTAL_PADDING;
  const { usableWidth } = getTimebarMetrics(width, totalDays);
  const fraction = clamp(day / totalDays, 0, 1);
  return TIMEBAR_HORIZONTAL_PADDING + fraction * usableWidth;
}

export function dayToProgress(day: number, totalDays: number) {
  if (totalDays <= 0) return 0;
  return clamp(day / totalDays, 0, 1);
}

export function progressToDay(progress: number, totalDays: number) {
  if (totalDays <= 0) return 0;
  return clamp(progress, 0, 1) * totalDays;
}

export function getTrendPointY(
  count: number,
  maxCount: number,
  chartTop: number,
  chartHeight: number
) {
  const normalized = maxCount > 0 ? count / maxCount : 0;
  const visibleHeight = normalized > 0 ? Math.max(4, normalized * chartHeight) : 2;
  return chartTop + chartHeight - visibleHeight;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function getConversationSourceCreatedAt(conversation: Conversation) {
  return isFiniteTimestamp(conversation.source_created_at)
    ? conversation.source_created_at
    : null;
}

export function getConversationFirstCapturedAt(conversation: Conversation) {
  return isFiniteTimestamp(conversation.first_captured_at)
    ? conversation.first_captured_at
    : conversation.created_at;
}

export function getConversationLastCapturedAt(conversation: Conversation) {
  return isFiniteTimestamp(conversation.last_captured_at)
    ? conversation.last_captured_at
    : conversation.updated_at;
}

export function getConversationOriginAt(conversation: Conversation) {
  return (
    getConversationSourceCreatedAt(conversation) ??
    getConversationFirstCapturedAt(conversation)
  );
}

/**
 * Assign every live conversation to a semantic group (platform / topic /
 * project) and return the group metadata (label/color/count) for legends,
 * cluster tooltips and the group-by switcher. Deterministic: groups are
 * ranked by member count (desc), then label, so palette assignment is stable
 * across renders.
 */
export function buildNetworkGroups(
  conversations: Conversation[],
  groupBy: NetworkGroupBy,
  options: {
    topicNameById?: Map<number, string>;
    digestById?: Map<number, DigestGroupHint>;
    otherLabel?: string;
  } = {}
): { groupKeyById: Map<number, string>; groups: NetworkGroupInfo[] } {
  const otherLabel = options.otherLabel ?? "Other";
  const groupKeyById = new Map<number, string>();
  const countByKey = new Map<string, number>();
  const labelByKey = new Map<string, string>();

  for (const conversation of conversations) {
    if (conversation.is_archived || conversation.is_trash) continue;

    let key: string;
    let label: string;
    if (groupBy === "topic") {
      const topicId = conversation.topic_id;
      if (topicId === null || topicId === undefined) {
        key = "topic:none";
        label = otherLabel;
      } else {
        key = `topic:${topicId}`;
        label = options.topicNameById?.get(topicId) ?? `#${topicId}`;
      }
    } else if (groupBy === "project") {
      const digest = options.digestById?.get(conversation.id);
      if (digest?.projectKey) {
        key = `project:${digest.projectKey}`;
        label = digest.projectLabel?.trim() || digest.projectKey;
      } else {
        key = "project:none";
        label = otherLabel;
      }
    } else {
      key = `platform:${conversation.platform}`;
      label = String(conversation.platform);
    }

    groupKeyById.set(conversation.id, key);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    if (!labelByKey.has(key)) labelByKey.set(key, label);
  }

  const orderedKeys = [...countByKey.keys()].sort((a, b) => {
    const countDelta = (countByKey.get(b) ?? 0) - (countByKey.get(a) ?? 0);
    if (countDelta !== 0) return countDelta;
    return (labelByKey.get(a) ?? a).localeCompare(labelByKey.get(b) ?? b);
  });

  let paletteIndex = 0;
  const groups = orderedKeys.map<NetworkGroupInfo>((key) => {
    let color: string;
    if (key.startsWith("platform:")) {
      color =
        GRAPH_PLATFORM_COLORS[key.slice("platform:".length) as Platform] ??
        GROUP_PALETTE[paletteIndex++ % GROUP_PALETTE.length];
    } else {
      color = GROUP_PALETTE[paletteIndex++ % GROUP_PALETTE.length];
    }
    return {
      key,
      label: labelByKey.get(key) ?? key,
      color,
      count: countByKey.get(key) ?? 0,
    };
  });

  return { groupKeyById, groups };
}

function compareConversationChronology(left: Conversation, right: Conversation) {
  const leftOriginAt = getConversationOriginAt(left);
  const rightOriginAt = getConversationOriginAt(right);
  if (leftOriginAt !== rightOriginAt) {
    return leftOriginAt - rightOriginAt;
  }

  const leftFirstCapturedAt = getConversationFirstCapturedAt(left);
  const rightFirstCapturedAt = getConversationFirstCapturedAt(right);
  if (leftFirstCapturedAt !== rightFirstCapturedAt) {
    return leftFirstCapturedAt - rightFirstCapturedAt;
  }

  if (left.created_at !== right.created_at) {
    return left.created_at - right.created_at;
  }

  return left.id - right.id;
}

function compareGraphNodeChronology(left: GraphNode, right: GraphNode) {
  if (left.originAt !== right.originAt) {
    return left.originAt - right.originAt;
  }

  if (left.firstCapturedAt !== right.firstCapturedAt) {
    return left.firstCapturedAt - right.firstCapturedAt;
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }

  return left.id - right.id;
}

function getClusterRadius(memberCount: number) {
  return clamp(11 + Math.sqrt(memberCount) * 3.2, 13, 30);
}

function getDominantPlatform(members: GraphNode[]): Platform {
  const countByPlatform = new Map<Platform, number>();
  for (const member of members) {
    countByPlatform.set(
      member.platform,
      (countByPlatform.get(member.platform) ?? 0) + 1
    );
  }
  let dominant = members[0]?.platform ?? ("ChatGPT" as Platform);
  let best = -1;
  for (const [platform, count] of countByPlatform) {
    if (count > best) {
      best = count;
      dominant = platform;
    }
  }
  return dominant;
}

/**
 * Collapse a chronologically sorted node list into cluster nodes when it
 * exceeds `maxNodes`. Consecutive nodes sharing a groupKey fold together (at
 * most `chunkSize` per cluster), so a cluster reads as "N talks from the same
 * project/topic/platform around this period". Deterministic.
 */
export function aggregateNodesIntoClusters(
  nodes: GraphNode[],
  maxNodes: number
): GraphNode[] {
  if (!Number.isFinite(maxNodes) || nodes.length <= maxNodes || nodes.length === 0) {
    return nodes;
  }

  const chunkSize = Math.ceil(nodes.length / maxNodes);
  const clustered: GraphNode[] = [];
  let members: GraphNode[] = [];

  const flush = () => {
    if (members.length === 0) return;
    if (members.length === 1) {
      clustered.push(members[0]);
      members = [];
      return;
    }
    const memberCount = members.length;
    const latest = members[memberCount - 1];
    clustered.push({
      id: -(clustered.length + 1),
      kind: "cluster",
      label: `×${memberCount}`,
      platform: getDominantPlatform(members),
      groupKey: latest.groupKey,
      day: latest.day,
      timelineDay: latest.timelineDay,
      messageCount: members.reduce((sum, member) => sum + member.messageCount, 0),
      originAt: members[0].originAt,
      firstCapturedAt: members[0].firstCapturedAt,
      lastCapturedAt: latest.lastCapturedAt,
      createdAt: members[0].createdAt,
      radius: getClusterRadius(memberCount),
      color: latest.color,
      memberIds: members.map((member) => member.id),
      memberCount,
    });
    members = [];
  };

  for (const node of nodes) {
    if (members.length > 0 && members[0].groupKey !== node.groupKey) {
      flush();
    }
    members.push(node);
    if (members.length >= chunkSize) {
      flush();
    }
  }
  flush();

  return clustered;
}

/**
 * Remap raw conversation→conversation edges onto the (possibly clustered)
 * node set: endpoints resolve through cluster membership, intra-cluster
 * edges drop, duplicate pairs keep their strongest weight, and the result is
 * capped to the `maxEdges` strongest links.
 */
export function remapAndCapEdges(
  edges: GraphEdge[],
  nodes: GraphNode[],
  maxEdges: number
): GraphEdge[] {
  const finalIdByRawId = new Map<number, number>();
  for (const node of nodes) {
    if (node.kind === "cluster" && node.memberIds) {
      for (const memberId of node.memberIds) {
        finalIdByRawId.set(memberId, node.id);
      }
    } else {
      finalIdByRawId.set(node.id, node.id);
    }
  }

  const weightByPair = new Map<string, { source: number; target: number; weight: number }>();
  for (const edge of edges) {
    if (edge.weight < 0.4) continue;
    const source = finalIdByRawId.get(edge.source);
    const target = finalIdByRawId.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    const [a, b] = source < target ? [source, target] : [target, source];
    const pairKey = `${a}|${b}`;
    const existing = weightByPair.get(pairKey);
    if (!existing || edge.weight > existing.weight) {
      weightByPair.set(pairKey, { source: a, target: b, weight: edge.weight });
    }
  }

  const remapped = [...weightByPair.values()];
  if (remapped.length > maxEdges) {
    remapped.sort((left, right) => right.weight - left.weight || left.source - right.source || left.target - right.target);
    return remapped.slice(0, maxEdges);
  }
  return remapped;
}

export function buildTemporalNetworkDataset(
  conversations: Conversation[],
  edges: GraphEdge[],
  options: BuildTemporalNetworkOptions = {}
): TemporalNetworkDataset {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxEdges = options.maxEdges ?? DEFAULT_MAX_EDGES;

  const sortedConversations = conversations
    .filter((conversation) => !conversation.is_archived && !conversation.is_trash)
    .slice()
    .sort(compareConversationChronology);

  if (sortedConversations.length === 0) {
    return {
      data: { nodes: [], edges: [], totalDays: 0 },
      dayCounts: [0],
      newestNodeByDay: new Map<number, GraphNode>(),
    };
  }

  const firstTimestamp = getConversationOriginAt(sortedConversations[0]);
  const rawNodes = sortedConversations.map<GraphNode>((conversation) => {
    const originAt = getConversationOriginAt(conversation);
    const firstCapturedAt = getConversationFirstCapturedAt(conversation);
    const lastCapturedAt = getConversationLastCapturedAt(conversation);
    const day =
      Math.floor(Math.max(0, originAt - firstTimestamp) / DAY_MS) + 1;
    const messageCount =
      typeof conversation.message_count === "number" && Number.isFinite(conversation.message_count)
        ? Math.max(0, Math.floor(conversation.message_count))
        : 0;
    const groupKey =
      options.groupKeyById?.get(conversation.id) ?? `platform:${conversation.platform}`;

    return {
      id: conversation.id,
      kind: "conversation",
      label: conversation.title.trim() || "Untitled",
      platform: conversation.platform,
      groupKey,
      day,
      timelineDay: day,
      messageCount,
      originAt,
      firstCapturedAt,
      lastCapturedAt,
      createdAt: conversation.created_at,
      radius: getNodeRadius(messageCount),
      color:
        options.groupColorByKey?.get(groupKey) ??
        GRAPH_PLATFORM_COLORS[conversation.platform],
    };
  });

  const totalDays = rawNodes[rawNodes.length - 1]?.day ?? 0;
  const dayCounts = Array.from({ length: totalDays + 1 }, () => 0);
  const newestNodeByDay = new Map<number, GraphNode>();
  const nodesPerDay = new Map<number, number>();
  const seenPerDay = new Map<number, number>();

  for (const node of rawNodes) {
    nodesPerDay.set(node.day, (nodesPerDay.get(node.day) ?? 0) + 1);
  }

  for (const node of rawNodes) {
    const dayCount = nodesPerDay.get(node.day) ?? 1;
    const dayIndex = (seenPerDay.get(node.day) ?? 0) + 1;
    seenPerDay.set(node.day, dayIndex);
    node.timelineDay =
      dayCount <= 1 ? node.day : node.day - 1 + dayIndex / dayCount;

    dayCounts[node.day] += 1;
    const existing = newestNodeByDay.get(node.day);
    if (!existing || compareGraphNodeChronology(node, existing) > 0) {
      newestNodeByDay.set(node.day, node);
    }
  }

  const nodes = aggregateNodesIntoClusters(rawNodes, maxNodes);
  const filteredEdges = remapAndCapEdges(edges, nodes, maxEdges);

  return {
    data: {
      nodes,
      edges: filteredEdges,
      totalDays,
    },
    dayCounts,
    newestNodeByDay,
  };
}

export function hitTestNode<
  T extends { timelineDay: number; x: number; y: number; radius: number }
>(
  nodes: T[],
  x: number,
  y: number,
  currentDay: number
) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.timelineDay > currentDay) continue;
    const dx = x - node.x;
    const dy = y - node.y;
    if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
      return node;
    }
  }

  return null;
}
