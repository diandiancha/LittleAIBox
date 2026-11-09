export function resolveVisualRootGeometry(sample) {
    const layoutHeight = Math.max(1, sample?.layoutHeight || 1);
    const viewportHeight = Math.max(1, sample?.viewportHeight || 1);
    const viewportTop = Math.max(0, sample?.viewportTop || 0);

    return {
        top: viewportTop,
        height: Math.min(layoutHeight, viewportHeight)
    };
}
