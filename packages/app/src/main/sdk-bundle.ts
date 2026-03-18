import * as esbuild from 'esbuild'
import path from 'path'
import fs from 'fs'

let cachedSdkBundle: string | null = null

// Build the SDK runtime into a single IIFE string that can be injected into widget iframes.
// Cached after first build since the SDK doesn't change at runtime.
export async function getSdkBundle(): Promise<string> {
  if (cachedSdkBundle) return cachedSdkBundle

  const sdkEntry = path.resolve(__dirname, '../../packages/sdk/src/index.ts')

  // In development, the SDK source is available. In production, use pre-built.
  // Try to find the SDK source relative to the app
  const possiblePaths = [
    path.resolve(__dirname, '../../../sdk/src/index.ts'),  // dev: out/main -> packages/sdk/src
    path.resolve(__dirname, '../../../../packages/sdk/src/index.ts'), // alt dev path
  ]

  let entryPath: string | null = null
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      entryPath = p
      break
    }
  }

  if (!entryPath) {
    // Fallback: build a minimal context-reader inline
    cachedSdkBundle = getInlineSdkBootstrap()
    return cachedSdkBundle
  }

  try {
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'iife',
      globalName: '__DimensionsSDKModule',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'warning',
    })

    if (result.outputFiles && result.outputFiles.length > 0) {
      // The IIFE assigns to __DimensionsSDKModule. Extract `sdk` and assign to window.
      cachedSdkBundle = result.outputFiles[0].text + '\nwindow.sdk = __DimensionsSDKModule.sdk || __DimensionsSDKModule.default;\n'
      return cachedSdkBundle
    }
  } catch (err) {
    console.error('Failed to build SDK bundle:', err)
  }

  cachedSdkBundle = getInlineSdkBootstrap()
  return cachedSdkBundle
}

// Minimal inline SDK bootstrap that reads context from URL params
// and sets up the postMessage bridge. Used as fallback.
function getInlineSdkBootstrap(): string {
  return `
(function() {
  var params = new URLSearchParams(window.location.search);
  var propsRaw = params.get('props');
  window.__DIMENSIONS_CONTEXT__ = {
    widgetId: params.get('widgetId') || '',
    sceneId: params.get('sceneId') || '',
    sceneTitle: decodeURIComponent(params.get('sceneTitle') || ''),
    props: propsRaw ? JSON.parse(decodeURIComponent(propsRaw)) : {},
  };
})();
`
}

// Small script injected before the SDK to read context from URL search params
export function getContextInjectionScript(): string {
  return `<script>
(function() {
  var params = new URLSearchParams(window.location.search);
  var propsRaw = params.get('props');
  window.__DIMENSIONS_CONTEXT__ = {
    widgetId: params.get('widgetId') || '',
    sceneId: params.get('sceneId') || '',
    sceneTitle: decodeURIComponent(params.get('sceneTitle') || ''),
    props: propsRaw ? JSON.parse(decodeURIComponent(propsRaw)) : {},
  };
})();
</script>`
}
