export function createViewportSampler({
    now = () => performance.now()
} = {}) {
    let maxLayoutHeight = 0;
    let widthBaseline = 0;

    const sample = ({
        reason,
        viewportHeight,
        viewportTop = 0,
        innerHeight,
        clientHeight,
        width,
        keyboardFocused = false,
        virtualKeyboardHeight = 0,
        virtualKeyboardY = 0,
        virtualKeyboardEventCount = 0
    }) => {
        const sampledAt = now();

        const safeViewportHeight = Math.max(1, Math.round(viewportHeight));
        const safeViewportTop = Math.max(0, Math.round(viewportTop));
        const safeInnerHeight = Math.max(1, Math.round(innerHeight));
        const safeClientHeight = Math.max(1, Math.round(clientHeight));
        const safeWidth = Math.max(1, Math.round(width));

        if (widthBaseline && Math.abs(safeWidth - widthBaseline) >= 48) {
            maxLayoutHeight = 0;
        }
        widthBaseline = safeWidth;
        maxLayoutHeight = Math.max(
            maxLayoutHeight,
            safeInnerHeight,
            safeClientHeight,
            safeViewportHeight + safeViewportTop
        );

        const insetBottom = Math.max(
            0,
            maxLayoutHeight - (safeViewportHeight + safeViewportTop)
        );

        return {
            reason,
            sampledAt,
            viewportHeight: safeViewportHeight,
            viewportTop: safeViewportTop,
            innerHeight: safeInnerHeight,
            clientHeight: safeClientHeight,
            layoutHeight: maxLayoutHeight,
            insetBottom,
            keyboardFocused,
            virtualKeyboardHeight: Math.max(
                0,
                Math.round(virtualKeyboardHeight)
            ),
            virtualKeyboardY: Math.max(0, Math.round(virtualKeyboardY)),
            virtualKeyboardEventCount
        };
    };

    return {
        sample
    };
}
