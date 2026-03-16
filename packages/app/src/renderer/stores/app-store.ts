import { create } from 'zustand'

interface AppState {
  editMode: boolean
  toggleEditMode: () => void

  contentView: 'live' | 'files'
  setContentView: (v: 'live' | 'files') => void

  editorTool: 'claude' | 'nocode'
  setEditorTool: (t: 'claude' | 'nocode') => void

  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void

  selectedWidgetId: string | null
  selectWidget: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  editMode: false,
  toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),

  contentView: 'live',
  setContentView: (v) => set({ contentView: v }),

  editorTool: 'claude',
  setEditorTool: (t) => set({ editorTool: t }),

  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),

  selectedWidgetId: null,
  selectWidget: (id) => set({ selectedWidgetId: id }),
}))
