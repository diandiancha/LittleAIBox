function getDisplayMathSource(node) {
    return node.querySelector('.katex-mathml annotation[encoding="application/x-tex"]')?.textContent ?? null;
}

export function captureDisplayMathState(element, replacedRoots) {
    if (!replacedRoots.length) return null;
    const replacedMath = new Set();
    replacedRoots.forEach(root => {
        if (root.nodeType !== 1) return;
        if (root.matches('.katex-display')) replacedMath.add(root);
        root.querySelectorAll('.katex-display').forEach(node => replacedMath.add(node));
    });
    const scrolledNodes = new Map();
    replacedMath.forEach(node => {
        const scrollLeft = node.scrollLeft;
        if (scrollLeft !== 0) scrolledNodes.set(node, { node, scrollLeft });
    });
    if (!scrolledNodes.size) return null;

    const states = new Map();
    element.querySelectorAll('.katex-display').forEach(node => {
        const source = getDisplayMathSource(node);
        if (source === null) return;
        let occurrences = states.get(source);
        if (!occurrences) {
            occurrences = [];
            states.set(source, occurrences);
        }
        occurrences.push(scrolledNodes.get(node) || null);
    });
    return states;
}

export function restoreDisplayMathState(element, states) {
    if (!states?.size) return;
    const occurrences = new Map();
    const scrollRestores = [];
    element.querySelectorAll('.katex-display').forEach(node => {
        const source = getDisplayMathSource(node);
        const previous = states.get(source);
        if (!previous) return;
        const index = occurrences.get(source) || 0;
        occurrences.set(source, index + 1);
        const saved = previous[index];
        if (!saved) return;

        if (node !== saved.node && !saved.node.isConnected && saved.node.isEqualNode(node)) {
            node.replaceWith(saved.node);
            node = saved.node;
        }
        scrollRestores.push({ node, scrollLeft: saved.scrollLeft });
    });

    scrollRestores.forEach(({ node, scrollLeft }) => {
        node.scrollLeft = scrollLeft;
    });
}
