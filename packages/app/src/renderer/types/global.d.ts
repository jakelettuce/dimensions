export {}

declare global {
  interface Window {
    dimensions: {
      platform: string
      navigateTo: (url: string) => Promise<any>
      getCurrentScene: () => Promise<any>
      toggleEditMode: () => Promise<boolean>
      paletteClose: () => Promise<void>
      toggleWcvVisibility: (visible: boolean) => Promise<void>
      onEditModeChange: (cb: (editing: boolean) => void) => void
      onWidgetBuildStatus: (cb: (status: { widgetId: string; success: boolean; error?: string }) => void) => void
      onAppNavigate: (cb: (route: string) => void) => void
      onWidgetSelect: (cb: (widgetId: string) => void) => void
      listScenes: () => Promise<any>
      listDimensions: () => Promise<any>
      readDir: (dirPath: string) => Promise<any>
      readFile: (filePath: string) => Promise<any>
      writeFile: (filePath: string, content: string) => Promise<any>
      getEnvKeys: () => Promise<any>
      setEnvVar: (key: string, value: string) => Promise<any>
      deleteEnvVar: (key: string) => Promise<any>
      createTerminal: (scenePath: string) => Promise<string>
      destroyTerminal: (id: string) => Promise<void>
      sendTerminalInput: (id: string, data: string) => void
      resizeTerminal: (id: string, cols: number, rows: number) => void
      onTerminalOutput: (id: string, cb: (data: string) => void) => void
      removeTerminalOutputListener: (id: string) => void
      // Scene & dimension creation
      createScene: (title: string, dimensionPath?: string) => Promise<{ scenePath: string } | { error: string }>
      createDimension: (title: string) => Promise<{ dimensionPath: string; firstScenePath: string } | { error: string }>
      // Global shortcut messages from main process
      onOpenPalette: (cb: () => void) => void
      onSetEditorTool: (cb: (tool: string) => void) => void
      onNavigateBack: (cb: () => void) => void
      onNavigateForward: (cb: () => void) => void
      onToggleContentView: (cb: () => void) => void
      onFocusTerminal: (cb: () => void) => void
      onOpenNewScenePrompt: (cb: () => void) => void
      onOpenSettings: (cb: () => void) => void
      onSceneChanged: (cb: (scene: any) => void) => void
      onSceneSidebarChange: (cb: (open: boolean) => void) => void
      updatePanelWidths: (sidebarWidth: number, editorWidth: number) => Promise<void>
      // Widget props
      setWidgetProp: (widgetId: string, key: string, value: unknown) => Promise<any>
      resetWidgetProp: (widgetId: string, key: string) => Promise<any>
      hideWcvs: () => Promise<void>
      showWcvs: () => Promise<void>
      // Media library
      addMedia: (options?: { accept?: string[]; multiple?: boolean }) => Promise<{ urls: string[] } | { error: string }>
      listMedia: (accept?: string[]) => Promise<any[]>
      deleteMedia: (filename: string) => Promise<any>
      // Downloads
      acceptDownload: (downloadId: string, filename?: string) => Promise<any>
      acceptDownloadToMedia: (downloadId: string, filename?: string) => Promise<any>
      cancelDownload: (downloadId: string) => Promise<any>
      getDownloadFolder: () => Promise<string>
      chooseDownloadFolder: () => Promise<string | null>
      onDownloadConfirm: (cb: (data: { downloadId: string; filename: string; fileSize: number; sourceUrl: string; mimeType: string }) => void) => void
      onDownloadComplete: (cb: (data: { downloadId: string; state: string; savePath: string | null; filename: string; mediaUrl?: string; savedToMedia?: boolean }) => void) => void
      onDownloadTimeout: (cb: (data: { downloadId: string }) => void) => void
      onWidgetPropsUpdated: (cb: (data: { widgetId: string; props: Record<string, any> }) => void) => void
      // Scale mode
      setScaleMode: (mode: string) => Promise<void>
      onScaleModeChange: (cb: (mode: string) => void) => void
      // Zoom
      onZoomChange: (cb: (zoom: number) => void) => void
      // Scene updated
      onSceneUpdated: (cb: (scene: any) => void) => void
    }
  }
}
