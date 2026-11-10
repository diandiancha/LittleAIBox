function getTrailingTextNode(container) {
    let node = container.lastChild;
    let visited = 0;
    // This is an optimization only: large/enhanced tails use normal replacement.
    while (node && node !== container && visited++ < 64) {
        if (node.nodeType === 3 && node.data.trim()) return node;
        if (node.lastChild) {
            node = node.lastChild;
            continue;
        }
        while (node && node !== container && !node.previousSibling) node = node.parentNode;
        node = node && node !== container ? node.previousSibling : null;
    }
    return null;
}

function getRenderedTextTail(container, html) {
    if (typeof html !== 'string' || !container) return null;

    const tailOffset = Math.max(0, html.length - 4096);
    const closing = /(?:<\/[a-z][a-z0-9-]*>\s*)+$/iu.exec(html.slice(tailOffset));
    if (!closing) return null;
    const insertionIndex = tailOffset + closing.index;
    const textStart = html.lastIndexOf('>', insertionIndex - 1) + 1;
    const body = html.slice(textStart, insertionIndex);
    if (!body.trim() || body.includes('<')) return null;
    const textNode = getTrailingTextNode(container);
    if (!textNode || textNode.parentElement?.closest(
        'pre, code, button, .katex, .canvas-card, .mermaid-render-container, .vega-lite-render-container, .stream-image-attachments, [data-canvas-artifact]'
    )) return null;

    let previousText = body;
    if (body.includes('&')) {
        const decoder = document.createElement('div');
        decoder.innerHTML = body;
        previousText = decoder.textContent;
    }
    if (previousText !== textNode.data) return null;
    return { insertionIndex, textNode };
}

// Compare sanitized HTML, never raw Markdown or its unfinished delimiters.
function planRenderedTextAppend(container, previousHtml, nextHtml) {
    const previous = getRenderedTextTail(container, previousHtml);
    if (!previous) return null;

    const prefix = previousHtml.slice(0, previous.insertionIndex);
    const closing = previousHtml.slice(previous.insertionIndex);
    if (!nextHtml.startsWith(prefix) || !nextHtml.endsWith(closing)) return null;

    const addedHtml = nextHtml.slice(prefix.length, nextHtml.length - closing.length);
    if (!addedHtml || addedHtml.includes('<')) return null;
    let addedText = addedHtml;
    if (addedHtml.includes('&')) {
        const decoder = document.createElement('div');
        decoder.innerHTML = addedHtml;
        if (decoder.childNodes.length !== 1 || decoder.firstChild?.nodeType !== 3) return null;
        addedText = decoder.textContent;
    }
    return { kind: 'append-text', container, textNode: previous.textNode, addedText };
}

function planRenderedTailAppend(container, previousHtml, nextHtml) {
    const closing = /(?:<\/[a-z][a-z0-9-]*>\s*)+$/iu.exec(previousHtml.slice(-4096));
    if (!closing) return null;
    const prefix = previousHtml.slice(0, previousHtml.length - closing[0].length);
    if (!nextHtml.startsWith(prefix) || !nextHtml.endsWith(closing[0])) return null;
    const addedHtml = nextHtml.slice(prefix.length, nextHtml.length - closing[0].length);
    if (!addedHtml) return null;
    if (addedHtml.includes('<')) {
        const fragment = document.createElement('template');
        fragment.innerHTML = addedHtml;
        if (fragment.innerHTML !== addedHtml) return null;
    }

    const tags = Array.from(closing[0].matchAll(/<\/([a-z][a-z0-9-]*)>/giu), match => match[1].toLowerCase()).reverse();
    let target = container;
    for (const tag of tags) {
        let child = target.lastChild;
        while (child?.nodeType === 3 && !child.data.trim()) child = child.previousSibling;
        if (child?.nodeType !== 1 || child.localName !== tag) return null;
        target = child;
    }
    if (target.closest('pre, code, table, button, .katex, .canvas-card, .mermaid-render-container, .vega-lite-render-container, .stream-image-attachments, [data-canvas-artifact]')) return null;

    if (!addedHtml.includes('<') && target.lastChild?.nodeType === 3) {
        const decoder = document.createElement('div');
        decoder.innerHTML = addedHtml;
        return { kind: 'append-text', container, textNode: target.lastChild, addedText: decoder.textContent };
    }
    return { kind: 'append-blocks', container: target, addedHtml };
}

function matchesRenderedBlock(source, live) {
    if (source.nodeType !== live.nodeType) return false;
    if (source.nodeType === 3) return source.data === live.data;
    if (source.nodeType !== 1) return source.isEqualNode(live);
    if (source.localName === live.localName) return true;
    if (source.localName === 'table') return live.matches('.table-wrapper') && !!live.querySelector(':scope > table');
    if (source.localName === 'pre') return live.matches('.code-block-wrapper, .mermaid-render-container, .vega-lite-render-container');
    return false;
}

// 保留完全相同的块前缀，包括其中已经增强的公式、代码和表格。
// 结构对应不明确（例如额外图片节点）时继续使用保守的区域替换计划。
function planRenderedTailReplacement(container, previousHtml, nextHtml) {
    const previous = document.createElement('template');
    const next = document.createElement('template');
    previous.innerHTML = previousHtml;
    next.innerHTML = nextHtml;
    const previousNodes = Array.from(previous.content.childNodes);
    const nextNodes = Array.from(next.content.childNodes);
    const liveNodes = Array.from(container.childNodes);
    if (previousNodes.length !== liveNodes.length
        || !previousNodes.every((node, index) => matchesRenderedBlock(node, liveNodes[index]))) return null;
    let preserved = 0;
    while (preserved < previousNodes.length && preserved < nextNodes.length
        && previousNodes[preserved].isEqualNode(nextNodes[preserved])) preserved += 1;
    if (!preserved) return null;
    const fragment = document.createDocumentFragment();
    nextNodes.slice(preserved).forEach(node => fragment.appendChild(node));
    return { kind: 'replace-tail', container, removedNodes: liveNodes.slice(preserved), fragment };
}

// All sources use this commit path. HTML must already be parsed and sanitized;
// plain-text inputs never pass through innerHTML. Uncertain boundaries replace the region.
export function planStreamingContentUpdate(container, previousContent, nextContent, { format = 'html', preserveSelection = false } = {}) {
    if (!container || (previousContent === nextContent && (format !== 'text'
        || container.childNodes.length === 0
        || (container.childNodes.length === 1 && container.firstChild.nodeType === 3)))) {
        return { kind: 'unchanged', container };
    }
    if (format === 'text') {
        const textNode = container.firstChild;
        if (container.childNodes.length === 1 && textNode?.nodeType === 3
            && textNode.data === previousContent && nextContent.startsWith(previousContent)) {
            return { kind: 'append-text', container, textNode, addedText: nextContent.slice(previousContent.length) };
        }
        return { kind: 'replace-region', container, format, nextContent };
    }
    if (nextContent.startsWith(previousContent)) {
        return { kind: 'append-blocks', container, addedHtml: nextContent.slice(previousContent.length) };
    }
    return planRenderedTextAppend(container, previousContent, nextContent)
        || ((preserveSelection || container.querySelector('.katex-display')) && (planRenderedTailAppend(container, previousContent, nextContent)
            || planRenderedTailReplacement(container, previousContent, nextContent)))
        || { kind: 'replace-region', container, format, nextContent };
}

export function commitStreamingContentUpdate(plan) {
    if (plan.kind === 'append-text') {
        if (plan.insertAfter) plan.textNode.after(document.createTextNode(plan.addedText));
        else plan.textNode.appendData(plan.addedText);
    } else if (plan.kind === 'append-blocks') plan.container.insertAdjacentHTML('beforeend', plan.addedHtml);
    else if (plan.kind === 'replace-region') {
        if (plan.format === 'text') plan.container.textContent = plan.nextContent;
        else plan.container.innerHTML = plan.nextContent;
    } else if (plan.kind === 'replace-tail') {
        plan.removedNodes.forEach(node => node.remove());
        plan.container.appendChild(plan.fragment);
    }
    return plan.kind;
}

export function updateStreamingContent(container, previousContent, nextContent, options = {}) {
    return commitStreamingContentUpdate(planStreamingContentUpdate(container, previousContent, nextContent, options));
}
