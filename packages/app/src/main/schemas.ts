import { z } from 'zod'

// ── Theme ──

export const ThemeSchema = z
  .object({
    background: z.string().default('#0a0a0a'),
    accent: z.string().default('#7c3aed'),
  })
  .passthrough()

// ── Widget Manifest ──

export const WidgetInputSchema = z.object({
  key: z.string(),
  type: z.string(),
  default: z.any().optional(),
})

export const WidgetOutputSchema = z.object({
  key: z.string(),
  type: z.string(),
})

export const WidgetPropSchema = z.object({
  key: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'select']),
  options: z.array(z.string()).optional(),
  default: z.any().optional(),
  label: z.string(),
})

export const WidgetManifestSchema = z.object({
  id: z.string(),
  type: z.enum(['custom', 'webportal', 'terminal']),
  title: z.string(),
  capabilities: z.array(z.string()).default([]),
  allowedHosts: z.array(z.string()).optional(),
  allowedWsHosts: z.array(z.string()).optional(),
  envKeys: z.array(z.string()).optional(),
  url: z.string().optional(), // default URL for webportal widgets
  inputs: z.array(WidgetInputSchema).optional(),
  outputs: z.array(WidgetOutputSchema).optional(),
  props: z.array(WidgetPropSchema).optional(),
})

// ── Bounds ──

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
})

// ── Widget Entry (in scene meta) ──
// `id` is a ULID — unique per instance. Two copies of the same widget get different IDs.
// `widgetType` is the human-readable name from widget.manifest.json (e.g. "weather-widget").
// `manifestPath` points to the manifest file within the scene folder.

export const WidgetEntrySchema = z.object({
  id: z.string(),           // ULID instance ID — unique even if same widget placed twice
  widgetType: z.string(),   // human-readable type from manifest (e.g. "test-widget")
  manifestPath: z.string(), // relative path to widget.manifest.json within the scene
  bounds: BoundsSchema,
  props: z.record(z.any()).optional(),
})

// ── Scene Meta ──

export const SceneMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  theme: ThemeSchema.optional(),
  widgets: z.array(WidgetEntrySchema).default([]),
})

// ── Dimension Meta ──

export const DimensionMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenes: z.array(z.string()),
  theme: ThemeSchema.optional(),
  sharedEnvKeys: z.array(z.string()).optional(),
})

// ── Connections (dataflow wiring) ──

export const ConnectionSchema = z.object({
  from: z.object({ widgetId: z.string(), output: z.string() }),
  to: z.object({ widgetId: z.string(), input: z.string() }),
})

export const ConnectionsFileSchema = z.array(ConnectionSchema).default([])

// ── Portal Rules ──

export const PortalRuleSchema = z.object({
  domain: z.string(),
  css: z.string(),
  label: z.string(),
  enabled: z.boolean().default(true),
})

// ── Inferred types ──

export type SceneMeta = z.infer<typeof SceneMetaSchema>
export type WidgetManifest = z.infer<typeof WidgetManifestSchema>
export type WidgetEntry = z.infer<typeof WidgetEntrySchema>
export type Bounds = z.infer<typeof BoundsSchema>
export type Theme = z.infer<typeof ThemeSchema>
export type DimensionMeta = z.infer<typeof DimensionMetaSchema>
export type Connection = z.infer<typeof ConnectionSchema>
export type PortalRule = z.infer<typeof PortalRuleSchema>
