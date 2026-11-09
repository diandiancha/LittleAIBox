import {
    getActiveKeyboardSurface,
    onKeyboardSurfaceUnregistered,
    shouldIgnoreKeyboardDismiss
} from './keyboard-surfaces.js';

export const KEYBOARD_OPEN_THRESHOLD = 80;
export const KEYBOARD_CLOSE_THRESHOLD = 40;
export const KEYBOARD_LAYOUT_SETTLE_MS = 320;

export function createKeyboardSession({
    compensatesInCss,
    emitWillChange,
    emitChanged,
    onSurfaceUnregistered = null
}) {
    let activeSurface = null;
    let openState = false;
    let appliedGeometrySize = null;
    let appliedGeometryOffset = null;

    const adopt = (surface, { fallbackToCurrent = false } = {}) => {
        if (surface) activeSurface = surface;
        else if (!fallbackToCurrent) activeSurface = null;
        return activeSurface;
    };

    const getSurface = () => getActiveKeyboardSurface() || activeSurface;

    const release = () => {
        activeSurface = null;
    };

    const releaseIf = (surface) => {
        if (activeSurface === surface) activeSurface = null;
    };

    const setGeometry = (size = 0, offsetTop = 0) => {
        const root = document.documentElement;
        const measured = compensatesInCss ? Math.max(0, size) : 0;
        const measuredOffset = compensatesInCss
            ? Math.max(0, offsetTop)
            : 0;
        if (measured === appliedGeometrySize &&
            measuredOffset === appliedGeometryOffset) {
            return;
        }
        appliedGeometrySize = measured;
        appliedGeometryOffset = measuredOffset;
        root.style.setProperty(
            '--keyboard-height',
            `${measured}px`
        );
        root.style.setProperty(
            '--visual-viewport-offset-top',
            `${measuredOffset}px`
        );
    };

    const setOpenState = (open) => {
        if (openState === open) return;
        openState = open;
        document.documentElement.classList.toggle('keyboard-is-open', open);
        document.body.classList.toggle('keyboard-is-open', open);
    };

    const willChange = (phase, size = 0, surface = getSurface()) => {
        if (surface) emitWillChange(surface, { phase, size });
        return surface;
    };

    const changed = (phase, size = 0, surface = getSurface()) => {
        if (surface) emitChanged(surface, { phase, size });
    };

    const blur = (surface = getSurface()) => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !surface) return;
        if (surface.root.contains(active) &&
            active.closest(surface.inputSelector)) {
            active.blur();
        }
    };

    const shouldDismiss = (event, surface = getSurface()) => {
        return !!surface && !shouldIgnoreKeyboardDismiss(surface, event.target);
    };

    const stopUnregister = onKeyboardSurfaceUnregistered((surface) => {
        onSurfaceUnregistered?.(surface);
        if (activeSurface !== surface) return;
        releaseIf(surface);
        setGeometry(0, 0);
        setOpenState(false);
    });

    const destroy = () => {
        stopUnregister();
        activeSurface = null;
        setGeometry(0, 0);
        setOpenState(false);
    };

    return {
        adopt,
        getSurface,
        release,
        releaseIf,
        setGeometry,
        setOpenState,
        willChange,
        changed,
        blur,
        shouldDismiss,
        destroy
    };
}
