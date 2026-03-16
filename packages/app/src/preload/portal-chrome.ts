import { contextBridge, ipcRenderer } from 'electron'

// The portalId is passed as a URL search param on the chrome HTML
const params = new URLSearchParams(window.location.search)
const portalId = params.get('portalId') || ''

contextBridge.exposeInMainWorld('portalChrome', {
  portalId,
  navigate: (url: string) => ipcRenderer.invoke('portal:navigate', portalId, url),
  goBack: () => ipcRenderer.invoke('portal:goBack', portalId),
  goForward: () => ipcRenderer.invoke('portal:goForward', portalId),
  reload: () => ipcRenderer.invoke('portal:reload', portalId),
  stop: () => ipcRenderer.invoke('portal:stop', portalId),
  newTab: (url?: string) => ipcRenderer.invoke('portal:newTab', portalId, url),
  closeTab: (tabId: string) => ipcRenderer.invoke('portal:closeTab', portalId, tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke('portal:switchTab', portalId, tabId),
  // Main process sends navigation/tab state updates
  onNavigationUpdate: (cb: (state: any) => void) => {
    ipcRenderer.on('portal:navUpdate', (_e, state) => cb(state))
  },
  onTabsUpdate: (cb: (tabs: any[]) => void) => {
    ipcRenderer.on('portal:tabsUpdate', (_e, tabs) => cb(tabs))
  },
})
