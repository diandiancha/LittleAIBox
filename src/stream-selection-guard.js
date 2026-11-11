export function selectionIntersectsNode(node) {
    if (!node?.isConnected) return false;
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    try { return selection.getRangeAt(0).intersectsNode(node); } catch (_) { return false; }
}

function projectContent(root) {
    const bounds = new WeakMap();
    const segments = [];
    const math = new Map();
    const chunks = [];
    let length = 0;
    const visit = node => {
        const start = length;
        if (node.nodeType === 3) {
            chunks.push(node.data);
            length += node.data.length;
            segments.push({ node, start, end: length });
        } else if (node.nodeType === 1) {
            if (node !== root && node.matches('script, style, button, .code-block-header, .reasoning-toggle > summary')) {
                bounds.set(node, { start, end: start });
                return;
            }
            if (node.classList.contains('katex')) {
                const source = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? node.textContent;
                const key = `${node.closest('.katex-display') ? 'display' : 'inline'}:${source}`;
                const occurrences = math.get(key) || [];
                occurrences.push(node);
                math.set(key, occurrences);
                const value = `\uFFFC${key}\uFFFC`;
                chunks.push(value);
                length += value.length;
                segments.push({ node, start, end: length, key, occurrence: occurrences.length - 1 });
            } else {
                node.childNodes.forEach(visit);
            }
        }
        bounds.set(node, { start, end: length });
    };
    visit(root);
    return { root, text: chunks.join(''), bounds, segments, math };
}

function nodePath(root, node) {
    const path = [];
    while (node !== root && node.parentNode) {
        path.push(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
        node = node.parentNode;
    }
    return path.reverse();
}

function capturePoint(projection, node, offset, isStart) {
    const point = { node, offset, isStart, text: node.nodeType === 3 ? node.data : null };
    if (!projection.root.contains(node)) return { ...point, external: true };
    const owner = node.nodeType === 1 ? node : node.parentElement;
    const mathNode = owner?.closest('.katex');
    if (mathNode && projection.root.contains(mathNode)) {
        const segment = projection.segments.find(item => item.node === mathNode);
        if (segment) return { ...point, position: segment.start, key: segment.key, occurrence: segment.occurrence, path: nodePath(mathNode, node) };
    }
    const bounds = projection.bounds.get(node);
    point.position = (offset && node.nodeType === 1
        ? projection.bounds.get(node.childNodes[offset - 1])?.end
        : bounds?.start) ?? bounds?.start ?? 0;
    if (node.nodeType === 3) point.position += offset;
    if (node.nodeType === 1) {
        point.before = node.childNodes[offset] || null;
        point.after = node.childNodes[offset - 1] || null;
    }
    return point;
}

function mapPosition(previous, next, position) {
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
    if (position <= prefix) return position;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < next.length - prefix
        && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1;
    if (position >= previous.length - suffix) return next.length - (previous.length - position);

    const changed = next.slice(prefix, next.length - suffix);
    const left = previous.slice(Math.max(prefix, position - 32), position);
    const right = previous.slice(position, Math.min(previous.length - suffix, position + 32));
    for (const [quote, shift] of [[left + right, left.length], [left, left.length], [right, 0]]) {
        if (!quote) continue;
        const index = changed.indexOf(quote);
        if (index >= 0 && changed.indexOf(quote, index + 1) < 0) return prefix + index + shift;
    }
    return prefix + Math.min(position - prefix, changed.length);
}

function resolvePoint(point, previous, getProjection) {
    const { node, offset } = point;
    if (node.isConnected) {
        if (point.external) return { node, offset };
        if (node.nodeType === 3 && node.data.slice(0, offset) === point.text.slice(0, offset)) return { node, offset };
        if (node.nodeType === 1) {
            if (point.before?.parentNode === node) return { node, offset: Array.prototype.indexOf.call(node.childNodes, point.before) };
            if (point.after?.parentNode === node) return { node, offset: Array.prototype.indexOf.call(node.childNodes, point.after) + 1 };
        }
    }
    if (point.external) return null;
    const next = getProjection();
    if (point.key) {
        let target = next.math.get(point.key)?.[point.occurrence];
        for (const index of point.path) target = target?.childNodes[index];
        if (target?.nodeType === node.nodeType) {
            return { node: target, offset: Math.min(offset, target.nodeType === 3 ? target.data.length : target.childNodes.length) };
        }
    }
    const position = mapPosition(previous.text, next.text, point.position);
    for (const segment of next.segments) {
        if (position > segment.end) continue;
        if (!segment.key) return { node: segment.node, offset: Math.max(0, position - segment.start) };
        const parent = segment.node.parentNode;
        const index = Array.prototype.indexOf.call(parent.childNodes, segment.node);
        return { node: parent, offset: index + (position >= segment.end || (!point.isStart && position > segment.start) ? 1 : 0) };
    }
    return { node: next.root, offset: next.root.childNodes.length };
}

export function preserveSelectionDuringUpdate(root, update, { withScrollPreservation = restore => restore() } = {}) {
    let saved;
    try {
        if (selectionIntersectsNode(root)) {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);
            const projection = projectContent(root);
            const anchorIsStart = selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
            saved = {
                projection,
                anchor: capturePoint(projection, selection.anchorNode, selection.anchorOffset, anchorIsStart),
                focus: capturePoint(projection, selection.focusNode, selection.focusOffset, !anchorIsStart)
            };
        }
    } catch (_) { }
    try {
        return update();
    } finally {
        if (saved && root.isConnected) {
            try {
                let next;
                const getProjection = () => next || (next = projectContent(root));
                const anchor = resolvePoint(saved.anchor, saved.projection, getProjection);
                const focus = resolvePoint(saved.focus, saved.projection, getProjection);
                const selection = window.getSelection();
                if (anchor && focus && (selection.anchorNode !== anchor.node || selection.anchorOffset !== anchor.offset
                    || selection.focusNode !== focus.node || selection.focusOffset !== focus.offset)) {
                    withScrollPreservation(() => {
                        if (selection.setBaseAndExtent) selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
                        else {
                            selection.collapse(anchor.node, anchor.offset);
                            selection.extend(focus.node, focus.offset);
                        }
                    });
                }
            } catch (_) { }
        }
    }
}
