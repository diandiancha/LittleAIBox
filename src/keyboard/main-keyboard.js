import { createKeyboardController } from './keyboard-controller.js';
import { registerKeyboardSurface } from './keyboard-surfaces.js';

// Adapt the shared keyboard drivers to this release's existing chat/scroll API.
export function setupMainKeyboard({ root, scrollContainer, scrollManager }) {
    if (!root) return () => {};
    let anchor = null;
    let disposed = false;
    let restoreFrame = null;

    const capture = () => {
        if (!scrollContainer) return null;
        return {
            top: scrollContainer.scrollTop,
            pinned: scrollManager.getDistanceToBottom() <= scrollManager.bottomStrictThreshold,
            userScrollAt: scrollManager.lastUserScrollAt
        };
    };
    const restore = (snapshot) => {
        if (disposed || !snapshot || !scrollContainer?.isConnected) return;
        if (snapshot.userScrollAt !== scrollManager.lastUserScrollAt) return;
        scrollManager.setAutoScrollTop(snapshot.pinned
            ? Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
            : snapshot.top);
    };
    const unregister = registerKeyboardSurface({
        root,
        inputSelector: '#message-input',
        ignoreSelector: '.input-wrapper, .input-outer-wrapper, #chat-container',
        touchMoveSelector: '#chat-container, .input-wrapper, .input-outer-wrapper, .canvas-drawer, .canvas-drawer-code, .canvas-code-scroll, .canvas-drawer-preview',
        onWillChange: () => { anchor = capture(); },
        onChanged: () => {
            restore(anchor);
            anchor = null;
        },
        onGeometryChange: (commit) => {
            const snapshot = capture();
            commit();
            if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
            restoreFrame = requestAnimationFrame(() => {
                restoreFrame = null;
                restore(snapshot);
            });
        }
    });
    const controller = createKeyboardController();
    controller.init();

    return () => {
        disposed = true;
        if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
        controller.destroy();
        unregister();
    };
}
