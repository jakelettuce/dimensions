import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { ChevronRight, FileText, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface TreeNode extends DirEntry {
  children?: TreeNode[]
  expanded?: boolean
  loaded?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  html: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  svg: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? 'plaintext'
}

// ---------------------------------------------------------------------------
// File Tree Item
// ---------------------------------------------------------------------------

interface TreeItemProps {
  node: TreeNode
  depth: number
  selectedPath: string | null
  onSelect: (node: TreeNode) => void
  onToggle: (node: TreeNode) => void
}

function TreeItem({ node, depth, selectedPath, onSelect, onToggle }: TreeItemProps) {
  const isSelected = node.path === selectedPath

  return (
    <>
      <button
        type="button"
        onClick={() => (node.isDirectory ? onToggle(node) : onSelect(node))}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-xs',
          'hover:bg-white/5 transition-colors',
          isSelected && 'bg-white/10 text-white',
          !isSelected && 'text-[var(--text-secondary)]',
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {node.isDirectory ? (
          <ChevronRight
            size={14}
            className={cn(
              'shrink-0 transition-transform',
              node.expanded && 'rotate-90',
            )}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {node.isDirectory ? (
          <Folder size={14} className="shrink-0 text-[var(--accent)]" />
        ) : (
          <FileText size={14} className="shrink-0 text-[var(--text-tertiary)]" />
        )}

        <span className="truncate">{node.name}</span>
      </button>

      {node.isDirectory && node.expanded && node.children?.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// FilesView
// ---------------------------------------------------------------------------

interface FilesViewProps {
  scenePath: string
}

export function FilesView({ scenePath }: FilesViewProps) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [dirty, setDirty] = useState(false)

  const editorRef = useRef<any>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentPathRef = useRef<string | null>(null)

  // ---- load directory children ----
  const loadChildren = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const entries: DirEntry[] = await window.dimensions.readDir(dirPath)
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return sorted.map((e) => ({
      ...e,
      children: e.isDirectory ? [] : undefined,
      expanded: false,
      loaded: false,
    }))
  }, [])

  // ---- initial load ----
  useEffect(() => {
    let cancelled = false

    async function init() {
      const root = await loadChildren(scenePath)

      // Auto-expand the widgets folder
      for (const node of root) {
        if (node.isDirectory && node.name === 'widgets') {
          node.children = await loadChildren(node.path)
          node.expanded = true
          node.loaded = true
        }
      }

      if (!cancelled) setTree(root)
    }

    init()
    return () => { cancelled = true }
  }, [scenePath, loadChildren])

  // ---- toggle folder ----
  const toggleFolder = useCallback(async (target: TreeNode) => {
    async function toggle(nodes: TreeNode[]): Promise<TreeNode[]> {
      const result: TreeNode[] = []
      for (const node of nodes) {
        if (node.path === target.path) {
          const expanded = !node.expanded
          let children = node.children ?? []
          let loaded = node.loaded ?? false
          if (expanded && !loaded) {
            children = await loadChildren(node.path)
            loaded = true
          }
          result.push({ ...node, expanded, children, loaded })
        } else if (node.isDirectory && node.children) {
          result.push({ ...node, children: await toggle(node.children) })
        } else {
          result.push(node)
        }
      }
      return result
    }

    setTree(await toggle(tree))
  }, [tree, loadChildren])

  // ---- select file ----
  const selectFile = useCallback(async (node: TreeNode) => {
    if (node.isDirectory) return
    // Flush pending save for previous file
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      if (dirty && currentPathRef.current) {
        const val = editorRef.current?.getValue() ?? ''
        await window.dimensions.writeFile(currentPathRef.current, val)
      }
    }
    const content: string = await window.dimensions.readFile(node.path)
    currentPathRef.current = node.path
    setSelectedFile(node.path)
    setFileContent(content)
    setDirty(false)
  }, [dirty])

  // ---- save helper ----
  const saveFile = useCallback(async () => {
    if (!currentPathRef.current) return
    const val = editorRef.current?.getValue() ?? ''
    await window.dimensions.writeFile(currentPathRef.current, val)
    setDirty(false)
  }, [])

  // ---- editor onChange with debounce ----
  const handleEditorChange = useCallback(() => {
    setDirty(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveFile()
    }, 1000)
  }, [saveFile])

  // ---- Cmd+S handler ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveFile()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveFile])

  // ---- cleanup save timer on unmount ----
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // ---- editor mount ----
  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor
  }

  return (
    <div className="flex h-full w-full bg-[var(--bg-primary)]">
      {/* File tree panel */}
      <div
        className={cn(
          'flex h-full w-[250px] shrink-0 flex-col',
          'border-r border-white/10 bg-[var(--bg-secondary)]',
        )}
      >
        <div className="flex items-center px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Files
        </div>
        <div className="flex-1 overflow-y-auto px-1 pb-2">
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedFile}
              onSelect={selectFile}
              onToggle={toggleFolder}
            />
          ))}
        </div>
      </div>

      {/* Editor panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedFile ? (
          <>
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
              <span className="truncate font-mono text-xs text-[var(--text-secondary)]">
                {selectedFile.replace(scenePath + '/', '')}
              </span>
              {dirty && (
                <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                  (unsaved)
                </span>
              )}
            </div>
            <div className="flex-1">
              <Editor
                key={selectedFile}
                defaultValue={fileContent}
                language={langFromPath(selectedFile)}
                theme="vs-dark"
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 8 },
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  )
}
