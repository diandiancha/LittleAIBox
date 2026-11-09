import { KEYBOARD_SOURCE } from './keyboard-source.js';

export const DEFAULT_STABLE_HOLD_MS = 32;
const IMMEDIATE_VISUAL_OPEN_THRESHOLD = 80;

export function createViewportDebouncer({
    stableHoldMs = DEFAULT_STABLE_HOLD_MS
} = {}) {
    let stable = null;
    let candidateHeight = null;
    let candidateSince = 0;

    const commit = (sample) => {
        stable = sample;
        candidateHeight = null;
        candidateSince = 0;
        return { sample, waiting: false };
    };

    const hold = (sample) => ({
        sample: {
            ...sample,
            viewportHeight: stable.viewportHeight,
            viewportTop: stable.viewportTop,
            insetBottom: stable.insetBottom,
            keyboardExtent:
                stable.keyboardExtent ?? stable.insetBottom
        },
        waiting: true
    });

    const resolve = (sample) => {
        if (!stable) return commit(sample);
        if (sample.viewportHeight === stable.viewportHeight) {
            return commit(sample);
        }

        const immediateVisualOpen =
            stable.insetBottom < IMMEDIATE_VISUAL_OPEN_THRESHOLD &&
            sample.insetBottom >= IMMEDIATE_VISUAL_OPEN_THRESHOLD &&
            sample.keyboardFocused &&
            sample.keyboardSource === KEYBOARD_SOURCE.VISUAL;
        if (immediateVisualOpen) return commit(sample);

        const at = Number.isFinite(sample.sampledAt) ? sample.sampledAt : null;
        if (candidateHeight !== sample.viewportHeight) {
            candidateHeight = sample.viewportHeight;
            candidateSince = at ?? 0;
            return hold(sample);
        }
        if (at === null || at - candidateSince < stableHoldMs) {
            return hold(sample);
        }
        return commit(sample);
    };

    const reset = () => {
        stable = null;
        candidateHeight = null;
        candidateSince = 0;
    };

    return {
        resolve,
        reset,
        getStable: () => stable
    };
}
