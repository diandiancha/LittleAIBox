import { createStreamRenderRuntime } from './stream-render-runtime.js';

// Keep the public snapshot's callers while using the complete project's runtime.
export function createStreamImageRuntime(deps = {}) {
    const runtime = createStreamRenderRuntime({
        ...deps,
        getIsRenderSurfaceVisible: deps.getIsRenderSurfaceVisible || deps.getIsPageVisible
    });
    return {
        ...runtime,
        normalizeStreamImageParts: runtime.normalizeStreamParts,
        normalizeStreamImagePlacement: runtime.normalizeStreamPlacement,
        normalizeStreamImageLayout: runtime.normalizeStreamLayout,
        syncStreamImageAttachments: runtime.syncStreamAttachments,
        clearPendingImagePlaceholdersInChatContainer: runtime.clearPendingPlaceholdersInChatContainer
    };
}
