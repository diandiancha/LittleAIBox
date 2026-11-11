import {
    markSideloadingLayoutShiftAnimating,
    sleepLayoutPanel,
    sleepLayoutPanelAfterTransition,
    wakeLayoutPanel
} from '../layout/main-layout-shift.js';

const sideloadingTransitions = new WeakMap();
let activeSideloading = null;
let sideloadingOpenQueue = Promise.resolve();
let sideloadingChrome = null;
let pendingSideloading = null;
let sideloadingAnimationDepth = 0;
const SIDELOADING_SWAP_SETTLE_MS = 220;

function ensureSideloadingChrome() {
    if (sideloadingChrome?.isConnected) return sideloadingChrome;
    sideloadingChrome = document.createElement('div');
    sideloadingChrome.className = 'sideloading-chrome';
    sideloadingChrome.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sideloadingChrome);
    return sideloadingChrome;
}

function setRightSidebarToggleVisibility(visible) {
    const button = document.getElementById('right-sidebar-toggle-btn');
    if (!button) return;
    button.style.display = visible ? '' : 'none';
    button.toggleAttribute('aria-hidden', !visible);
}

function sleepClosedRightSidebarAfterTransition() {
    const rightSidebar = document.getElementById('right-sidebar');
    if (!rightSidebar || !document.body.classList.contains('right-sidebar-open')) return;

    sleepLayoutPanelAfterTransition(rightSidebar, {
        fallbackMs: 360,
        shouldSleep: () => !document.body.classList.contains('right-sidebar-open')
    });
}

function clearDrawerTransition(drawer) {
    const pending = sideloadingTransitions.get(drawer);
    if (!pending) return;
    if (pending.raf) cancelAnimationFrame(pending.raf);
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.onEnd) drawer.removeEventListener('transitionend', pending.onEnd);
    if (pending.layoutAnimating) {
        finishPendingAnimation(pending);
    }
    sideloadingTransitions.delete(drawer);
}

function beginSideloadingAnimation() {
    sideloadingAnimationDepth += 1;
    document.body.classList.add('sideloading-anim');
}

function endSideloadingAnimation() {
    sideloadingAnimationDepth = Math.max(0, sideloadingAnimationDepth - 1);
    if (sideloadingAnimationDepth === 0) {
        document.body.classList.remove('sideloading-anim');
    }
}

function finishPendingAnimation(pending) {
    if (!pending?.layoutAnimating) return;
    pending.layoutAnimating = false;
    pending.layoutShiftEnd?.();
    pending.layoutShiftEnd = null;
    endSideloadingAnimation();
}

function createPendingAnimation(layoutShiftEnd) {
    return {
        raf: null,
        timer: null,
        onEnd: null,
        layoutAnimating: true,
        layoutShiftEnd
    };
}

function settlePendingTransition(drawer, pending, propertyName, settleMs, onSettled) {
    const finish = () => {
        if (sideloadingTransitions.get(drawer) !== pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        if (pending.onEnd) drawer.removeEventListener('transitionend', pending.onEnd);
        finishPendingAnimation(pending);
        sideloadingTransitions.delete(drawer);
        onSettled?.();
    };

    pending.onEnd = event => {
        if (event.target !== drawer || event.propertyName !== propertyName) return;
        finish();
    };
    drawer.addEventListener('transitionend', pending.onEnd);
    pending.timer = setTimeout(finish, settleMs);
}

function setSwapForeground(drawer, enabled) {
    if (!drawer) return;
    drawer.classList.toggle('sideloading-swap-foreground', enabled);
    drawer.closest?.('.sideloading-layer')?.classList.toggle('sideloading-swap-foreground', enabled);
}

/*
 * layoutTarget / chrome 是给页面级浮层（语聊等）复用开闭编排加的口子：
 *   layoutTarget —— 开合状态类挂到哪个元素（默认 body，驱动 .chat-area 挤压；
 *                   浮层传自己的布局根，驱动它自己的挤压规则）
 *   chrome       —— 是否托管 .sideloading-chrome 装饰层与右侧栏联动（浮层没有这些）
 * 主应用的调用方都不传，走默认值，行为不变。
 */
function syncSideloadingState(drawer, bodyOpenClass, isOpen, { layoutTarget = document.body, chrome = true } = {}) {
    drawer.classList.toggle('is-open', isOpen);
    if (bodyOpenClass) {
        layoutTarget.classList.toggle(bodyOpenClass, isOpen);
    }

    if (!chrome) return;
    const hasOpenSideloading = !!document.querySelector('.sideloading-panel.is-open');
    ensureSideloadingChrome().classList.toggle('is-open', hasOpenSideloading);
    document.body.classList.toggle('sideloading-open', hasOpenSideloading);
}

function runWithoutSideloadingTransitions(drawer, host, callback) {
    const chrome = ensureSideloadingChrome();
    const chatArea = host?.querySelector?.('.chat-area') || document.querySelector('.chat-area');
    const targets = [drawer, chrome, chatArea].filter(Boolean);
    const previousTransitions = targets.map(target => target.style.transition);

    targets.forEach(target => {
        target.style.transition = 'none';
    });
    callback();
    targets.forEach(target => void target.offsetWidth);

    requestAnimationFrame(() => {
        targets.forEach((target, index) => {
            target.style.transition = previousTransitions[index];
        });
    });
}

export function startSideloadingOpen({
    drawer,
    bodyOpenClass,
    animated = true,
    settleMs = 500,
    layoutTarget = document.body,
    chrome = true,
    onOpen,
    onSettled
} = {}) {
    clearDrawerTransition(drawer);
    wakeLayoutPanel(drawer);
    drawer.classList.remove('sideloading-swap-in');
    const stateOptions = { layoutTarget, chrome };
    const shouldAnimateLayout = animated && !drawer.classList.contains('is-open');
    let layoutShiftEnd = null;
    if (shouldAnimateLayout) {
        if (chrome) ensureSideloadingChrome();
        layoutShiftEnd = markSideloadingLayoutShiftAnimating(drawer, settleMs);
    }
    if (chrome) {
        sleepClosedRightSidebarAfterTransition();
        document.body.classList.remove('right-sidebar-open');
        setRightSidebarToggleVisibility(false);
    }

    if (!shouldAnimateLayout) {
        syncSideloadingState(drawer, bodyOpenClass, true, stateOptions);
        onOpen?.({ swapped: false });
        onSettled?.();
        return;
    }

    beginSideloadingAnimation();
    const pending = createPendingAnimation(layoutShiftEnd);
    sideloadingTransitions.set(drawer, pending);
    syncSideloadingState(drawer, bodyOpenClass, false, stateOptions);
    void drawer.offsetWidth;

    pending.raf = requestAnimationFrame(() => {
        pending.raf = null;
        if (sideloadingTransitions.get(drawer) !== pending) return;
        syncSideloadingState(drawer, bodyOpenClass, true, stateOptions);
        onOpen?.({ swapped: false });
        settlePendingTransition(drawer, pending, 'transform', settleMs, () => {
            onSettled?.();
        });
    });
}

function stageSideloadingSwapIn({ drawer, bodyOpenClass } = {}) {
    clearDrawerTransition(drawer);
    wakeLayoutPanel(drawer);
    ensureSideloadingChrome();
    const layoutShiftEnd = markSideloadingLayoutShiftAnimating(
        drawer,
        SIDELOADING_SWAP_SETTLE_MS
    );
    beginSideloadingAnimation();
    sleepClosedRightSidebarAfterTransition();
    document.body.classList.remove('right-sidebar-open');
    setRightSidebarToggleVisibility(false);
    drawer.classList.add('sideloading-opacity-transition', 'sideloading-swap-in');
    syncSideloadingState(drawer, bodyOpenClass, true);
    void drawer.offsetWidth;
    return layoutShiftEnd;
}

function revealStagedSideloading({ drawer } = {}, layoutShiftEnd = null) {
    let resolveReveal;
    const completion = new Promise(resolve => {
        resolveReveal = resolve;
    });
    const pending = createPendingAnimation(layoutShiftEnd);
    sideloadingTransitions.set(drawer, pending);
    pending.raf = requestAnimationFrame(() => {
        pending.raf = null;
        if (sideloadingTransitions.get(drawer) !== pending) return;
        drawer.classList.remove('sideloading-swap-in');
        settlePendingTransition(drawer, pending, 'opacity', SIDELOADING_SWAP_SETTLE_MS, () => {
            drawer.classList.remove('sideloading-opacity-transition');
            resolveReveal(true);
        });
    });
    return completion;
}

export function openSideloading(options = {}) {
    const { drawer, bodyOpenClass, requestClose } = options;
    if (!drawer) return Promise.resolve(false);

    const openTask = sideloadingOpenQueue.then(async () => {
        const previousSideloading = activeSideloading;
        let useOpacitySwap = false;
        let opacityRevealCompletion = null;
        if (previousSideloading && previousSideloading.drawer !== drawer) {
            pendingSideloading = drawer;
            useOpacitySwap = true;
            setSwapForeground(previousSideloading.drawer, true);
            const layoutShiftEnd = stageSideloadingSwapIn(options);
            opacityRevealCompletion = revealStagedSideloading(options, layoutShiftEnd);
            try {
                if (previousSideloading.closingPromise) {
                    await previousSideloading.closingPromise;
                } else if (typeof previousSideloading.requestClose === 'function') {
                    await previousSideloading.requestClose({
                        mode: 'opacity',
                        animated: true,
                        routeHandled: true
                    });
                } else {
                    await closeSideloading({
                        drawer: previousSideloading.drawer,
                        host: previousSideloading.host,
                        bodyOpenClass: previousSideloading.bodyOpenClass,
                        animated: true,
                        mode: 'opacity',
                        settleMs: SIDELOADING_SWAP_SETTLE_MS
                    });
                }
            } finally {
                setSwapForeground(previousSideloading.drawer, false);
            }
        }

        activeSideloading = {
            drawer,
            host: options.host,
            bodyOpenClass,
            requestClose,
            closingPromise: null
        };
        if (useOpacitySwap) {
            options.onOpen?.({ swapped: true });
            pendingSideloading = null;
            opacityRevealCompletion?.then(() => options.onSettled?.());
        } else {
            startSideloadingOpen(options);
        }
        return true;
    });
    sideloadingOpenQueue = openTask.catch(() => false);
    return openTask;
}

export function isSideloadingPendingOpen(drawer) {
    return !!drawer && pendingSideloading === drawer;
}

export function closeActiveSideloading({
    animated = true,
    mode = 'slide',
    routeHandled = false
} = {}) {
    const active = activeSideloading;
    if (!active) return Promise.resolve(false);
    if (active.closingPromise) return active.closingPromise;
    if (typeof active.requestClose === 'function') {
        return Promise.resolve(active.requestClose({ animated, mode, routeHandled }));
    }
    return closeSideloading({
        drawer: active.drawer,
        host: active.host,
        bodyOpenClass: active.bodyOpenClass,
        animated,
        mode
    });
}

export function closeSideloading({
    drawer,
    host,
    bodyOpenClass,
    animated = true,
    settleMs = 500,
    mode = 'slide',
    layoutTarget = document.body,
    chrome = true,
    onClose,
    onSettled
} = {}) {
    if (!drawer) return Promise.resolve(false);
    const stateOptions = { layoutTarget, chrome };
    let resolveCompletion;
    const completion = new Promise(resolve => {
        resolveCompletion = resolve;
    });
    if (activeSideloading?.drawer === drawer) {
        activeSideloading.closingPromise = completion;
    }
    const completeClose = () => {
        if (activeSideloading?.drawer === drawer) {
            activeSideloading = null;
        }
        resolveCompletion(true);
    };
    clearDrawerTransition(drawer);
    drawer.classList.remove('sideloading-swap-in');
    onClose?.();

    if (!animated || !drawer.classList.contains('is-open')) {
        const closeImmediately = () => {
            syncSideloadingState(drawer, bodyOpenClass, false, stateOptions);
            drawer.classList.remove('sideloading-opacity-transition', 'sideloading-swap-out');
            sleepLayoutPanel(drawer);
            if (chrome && !document.querySelector('.sideloading-panel.is-open')) {
                setRightSidebarToggleVisibility(true);
            }
            onSettled?.();
            completeClose();
        };
        if (!animated) {
            runWithoutSideloadingTransitions(drawer, host, closeImmediately);
        } else {
            closeImmediately();
        }
        return completion;
    }

    const isOpacityTransition = mode === 'opacity';
    const effectiveSettleMs = isOpacityTransition ? SIDELOADING_SWAP_SETTLE_MS : settleMs;
    const layoutShiftEnd = markSideloadingLayoutShiftAnimating(drawer, effectiveSettleMs);
    beginSideloadingAnimation();
    const pending = createPendingAnimation(layoutShiftEnd);
    sideloadingTransitions.set(drawer, pending);
    if (isOpacityTransition) {
        drawer.classList.add('sideloading-opacity-transition');
        void drawer.offsetWidth;
        drawer.classList.add('sideloading-swap-out');
    }
    syncSideloadingState(drawer, bodyOpenClass, false, stateOptions);

    const expectedProperty = isOpacityTransition ? 'opacity' : 'transform';
    settlePendingTransition(drawer, pending, expectedProperty, effectiveSettleMs, () => {
        drawer.classList.remove('sideloading-opacity-transition', 'sideloading-swap-in', 'sideloading-swap-out');
        sleepLayoutPanel(drawer);
        if (chrome && !document.querySelector('.sideloading-panel.is-open')) {
            setRightSidebarToggleVisibility(true);
        }
        onSettled?.();
        completeClose();
    });
    return completion;
}
