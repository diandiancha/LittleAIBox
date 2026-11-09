import { getActiveKeyboardSurface } from '../../keyboard-surfaces.js';

export function createViewportReader({ getVirtualKeyboard }) {
    return (reason, virtualKeyboardEventCount = 0) => {
        const viewport = window.visualViewport;
        const keyboardRect = getVirtualKeyboard()?.boundingRect;

        return {
            reason,
            viewportHeight: viewport?.height || window.innerHeight || 1,
            viewportTop: viewport?.offsetTop || 0,
            innerHeight: window.innerHeight || 1,
            clientHeight: document.documentElement.clientHeight || 1,
            width: window.innerWidth || 1,
            keyboardFocused: Boolean(getActiveKeyboardSurface()),
            virtualKeyboardHeight: keyboardRect?.height || 0,
            virtualKeyboardY: keyboardRect?.y || 0,
            virtualKeyboardEventCount
        };
    };
}
