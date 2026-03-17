import { create } from 'zustand'

interface SceneInfo {
  id: string
  slug: string
  title: string
  path: string
  dimensionId: string | null
  dimensionTitle?: string | null
  dimensionScenes?: string[] | null
  widgets: any[]
  theme?: { background: string; accent: string; [key: string]: string }
  layoutMode?: 'canvas' | 'layout'
  viewport?: { width: number; height: number }
}

interface AppState {
  editMode: boolean
  toggleEditMode: () => void
  setEditMode: (v: boolean) => void

  contentView: 'live' | 'files'
  setContentView: (v: 'live' | 'files') => void

  editorTool: 'claude' | 'nocode'
  setEditorTool: (t: 'claude' | 'nocode') => void

  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void

  currentScene: SceneInfo | null
  setCurrentScene: (s: SceneInfo | null) => void

  selectedWidgetId: string | null
  selectWidget: (id: string | null) => void

  buildStatus: string
  setBuildStatus: (s: string) => void

  sceneSidebarOpen: boolean
  setSceneSidebarOpen: (v: boolean) => void

  sceneSidebarWidth: number
  setSceneSidebarWidth: (w: number) => void

  editorPanelWidth: number
  setEditorPanelWidth: (w: number) => void

  openFilePath: string | null
  setOpenFilePath: (p: string | null) => void

  layoutMode: 'canvas' | 'layout'
  setLayoutMode: (m: 'canvas' | 'layout') => void

  scaleMode: 'fit' | 'original'
  setScaleMode: (m: 'fit' | 'original') => void

  zoom: number
  setZoom: (z: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  editMode: false,
  toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),
  setEditMode: (v) => set({ editMode: v }),

  contentView: 'live',
  setContentView: (v) => set({ contentView: v }),

  editorTool: 'claude',
  setEditorTool: (t) => set({ editorTool: t }),

  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),

  currentScene: null,
  setCurrentScene: (s) => set({ currentScene: s }),

  selectedWidgetId: null,
  selectWidget: (id) => set({ selectedWidgetId: id }),

  buildStatus: '',
  setBuildStatus: (s) => set({ buildStatus: s }),

  sceneSidebarOpen: false,
  setSceneSidebarOpen: (v) => set({ sceneSidebarOpen: v }),

  sceneSidebarWidth: 280,
  setSceneSidebarWidth: (w) => set({ sceneSidebarWidth: w }),

  editorPanelWidth: 420,
  setEditorPanelWidth: (w) => set({ editorPanelWidth: w }),

  openFilePath: null,
  setOpenFilePath: (p) => set({ openFilePath: p }),

  layoutMode: 'canvas',
  setLayoutMode: (m) => set({ layoutMode: m }),

  scaleMode: 'fit',
  setScaleMode: (m) => set({ scaleMode: m }),

  zoom: 1,
  setZoom: (z) => set({ zoom: z }),
}))
