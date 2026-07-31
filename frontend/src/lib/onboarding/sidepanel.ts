export function openOnboardingSidePanel(): Promise<boolean> {
  if (!chrome.sidePanel?.open) {
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") })
    return Promise.resolve(false)
  }

  // Keep both calls in the original click tick. Waiting for setOptions would
  // consume the user gesture required by sidePanel.open().
  chrome.sidePanel.setOptions(
    { path: "sidepanel.html", enabled: true },
    () => void chrome.runtime.lastError
  )

  return new Promise((resolve) => {
    chrome.sidePanel.open(
      { windowId: chrome.windows.WINDOW_ID_CURRENT },
      () => {
        const error = chrome.runtime.lastError
        if (error) {
          chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") })
          resolve(false)
          return
        }
        resolve(true)
      }
    )
  })
}
