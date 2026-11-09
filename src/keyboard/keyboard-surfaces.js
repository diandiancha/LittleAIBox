export const KEYBOARD_INTERACTIVE_SELECTOR =
    'button, a, input, textarea, [contenteditable="true"]';

const surfaces = new Set();
const unregisterListeners = new Set();

export function registerKeyboardSurface({
    root,
    inputSelector,
    ignoreSelector = '',
    touchMoveSelector = '',
    onWillChange = null,
    onChanged = null,
    onGeometryChange = null
} = {}) {
    if (!root || !inputSelector) return () => {};

    const surface = {
        root,
        inputSelector,
        ignoreSelector,
        touchMoveSelector,
        onWillChange,
        onChanged,
        onGeometryChange
    };
    surfaces.add(surface);
    return () => {
        if (!surfaces.delete(surface)) return;
        unregisterListeners.forEach((listener) => listener(surface));
    };
}

export function onKeyboardSurfaceUnregistered(listener) {
    unregisterListeners.add(listener);
    return () => unregisterListeners.delete(listener);
}

export function getKeyboardSurfaceForTarget(target) {
    if (!(target instanceof Element)) return null;

    let bestSurface = null;
    let bestDepth = -1;
    for (const surface of surfaces) {
        if (!surface.root.isConnected || !surface.root.contains(target)) continue;
        if (!target.closest(surface.inputSelector)) continue;

        /*
         * root 在文档中的深度越大，就越可能是嵌套 surface 中最内层的那个。
         * 这等价于在所有命中 target 的 surface 里选择最具体的 root。
         */
        let depth = 0;
        for (let node = surface.root; node; node = node.parentElement) depth += 1;
        if (depth > bestDepth) {
            bestSurface = surface;
            bestDepth = depth;
        }
    }
    return bestSurface;
}

export function getActiveKeyboardSurface() {
    return getKeyboardSurfaceForTarget(document.activeElement);
}

export function shouldIgnoreKeyboardDismiss(surface, target) {
    if (!surface || !(target instanceof Element)) return true;
    const selector = surface.ignoreSelector
        ? `${KEYBOARD_INTERACTIVE_SELECTOR}, ${surface.ignoreSelector}`
        : KEYBOARD_INTERACTIVE_SELECTOR;
    return !!target.closest(selector);
}

export function notifyKeyboardSurfaceScroll(container) {
    if (!container?.isConnected) return;
    container.dispatchEvent(new Event('scroll'));
}
