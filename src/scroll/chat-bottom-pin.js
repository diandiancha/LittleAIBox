function getChatScrollContainer(host) {
    // 带 data-chat-bottom-pin 标记的宿主自己就是滚动容器——供语聊等
    // 全屏浮层复用这套钉底逻辑；主应用的调用方不带标记，语义不变。
    if (host instanceof Element && host.hasAttribute('data-chat-bottom-pin')) return host;
    return host?.querySelector?.('#chat-container') || document.getElementById('chat-container');
}

function getLayoutPreservationSuppressedUntil() {
    if (typeof window === 'undefined') return 0;
    return Number(window.__LITTLEAIBOX_SUPPRESS_CHAT_LAYOUT_ANCHOR_UNTIL || 0);
}

const activeLayoutPreservationSuppressions = new Set();
const activeLayoutPreservationRuns = new WeakMap();

let chatScrollExecutor = null;

function extendLayoutPreservationRun(container, durationMs, token) {
    if (token == null) return null;
    const activeRun = activeLayoutPreservationRuns.get(container);
    if (activeRun?.token !== token || !isLayoutPreservationRunActive(container, activeRun)) return null;
    activeRun.deadline = Math.max(
        activeRun.deadline,
        performance.now() + durationMs
    );
    return activeRun;
}

function beginLayoutPreservationRun(container, durationMs, token) {
    const now = performance.now();
    const activeRun = extendLayoutPreservationRun(container, durationMs, token);
    if (activeRun) {
        return { run: activeRun, reused: true };
    }
    const run = {
        token,
        deadline: now + durationMs
    };
    activeLayoutPreservationRuns.set(container, run);
    return { run, reused: false };
}

function isLayoutPreservationRunActive(container, run) {
    return activeLayoutPreservationRuns.get(container) === run
        && performance.now() <= run.deadline
        && document.visibilityState !== 'hidden';
}

function finishLayoutPreservationRun(container, run) {
    if (activeLayoutPreservationRuns.get(container) === run) {
        activeLayoutPreservationRuns.delete(container);
    }
}

export function setChatLayoutScrollExecutor(executor) {
    chatScrollExecutor = typeof executor === 'function' ? executor : null;
}

function setChatLayoutScrollTop(container, targetTop, options = {}) {
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextTop = Math.min(maxScrollTop, Math.max(0, Number(targetTop) || 0));
    if (chatScrollExecutor) {
        chatScrollExecutor(container, nextTop, options);
        return;
    }
    container.scrollTop = nextTop;
}

function isLayoutPreservationSuppressed() {
    return activeLayoutPreservationSuppressions.size > 0 || Date.now() < getLayoutPreservationSuppressedUntil();
}

export function suppressChatLayoutPreservation(ms = 1400) {
    if (typeof window === 'undefined') return;
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    window.__LITTLEAIBOX_SUPPRESS_CHAT_LAYOUT_ANCHOR_UNTIL = Math.max(
        getLayoutPreservationSuppressedUntil(),
        until
    );
}

export function holdChatLayoutPreservation() {
    const token = {};
    activeLayoutPreservationSuppressions.add(token);
    return () => {
        activeLayoutPreservationSuppressions.delete(token);
    };
}

export function isChatPinnedToBottom(host) {
    const container = getChatScrollContainer(host);
    if (!container) return false;
    const distance = container.scrollHeight - container.clientHeight - container.scrollTop;
    return distance <= 8;
}

export function isChatPinnedToTop(host) {
    const container = getChatScrollContainer(host);
    if (!container) return false;
    return container.scrollTop <= 8;
}

export function preservePinnedChatBottomDuringLayout(
    host,
    durationMs = 420,
    { token } = {}
) {
    if (isLayoutPreservationSuppressed()) {
        return;
    }

    const container = getChatScrollContainer(host);
    if (!container) return;
    const { run, reused } = beginLayoutPreservationRun(container, durationMs, token);
    if (reused) return;
    const pinToBottom = () => {
        if (!isLayoutPreservationRunActive(container, run) || isLayoutPreservationSuppressed()) {
            finishLayoutPreservationRun(container, run);
            return false;
        }
        setChatLayoutScrollTop(container, container.scrollHeight - container.clientHeight, {
            reason: 'layout-bottom-pin'
        });
        return true;
    };
    const syncBottom = () => {
        if (!pinToBottom()) return;
        if (performance.now() < run.deadline) {
            requestAnimationFrame(syncBottom);
        } else {
            finishLayoutPreservationRun(container, run);
        }
    };
    pinToBottom();
    requestAnimationFrame(syncBottom);
}

export function preservePinnedChatTopDuringLayout(
    host,
    durationMs = 420,
    { token } = {}
) {
    if (isLayoutPreservationSuppressed()) {
        return;
    }

    const container = getChatScrollContainer(host);
    if (!container) return;
    const { run, reused } = beginLayoutPreservationRun(container, durationMs, token);
    if (reused) return;
    const pinToTop = () => {
        if (!isLayoutPreservationRunActive(container, run) || isLayoutPreservationSuppressed()) {
            finishLayoutPreservationRun(container, run);
            return false;
        }
        setChatLayoutScrollTop(container, 0, {
            reason: 'layout-top-pin'
        });
        return true;
    };
    const syncTop = () => {
        if (!pinToTop()) return;
        if (performance.now() < run.deadline) {
            requestAnimationFrame(syncTop);
        } else {
            finishLayoutPreservationRun(container, run);
        }
    };
    pinToTop();
    requestAnimationFrame(syncTop);
}

export function preserveChatBottomIfPinned(host, durationMs = 420, options) {
    if (isLayoutPreservationSuppressed()) {
        return false;
    }
    if (!isChatPinnedToBottom(host)) return false;
    preservePinnedChatBottomDuringLayout(host, durationMs, options);
    return true;
}

export function preserveChatTopIfPinned(host, durationMs = 420, options) {
    if (isLayoutPreservationSuppressed()) {
        return false;
    }
    if (!isChatPinnedToTop(host)) return false;
    preservePinnedChatTopDuringLayout(host, durationMs, options);
    return true;
}

export function preserveChatPositionDuringLayout(host, target = null, durationMs = 520) {
    if (isLayoutPreservationSuppressed()) {
        return false;
    }
    return preserveChatBottomIfPinned(host, durationMs)
        || preserveChatTopIfPinned(host, durationMs)
        || preserveElementInViewDuringLayout(host, target, durationMs);
}

export function preserveElementInViewDuringLayout(
    host,
    target = null,
    durationMs = 520,
    { token } = {}
) {
    if (isLayoutPreservationSuppressed()) {
        return false;
    }
    const container = getChatScrollContainer(host);
    if (!container) return false;
    if (extendLayoutPreservationRun(container, durationMs, token)) return true;
    const snapshot = createLayoutAnchorSnapshot(container, target);
    if (!snapshot) return false;
    applyLayoutAnchorSnapshot(snapshot, durationMs, { token });
    return true;
}

export function preserveChatPositionAroundLayout(
    host,
    commit,
    durationMs = 80,
    { token } = {}
) {
    if (typeof commit !== 'function') return false;
    if (isLayoutPreservationSuppressed()) {
        commit();
        return false;
    }

    const container = getChatScrollContainer(host);
    if (!container) {
        commit();
        return false;
    }
    if (extendLayoutPreservationRun(container, durationMs, token)) {
        commit();
        return true;
    }

    const pinned = isChatPinnedToBottom(container);
    const snapshot = pinned ? null : createLayoutAnchorSnapshot(container);
    commit();

    if (pinned) {
        preservePinnedChatBottomDuringLayout(container, durationMs, { token });
        return true;
    }
    if (!snapshot) return false;
    applyLayoutAnchorSnapshot(snapshot, durationMs, { token });
    return true;
}

export function preserveChatBottomAroundLayoutSync(host, commit) {
    if (typeof commit !== 'function') return false;
    if (isLayoutPreservationSuppressed()) {
        commit();
        return false;
    }

    const container = getChatScrollContainer(host);
    if (!container) {
        commit();
        return false;
    }

    const pinned = isChatPinnedToBottom(container);
    commit();
    if (!pinned || !container.isConnected) return false;

    setChatLayoutScrollTop(
        container,
        container.scrollHeight - container.clientHeight,
        { reason: 'browser-keyboard-bottom-pin-sync' }
    );
    return true;
}

function createLayoutAnchorSnapshot(host, target = null) {
    const container = getChatScrollContainer(host);
    if (!container) return null;
    const anchor = target
        ? createElementAnchor(container, target)
        : resolveVisibleLayoutAnchor(container);
    if (!anchor) return null;
    return {
        container,
        anchor,
        desiredTop: anchor.getTop() - container.getBoundingClientRect().top
    };
}

function applyLayoutAnchorSnapshot(snapshot, durationMs = 520, { token } = {}) {
    const { container, anchor, desiredTop } = snapshot;
    const { run, reused } = beginLayoutPreservationRun(container, durationMs, token);
    if (reused) return;

    const applyAnchor = () => {
        if (!isLayoutPreservationRunActive(container, run) || isLayoutPreservationSuppressed()) {
            finishLayoutPreservationRun(container, run);
            return false;
        }
        if (!container.isConnected || !anchor.isConnected()) {
            finishLayoutPreservationRun(container, run);
            return false;
        }
        const nextContainerRect = container.getBoundingClientRect();
        const delta = (anchor.getTop() - nextContainerRect.top) - desiredTop;
        if (Math.abs(delta) <= 0.5) return true;
        setChatLayoutScrollTop(container, container.scrollTop + delta, {
            reason: 'layout-anchor-preserve'
        });
        return true;
    };

    const syncAnchor = () => {
        if (!applyAnchor()) return;
        if (performance.now() < run.deadline) {
            requestAnimationFrame(syncAnchor);
        } else {
            finishLayoutPreservationRun(container, run);
        }
    };

    requestAnimationFrame(syncAnchor);
}

function createElementAnchor(container, element) {
    if (!element || !element.isConnected || !container.contains(element)) return null;
    return {
        isConnected: () => element.isConnected && container.contains(element),
        getTop: () => element.getBoundingClientRect().top
    };
}

function createRangeAnchor(container, x, y) {
    let range = null;
    try {
        const position = document.caretPositionFromPoint?.(x, y);
        if (position?.offsetNode) {
            range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.setEnd(position.offsetNode, position.offset);
        } else {
            range = document.caretRangeFromPoint?.(x, y) || null;
        }
    } catch (_) {
        range = null;
    }

    const node = range?.startContainer || null;
    const ownerElement = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!range || !ownerElement || !container.contains(ownerElement)) return null;

    const getTop = () => {
        const rects = Array.from(range.getClientRects?.() || []);
        const rect = rects.find(item => item.width > 0 || item.height > 0) || range.getBoundingClientRect?.();
        return rect?.top || ownerElement.getBoundingClientRect().top;
    };

    return {
        isConnected: () => ownerElement.isConnected && container.contains(ownerElement),
        getTop
    };
}

function isVisibleInContainer(element, containerRect) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
}

const IGNORED_ANCHOR_SELECTOR = [
    'script',
    'style',
    'template',
    'button',
    'input',
    'textarea',
    'select',
    'option',
    '.message',
    '.content',
    '.message-actions'
].join(',');

function isAnchorCandidate(element, containerRect) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.matches?.(IGNORED_ANCHOR_SELECTOR)) return false;
    if (!isVisibleInContainer(element, containerRect)) return false;
    const rect = element.getBoundingClientRect();
    return rect.height >= 12 && rect.width >= 24;
}

function hasVisibleChildCandidate(element, containerRect) {
    return Array.from(element.children || []).some(child => {
        return isAnchorCandidate(child, containerRect);
    });
}

function getStableContentBlock(element, root) {
    let current = element;
    let candidate = null;
    while (current && current !== root) {
        if (current.parentElement === root) return current;
        candidate = current;
        current = current.parentElement;
    }
    return candidate;
}

function getDynamicVisibleAnchorCandidates(container, containerRect) {
    const contentRoots = Array.from(container.querySelectorAll('.message .content'));
    const roots = contentRoots.length ? contentRoots : [container];
    const candidates = [];
    const seen = new Set();

    roots.forEach((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (!node || node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_SKIP;
                if (node.matches?.(IGNORED_ANCHOR_SELECTOR)) return NodeFilter.FILTER_SKIP;
                if (!isVisibleInContainer(node, containerRect)) return NodeFilter.FILTER_REJECT;
                if (!isAnchorCandidate(node, containerRect)) return NodeFilter.FILTER_SKIP;
                if (hasVisibleChildCandidate(node, containerRect)) {
                    return NodeFilter.FILTER_SKIP;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node = walker.nextNode();
        while (node) {
            const block = getStableContentBlock(node, root);
            if (block && !seen.has(block) && isAnchorCandidate(block, containerRect)) {
                seen.add(block);
                candidates.push(block);
            }
            node = walker.nextNode();
        }
    });

    return candidates;
}

function scoreVisibleAnchor(element, containerRect) {
    const rect = element.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, containerRect.top);
    const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    if (visibleHeight <= 0) return Number.POSITIVE_INFINITY;

    const focusY = containerRect.top + containerRect.height * 0.42;
    if (rect.top <= focusY && rect.bottom >= focusY) {
        return -visibleHeight;
    }
    const distance = rect.bottom < focusY ? focusY - rect.bottom : rect.top - focusY;
    return distance - Math.min(visibleHeight, 240) * 0.1;
}

function resolveVisibleLayoutAnchor(container) {
    const rect = container.getBoundingClientRect();
    const probeX = Math.min(rect.right - 8, Math.max(rect.left + 8, rect.left + rect.width * 0.5));
    const probeY = Math.min(rect.bottom - 8, Math.max(rect.top + 8, rect.top + rect.height * 0.42));
    const rangeAnchor = createRangeAnchor(container, probeX, probeY);
    if (rangeAnchor) return rangeAnchor;

    const candidates = getDynamicVisibleAnchorCandidates(container, rect)
        .sort((a, b) => scoreVisibleAnchor(a, rect) - scoreVisibleAnchor(b, rect));
    if (candidates[0]) return createElementAnchor(container, candidates[0]);

    let node = document.elementFromPoint(probeX, probeY);
    if (!node) return null;
    if (!container.contains(node)) return null;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const anchor = node.closest?.('.content, .message');
    if (anchor && container.contains(anchor)) return createElementAnchor(container, anchor);
    return node.nodeType === Node.ELEMENT_NODE ? createElementAnchor(container, node) : null;
}
