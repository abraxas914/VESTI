export const SIDEPANEL_NAVIGATION_KEY = "vesti_sidepanel_navigation"

export type SidepanelRoute =
  | "/dashboard"
  | "/insights"
  | "/data"
  | "/settings"

export interface SidepanelNavigationRequest {
  type: "NAVIGATE_SIDEPANEL"
  route: SidepanelRoute
  requestedAt: number
}

const NAVIGATION_TTL_MS = 2 * 60 * 1000

function writeRequest(request: SidepanelNavigationRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [SIDEPANEL_NAVIGATION_KEY]: request }, () => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve()
    })
  })
}

export async function navigateSidepanel(route: SidepanelRoute): Promise<void> {
  const request: SidepanelNavigationRequest = {
    type: "NAVIGATE_SIDEPANEL",
    route,
    requestedAt: Date.now()
  }
  await writeRequest(request)

  chrome.runtime.sendMessage(
    { type: "NAVIGATE_SIDEPANEL", route },
    () => void chrome.runtime.lastError
  )
}

export async function consumeSidepanelNavigation(): Promise<SidepanelRoute | null> {
  const stored = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      chrome.storage.local.get([SIDEPANEL_NAVIGATION_KEY], (result) => {
        const error = chrome.runtime.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        resolve(result)
      })
    }
  )
  await new Promise<void>((resolve) => {
    chrome.storage.local.remove([SIDEPANEL_NAVIGATION_KEY], () => resolve())
  })

  const request = stored[
    SIDEPANEL_NAVIGATION_KEY
  ] as Partial<SidepanelNavigationRequest> | null
  if (
    !request ||
    request.type !== "NAVIGATE_SIDEPANEL" ||
    typeof request.requestedAt !== "number" ||
    Date.now() - request.requestedAt > NAVIGATION_TTL_MS
  ) {
    return null
  }

  return isSidepanelRoute(request.route) ? request.route : null
}

export function isSidepanelRoute(value: unknown): value is SidepanelRoute {
  return (
    value === "/dashboard" ||
    value === "/insights" ||
    value === "/data" ||
    value === "/settings"
  )
}
