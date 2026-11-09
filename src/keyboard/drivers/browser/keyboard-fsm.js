import { KEYBOARD_SOURCE } from './keyboard-source.js';

export const DEFAULT_CLOSE_CONFIRM_MS = 500;
export const VISUAL_CLOSE_CONFIRM_MS = 0;

export function getKeyboardCloseConfirmMs(sample) {
    return sample?.keyboardSource === KEYBOARD_SOURCE.VISUAL
        ? VISUAL_CLOSE_CONFIRM_MS
        : DEFAULT_CLOSE_CONFIRM_MS;
}

export function createKeyboardFsm({
    openThreshold,
    closeThreshold,
    closeConfirmMs = DEFAULT_CLOSE_CONFIRM_MS
}) {
    let state = 'closed';
    let pendingClose = false;
    let pendingCloseSince = 0;

    const clearPending = () => {
        pendingClose = false;
        pendingCloseSince = 0;
    };

    const settled = () => ({ transition: null, state, pendingClose: false });
    const holding = () => ({ transition: null, state, pendingClose: true });

    const step = (sample) => {
        const inset = sample.insetBottom;
        const keyboardExtent = Number.isFinite(sample.keyboardExtent)
            ? sample.keyboardExtent
            : inset;

        if (state === 'closed') {
            if (keyboardExtent <= openThreshold) return settled();
            if (!sample.keyboardFocused &&
                sample.keyboardSource !== KEYBOARD_SOURCE.VIRTUAL) {
                return settled();
            }
            state = 'open';
            clearPending();
            return { transition: 'open', state, pendingClose: false };
        }

        if (keyboardExtent > closeThreshold) {
            clearPending();
            return settled();
        }

        const at = Number.isFinite(sample.sampledAt) ? sample.sampledAt : null;
        const confirmMs = typeof closeConfirmMs === 'function'
            ? closeConfirmMs(sample)
            : closeConfirmMs;
        if (confirmMs <= 0) {
            clearPending();
            state = 'closed';
            return { transition: 'close', state, pendingClose: false };
        }

        if (!pendingClose) {
            pendingClose = true;
            pendingCloseSince = at ?? 0;
            return holding();
        }

        if (sample.reason !== 'c') {
            pendingCloseSince = at ?? pendingCloseSince;
            return holding();
        }

        if (at === null || at - pendingCloseSince < confirmMs) {
            return holding();
        }

        clearPending();
        state = 'closed';
        return { transition: 'close', state, pendingClose: false };
    };

    const reset = () => {
        state = 'closed';
        clearPending();
    };

    return {
        step,
        reset,
        isOpen: () => state === 'open',
        isPendingClose: () => pendingClose
    };
}
