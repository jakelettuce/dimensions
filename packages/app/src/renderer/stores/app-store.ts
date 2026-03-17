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

  openFilePath: string | null
  setOpenFilePath: (p: string | null) => void
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

  openFilePath: null,
  setOpenFilePath: (p) => set({ openFilePath: p }),
}))
