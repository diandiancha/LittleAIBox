import { KEYBOARD_SOURCE } from './keyboard-source.js';

export { KEYBOARD_SOURCE } from './keyboard-source.js';

export function createKeyboardSourceRouter({
    virtualKeyboard: keyboardCandidate =
        globalThis.navigator?.virtualKeyboard || null,
    minKeyboardInset = 80
} = {}) {
    let source = KEYBOARD_SOURCE.PENDING;
    let virtualKeyboard = null;

    const init = () => {
        const candidate = keyboardCandidate;
        if (!candidate) return source;
        try {
            if (candidate.overlaysContent === true) {
                virtualKeyboard = candidate;
                source = KEYBOARD_SOURCE.VIRTUAL;
            }
        } catch (_) {
            virtualKeyboard = null;
        }
        return source;
    };

    const destroy = () => {
        virtualKeyboard = null;
        source = KEYBOARD_SOURCE.PENDING;
    };

    const resetSession = () => {
        /*
         * 浏览器的 viewport 策略属于页面/内核能力，不属于单次焦点会话。
         * 连续开闭键盘时保留首次可靠分类，避免瞬时 innerHeight 在下一轮
         * 把 visual-resize 错抢成 layout-resize。
         */
        return source;
    };

    const resolve = (sample) => {
        if (source === KEYBOARD_SOURCE.VIRTUAL) {
            const insetBottom = Math.max(
                0,
                Math.round(virtualKeyboard?.boundingRect?.height || 0)
            );
            return {
                ...sample,
                insetBottom,
                viewportTop: 0,
                viewportHeight: Math.max(
                    1,
                    sample.layoutHeight - insetBottom
                ),
                keyboardSource: source
            };
        }

        if (source === KEYBOARD_SOURCE.PENDING) {
            const layoutInset = Math.max(
                0,
                sample.layoutHeight -
                    Math.min(sample.innerHeight, sample.clientHeight)
            );
            if (layoutInset >= minKeyboardInset) {
                source = KEYBOARD_SOURCE.LAYOUT;
            } else if (sample.insetBottom >= minKeyboardInset) {
                source = KEYBOARD_SOURCE.VISUAL;
            }
        }

        if (source === KEYBOARD_SOURCE.LAYOUT) {
            const viewportHeight = Math.min(
                sample.layoutHeight,
                sample.innerHeight,
                sample.clientHeight
            );
            const insetBottom = Math.max(
                0,
                sample.layoutHeight - viewportHeight
            );

            return {
                ...sample,
                viewportTop: 0,
                viewportHeight,
                insetBottom,
                keyboardSource: source
            };
        }

        if (source === KEYBOARD_SOURCE.VISUAL) {
            const viewportHeight = Math.max(1, sample.viewportHeight);
            const insetBottom = Math.max(
                0,
                sample.layoutHeight -
                    (viewportHeight + sample.viewportTop)
            );

            return {
                ...sample,
                viewportHeight,
                insetBottom,
                keyboardSource: source
            };
        }

        return {
            ...sample,
            keyboardSource: source
        };
    };

    return {
        init,
        destroy,
        resetSession,
        resolve,
        getSource: () => source,
        getVirtualKeyboard: () => virtualKeyboard
    };
}
