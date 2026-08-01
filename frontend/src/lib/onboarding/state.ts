export const ONBOARDING_STATE_KEY = "vesti_onboarding_state"
export const HAS_SEEN_ONBOARDING_KEY = "hasSeenOnboarding"
export const ONBOARDING_STEP_COMPLETED_KEY = "onboardingStepCompleted"
export const HAS_CLEANED_MOCK_DATA_KEY = "hasCleanedMockData"
export const ONBOARDING_HANDOFF_KEY = "vesti_onboarding_handoff"

export const ONBOARDING_SCHEMA_VERSION = 3 as const

export const ONBOARDING_FEATURES = [
  "deepseek",
  "dashboard",
  "explore",
  "aiti",
  "learn",
  "roundtable",
  "insights"
] as const

export const ONBOARDING_FEATURE_FINAL_STEP: Record<OnboardingFeature, number> =
  {
    deepseek: 2,
    dashboard: 4,
    explore: 3,
    aiti: 2,
    learn: 2,
    roundtable: 2,
    insights: 2
  }

export type OnboardingFeature = (typeof ONBOARDING_FEATURES)[number]
export type OnboardingCompletion =
  | "quick_start"
  | "skip"
  | "legacy_migration"

export type OnboardingStepCompleted = Record<OnboardingFeature, boolean>
export type OnboardingGuideSteps = Record<OnboardingFeature, number>

export interface OnboardingState {
  schemaVersion: typeof ONBOARDING_SCHEMA_VERSION
  anonymousUserId: string
  hasSeenOnboarding: boolean
  tourStarted: boolean
  onboardingStepCompleted: OnboardingStepCompleted
  guideSteps: OnboardingGuideSteps
  hasCleanedMockData: boolean
  installedAt: number
  updatedAt: number
  completedAt: number | null
  completedVia: OnboardingCompletion | null
}

export interface OnboardingHandoff {
  conversationId: number | null
  status: "captured" | "no_supported_tab" | "capture_unavailable"
  createdAt: number
}

export type OnboardingDestination =
  | "sidepanel"
  | "final"
  | "tour"
  | "welcome"

interface StoredOnboardingEnvelope {
  [ONBOARDING_STATE_KEY]?: unknown
  [HAS_SEEN_ONBOARDING_KEY]?: unknown
  [ONBOARDING_STEP_COMPLETED_KEY]?: unknown
  [HAS_CLEANED_MOCK_DATA_KEY]?: unknown
  [ONBOARDING_HANDOFF_KEY]?: unknown
}

function resolveStorage(): chrome.storage.StorageArea {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    throw new Error("ONBOARDING_STORAGE_UNAVAILABLE")
  }
  return chrome.storage.local
}

function readStorage(keys: string[]): Promise<StoredOnboardingEnvelope> {
  const storage = resolveStorage()
  return new Promise((resolve, reject) => {
    storage.get(keys, (result: StoredOnboardingEnvelope) => {
      const error = chrome.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(result)
    })
  })
}

function writeStorage(payload: Record<string, unknown>): Promise<void> {
  const storage = resolveStorage()
  return new Promise((resolve, reject) => {
    storage.set(payload, () => {
      const error = chrome.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve()
    })
  })
}

function removeStorage(keys: string[]): Promise<void> {
  const storage = resolveStorage()
  return new Promise((resolve, reject) => {
    storage.remove(keys, () => {
      const error = chrome.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve()
    })
  })
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function completionFrom(value: unknown): OnboardingCompletion | null {
  if (value === "setup") return "quick_start"
  return value === "quick_start" ||
    value === "skip" ||
    value === "legacy_migration"
    ? value
    : null
}

function createAnonymousUserId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  const randomPart = Math.random().toString(36).slice(2)
  return `anon-${Date.now().toString(36)}-${randomPart}`
}

export function createEmptyStepCompletion(): OnboardingStepCompleted {
  return {
    deepseek: false,
    dashboard: false,
    explore: false,
    aiti: false,
    learn: false,
    roundtable: false,
    insights: false
  }
}

export function createEmptyGuideSteps(): OnboardingGuideSteps {
  return {
    deepseek: 0,
    dashboard: 0,
    explore: 0,
    aiti: 0,
    learn: 0,
    roundtable: 0,
    insights: 0
  }
}

function normalizeStepCompletion(value: unknown): OnboardingStepCompleted {
  const source =
    value && typeof value === "object"
      ? (value as Partial<OnboardingStepCompleted>)
      : {}
  return {
    deepseek: source.deepseek === true,
    dashboard: source.dashboard === true,
    explore: source.explore === true,
    aiti: source.aiti === true,
    learn: source.learn === true,
    roundtable: source.roundtable === true,
    insights: source.insights === true
  }
}

function normalizeGuideSteps(value: unknown): OnboardingGuideSteps {
  const source =
    value && typeof value === "object"
      ? (value as Partial<OnboardingGuideSteps>)
      : {}
  const normalized = createEmptyGuideSteps()
  for (const feature of ONBOARDING_FEATURES) {
    const step = source[feature]
    normalized[feature] =
      typeof step === "number" && Number.isInteger(step) && step >= 0
        ? step
        : 0
  }
  return normalized
}

export function hasCompletedOnboardingTour(
  value: OnboardingStepCompleted
): boolean {
  return ONBOARDING_FEATURES.every((feature) => value[feature])
}

export function createInitialOnboardingState(
  now = Date.now(),
  anonymousUserId = createAnonymousUserId()
): OnboardingState {
  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    anonymousUserId,
    hasSeenOnboarding: false,
    tourStarted: false,
    onboardingStepCompleted: createEmptyStepCompletion(),
    guideSteps: createEmptyGuideSteps(),
    hasCleanedMockData: false,
    installedAt: now,
    updatedAt: now,
    completedAt: null,
    completedVia: null
  }
}

export function normalizeOnboardingState(
  bundledValue: unknown,
  compatibilitySeen?: unknown,
  compatibilityCompleted?: unknown,
  compatibilityCleaned?: unknown,
  now = Date.now()
): OnboardingState {
  const source =
    bundledValue && typeof bundledValue === "object"
      ? (bundledValue as Partial<OnboardingState>)
      : {}
  const fallback = createInitialOnboardingState(now)
  const hasSeen =
    typeof compatibilitySeen === "boolean"
      ? compatibilitySeen
      : Boolean(source.hasSeenOnboarding)
  const onboardingStepCompleted = normalizeStepCompletion(
    typeof compatibilityCompleted === "undefined"
      ? source.onboardingStepCompleted
      : compatibilityCompleted
  )
  const anonymousUserId =
    typeof source.anonymousUserId === "string" &&
    source.anonymousUserId.trim().length > 0
      ? source.anonymousUserId.trim()
      : fallback.anonymousUserId
  const installedAt = finiteTimestamp(source.installedAt, now)

  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    anonymousUserId,
    hasSeenOnboarding: hasSeen,
    tourStarted: hasSeen ? false : source.tourStarted === true,
    onboardingStepCompleted,
    guideSteps: normalizeGuideSteps(source.guideSteps),
    hasCleanedMockData:
      typeof compatibilityCleaned === "boolean"
        ? compatibilityCleaned
        : source.hasCleanedMockData === true,
    installedAt,
    updatedAt: finiteTimestamp(source.updatedAt, now),
    completedAt: hasSeen ? finiteTimestamp(source.completedAt, now) : null,
    completedVia: hasSeen ? completionFrom(source.completedVia) : null
  }
}

export function resolveOnboardingDestination(
  state: Pick<
    OnboardingState,
    "hasSeenOnboarding" | "tourStarted" | "onboardingStepCompleted"
  >
): OnboardingDestination {
  if (state.hasSeenOnboarding) return "sidepanel"
  if (hasCompletedOnboardingTour(state.onboardingStepCompleted)) return "final"
  return state.tourStarted ? "tour" : "welcome"
}

export function getFirstIncompleteFeature(
  completed: OnboardingStepCompleted
): OnboardingFeature | null {
  return ONBOARDING_FEATURES.find((feature) => !completed[feature]) ?? null
}

async function persistState(state: OnboardingState): Promise<OnboardingState> {
  const normalized = normalizeOnboardingState(
    state,
    state.hasSeenOnboarding,
    state.onboardingStepCompleted,
    state.hasCleanedMockData,
    state.updatedAt
  )
  await writeStorage({
    [ONBOARDING_STATE_KEY]: normalized,
    [HAS_SEEN_ONBOARDING_KEY]: normalized.hasSeenOnboarding,
    [ONBOARDING_STEP_COMPLETED_KEY]: normalized.onboardingStepCompleted,
    [HAS_CLEANED_MOCK_DATA_KEY]: normalized.hasCleanedMockData
  })
  return normalized
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const result = await readStorage([
    ONBOARDING_STATE_KEY,
    HAS_SEEN_ONBOARDING_KEY,
    ONBOARDING_STEP_COMPLETED_KEY,
    HAS_CLEANED_MOCK_DATA_KEY
  ])
  return normalizeOnboardingState(
    result[ONBOARDING_STATE_KEY],
    result[HAS_SEEN_ONBOARDING_KEY],
    result[ONBOARDING_STEP_COMPLETED_KEY],
    result[HAS_CLEANED_MOCK_DATA_KEY]
  )
}

export async function initializeFreshInstall(
  now = Date.now()
): Promise<OnboardingState> {
  const current = await getOnboardingState()
  const state: OnboardingState = {
    ...createInitialOnboardingState(now, current.anonymousUserId),
    installedAt: now
  }
  await removeStorage([ONBOARDING_HANDOFF_KEY])
  return persistState(state)
}

export async function migrateOnExtensionUpdate(
  now = Date.now()
): Promise<OnboardingState> {
  const raw = await readStorage([
    ONBOARDING_STATE_KEY,
    HAS_SEEN_ONBOARDING_KEY,
    ONBOARDING_STEP_COMPLETED_KEY,
    HAS_CLEANED_MOCK_DATA_KEY
  ])
  const hadExplicitState =
    typeof raw[HAS_SEEN_ONBOARDING_KEY] === "boolean" ||
    (raw[ONBOARDING_STATE_KEY] !== null &&
      typeof raw[ONBOARDING_STATE_KEY] === "object")
  const current = normalizeOnboardingState(
    raw[ONBOARDING_STATE_KEY],
    raw[HAS_SEEN_ONBOARDING_KEY],
    raw[ONBOARDING_STEP_COMPLETED_KEY],
    raw[HAS_CLEANED_MOCK_DATA_KEY],
    now
  )

  if (hadExplicitState) {
    return persistState({ ...current, updatedAt: now })
  }

  return persistState({
    ...current,
    hasSeenOnboarding: true,
    updatedAt: now,
    completedAt: now,
    completedVia: "legacy_migration"
  })
}

export async function startOnboardingTour(
  now = Date.now()
): Promise<OnboardingState> {
  const current = await getOnboardingState()
  if (current.hasSeenOnboarding) return current
  return persistState({
    ...current,
    tourStarted: true,
    updatedAt: now
  })
}

export async function updateOnboardingGuideProgress(
  feature: OnboardingFeature,
  options: { step?: number; completed?: boolean },
  now = Date.now()
): Promise<OnboardingState> {
  const current = await getOnboardingState()
  if (current.hasSeenOnboarding) return current
  const requestedStep =
    typeof options.step === "number" &&
    Number.isInteger(options.step) &&
    options.step >= 0
      ? Math.min(options.step, ONBOARDING_FEATURE_FINAL_STEP[feature])
      : current.guideSteps[feature]
  const nextStep = Math.max(current.guideSteps[feature], requestedStep)

  return persistState({
    ...current,
    tourStarted: true,
    onboardingStepCompleted: {
      ...current.onboardingStepCompleted,
      [feature]:
        current.onboardingStepCompleted[feature] || options.completed === true
    },
    guideSteps: {
      ...current.guideSteps,
      [feature]: nextStep
    },
    updatedAt: now
  })
}

export async function completeOnboarding(
  completedVia: Exclude<OnboardingCompletion, "legacy_migration">,
  options: { hasCleanedMockData?: boolean } = {},
  now = Date.now()
): Promise<OnboardingState> {
  const current = await getOnboardingState()
  return persistState({
    ...current,
    hasSeenOnboarding: true,
    tourStarted: false,
    hasCleanedMockData:
      typeof options.hasCleanedMockData === "boolean"
        ? options.hasCleanedMockData
        : current.hasCleanedMockData,
    updatedAt: now,
    completedAt: current.completedAt ?? now,
    completedVia: current.completedVia ?? completedVia
  })
}

export async function saveOnboardingHandoff(
  handoff: Omit<OnboardingHandoff, "createdAt">,
  now = Date.now()
): Promise<void> {
  await writeStorage({
    [ONBOARDING_HANDOFF_KEY]: { ...handoff, createdAt: now }
  })
}

export async function consumeOnboardingHandoff(): Promise<OnboardingHandoff | null> {
  const result = await readStorage([ONBOARDING_HANDOFF_KEY])
  const raw = result[ONBOARDING_HANDOFF_KEY]
  await removeStorage([ONBOARDING_HANDOFF_KEY])

  if (!raw || typeof raw !== "object") return null
  const candidate = raw as Partial<OnboardingHandoff>
  const status =
    candidate.status === "captured" ||
    candidate.status === "no_supported_tab" ||
    candidate.status === "capture_unavailable"
      ? candidate.status
      : null
  if (!status) return null

  return {
    status,
    conversationId:
      typeof candidate.conversationId === "number" &&
      Number.isFinite(candidate.conversationId)
        ? candidate.conversationId
        : null,
    createdAt: finiteTimestamp(candidate.createdAt, Date.now())
  }
}
