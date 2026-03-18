import type { DimensionsSDK } from './types'

export function createMockSDK(overrides?: Partial<DimensionsSDK>): DimensionsSDK {
  return {
    scene: {
      id: () => 'mock-scene',
      title: () => 'Mock Scene',
    },
    kv: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      list: async () => [],
    },
    assets: {
      upload: async () => 'dimensions-asset://mock/asset.png',
      resolve: async () => '',
      list: async () => [],
    },
    fetch: async () => ({ status: 200, headers: {}, body: '' }),
    ws: {
      connect: async () => ({
        send: () => {},
        on: () => {},
        close: () => {},
      }),
    },
    env: {
      get: async () => null,
    },
    secrets: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    },
    editing: {
      setWidgetBounds: async () => {},
      getWidgetBounds: async () => ({ x: 0, y: 0, width: 100, height: 100 }),
      selectWidget: async () => {},
    },
    emit: () => {},
    on: () => {},
    navigate: {
      to: () => {},
      back: () => {},
      forward: () => {},
      next: () => {},
      previous: () => {},
    },
    theme: {
      get: async () => ({ background: '#0a0a0a', accent: '#7c3aed' }),
      onChange: () => {},
    },
    portal: {
      navigate: async () => {},
      goBack: async () => {},
      goForward: async () => {},
      reload: async () => {},
      stop: async () => {},
      injectCSS: async () => {},
      removeCSS: async () => {},
      setVisible: async () => {},
      newTab: async () => 'mock-tab',
      closeTab: async () => {},
      switchTab: async () => {},
      getState: async () => ({ url: '', title: '', isLoading: false, canGoBack: false, canGoForward: false, isPlayingAudio: false, activeTabId: 'mock-tab', tabs: [] }),
      onStateChange: () => {},
    },
    clipboard: {
      read: async () => '',
      write: async () => {},
    },
    notify: async () => {},
    media: {
      onDrop: () => {},
      importDrop: async () => '',
      importFromUrl: async () => '',
      startDrag: async () => {},
    },
    onShortcut: () => {},
    props: {
      get: async () => undefined,
      getAll: async () => ({}),
      onChange: () => {},
      onAnyChange: () => {},
    },
    ...overrides,
  }
}
