const DEFAULT_LAYOUT_SHIFT_DURATION_MS = 420;
const LAYOUT_SHIFT_CLASS = 'main-layout-shift-anim';
const CLEANUP_IDLE_TIMEOUT_MS = 160;
const LEASE_FALLBACK_BUFFER_MS = 120;
const DORMANT_PANEL_CLASS = 'layout-panel-dormant';

const WILL_CHANGE_TARGETS = Object.freeze([
    { selector: 'body', value: 'padding-left' },
    { selector: '.chat-area', value: 'margin-left, margin-right' },
    { selector: '#sidebar', value: 'transform' },
    { selector: '#sidebar-toggle-btn svg', value: 'transform' },
    { selector: '#right-sidebar', value: 'transform' },
    { selector: '#right-sidebar-toggle-btn', value: 'right' },
    { selector: '.sideloading-panel.is-open', value: 'transform, width, opacity' },
    { selector: '.sideloading-chrome.is-open', value: 'transform, width' }
]);

const activeLeases = new Map();
const managedTargets = new Map();
const pendingTargetCleanup = new Set();
let leaseSequence = 0;
let idleCleanupHandle = null;
let idleCleanupUsesRequestIdleCallback = false;

function cancelIdleCleanup() {
    if (idleCleanupHandle === null) return;

    if (idleCleanupUsesRequestIdleCallback && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCleanupHandle);
    } else {
        clearTimeout(idleCleanupHandle);
    }
    idleCleanupHandle = null;
    idleCleanupUsesRequestIdleCallback = false;
}

function getLatestContribution(state) {
    let latest = null;
    state.contributions.forEach(contribution => {
        if (!latest || contribution.sequence > latest.sequence) {
            latest = contribution;
        }
    });
    return latest;
}

function addManagedTarget(lease, element, value) {
    if (!element || lease.elements.has(element)) return;

    let state = managedTargets.get(element);
    if (!state) {
        state = {
            originalValue: element.style.willChange,
            managedValue: value,
            contributions: new Map()
        };
        managedTargets.set(element, state);
    }

    const contribution = {
        sequence: lease.sequence,
        value
    };
    state.contributions.set(lease.token, contribution);
    state.managedValue = value;
    lease.elements.add(element);
    pendingTargetCleanup.delete(element);
    element.style.willChange = value;
}

function collectLayoutShiftHints(lease, extraHints) {
    WILL_CHANGE_TARGETS.forEach(({ selector, value }) => {
        document.querySelectorAll(selector).forEach(element => {
            addManagedTarget(lease, element, value);
        });
    });

    extraHints.forEach(({ element, value }) => {
        addManagedTarget(lease, element, value);
    });
}

function restoreUnusedTargets() {
    pendingTargetCleanup.forEach(element => {
        const state = managedTargets.get(element);
        if (!state || state.contributions.size > 0) {
            pendingTargetCleanup.delete(element);
            return;
        }

        if (element.style.willChange === state.managedValue) {
            element.style.willChange = state.originalValue;
        }
        managedTargets.delete(element);
        pendingTargetCleanup.delete(element);
    });
}

function scheduleIdleCleanup() {
    if (idleCleanupHandle !== null) return;

    const cleanup = () => {
        idleCleanupHandle = null;
        idleCleanupUsesRequestIdleCallback = false;
        restoreUnusedTargets();

        if (activeLeases.size === 0) {
            document.body?.classList?.remove(LAYOUT_SHIFT_CLASS);
        }
    };

    if (typeof window.requestIdleCallback === 'function') {
        idleCleanupUsesRequestIdleCallback = true;
        idleCleanupHandle = window.requestIdleCallback(cleanup, {
            timeout: CLEANUP_IDLE_TIMEOUT_MS
        });
    } else {
        idleCleanupHandle = setTimeout(cleanup, 48);
    }
}

function releaseLease(token) {
    const lease = activeLeases.get(token);
    if (!lease) return;

    clearTimeout(lease.fallbackTimer);
    activeLeases.delete(token);

    lease.elements.forEach(element => {
        const state = managedTargets.get(element);
        if (!state) return;

        state.contributions.delete(token);
        const latest = getLatestContribution(state);
        if (latest) {
            if (element.style.willChange === state.managedValue) {
                element.style.willChange = latest.value;
            }
            state.managedValue = latest.value;
            return;
        }
        pendingTargetCleanup.add(element);
    });

    scheduleIdleCleanup();
}

export function markMainLayoutShiftAnimating(
    durationMs = DEFAULT_LAYOUT_SHIFT_DURATION_MS,
    extraHints = []
) {
    if (!document.body) return () => {};

    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0
        ? durationMs
        : DEFAULT_LAYOUT_SHIFT_DURATION_MS;
    const token = Symbol('main-layout-shift');
    const lease = {
        token,
        sequence: ++leaseSequence,
        elements: new Set(),
        fallbackTimer: null
    };

    cancelIdleCleanup();
    activeLeases.set(token, lease);
    document.body.classList.add(LAYOUT_SHIFT_CLASS);
    collectLayoutShiftHints(lease, extraHints);
    lease.fallbackTimer = setTimeout(
        () => releaseLease(token),
        safeDurationMs + LEASE_FALLBACK_BUFFER_MS
    );

    if (pendingTargetCleanup.size > 0) {
        scheduleIdleCleanup();
    }

    return () => releaseLease(token);
}

export function markSideloadingLayoutShiftAnimating(
    drawer,
    durationMs = DEFAULT_LAYOUT_SHIFT_DURATION_MS
) {
    return markMainLayoutShiftAnimating(durationMs, [
        { element: drawer, value: 'transform, opacity' },
        { element: document.querySelector('.sideloading-chrome'), value: 'transform' }
    ]);
}

export function wakeLayoutPanel(panel) {
    panel?.classList?.remove(DORMANT_PANEL_CLASS);
}

export function sleepLayoutPanel(panel) {
    panel?.classList?.add(DORMANT_PANEL_CLASS);
}

export function sleepLayoutPanelAfterTransition(
    panel,
    {
        propertyName = 'transform',
        fallbackMs = DEFAULT_LAYOUT_SHIFT_DURATION_MS,
        shouldSleep = () => true
    } = {}
) {
    if (!panel) return Promise.resolve(false);

    return new Promise(resolve => {
        let settled = false;
        let fallbackTimer = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            panel.removeEventListener('transitionend', handleTransitionEnd);
            const canSleep = shouldSleep();
            if (canSleep) sleepLayoutPanel(panel);
            resolve(canSleep);
        };
        const handleTransitionEnd = event => {
            if (event.target !== panel || event.propertyName !== propertyName) return;
            finish();
        };

        panel.addEventListener('transitionend', handleTransitionEnd);
        fallbackTimer = setTimeout(finish, fallbackMs);
    });
}
