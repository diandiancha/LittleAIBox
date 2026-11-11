const MAX_HIDDEN_GRACE_MS = 180000;
const MIN_RECHECK_MS = 250;

let lastVisibilityResumeAt = 0;

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.hidden) lastVisibilityResumeAt = Date.now();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) lastVisibilityResumeAt = Date.now();
    });
}

export function isDocumentHidden() {
    return typeof document !== 'undefined' && document.hidden === true;
}

export function getLastVisibilityResumeAt() {
    return lastVisibilityResumeAt;
}

export function startVisibilityAwareTimeout(timeoutMs, onExpire, options = {}) {
    if (!timeoutMs || timeoutMs <= 0 || typeof onExpire !== 'function') {
        return () => { };
    }

    const hiddenGraceMs = Number.isFinite(options.hiddenGraceMs)
        ? Math.max(0, options.hiddenGraceMs)
        : Math.min(timeoutMs * 2, MAX_HIDDEN_GRACE_MS);

    const startedAt = Date.now();
    let timerId = null;
    let cancelled = false;

    const check = () => {
        if (cancelled) return;

        const now = Date.now();
        const visibleDeadline = Math.max(startedAt, lastVisibilityResumeAt) + timeoutMs;
        const deadline = isDocumentHidden()
            ? Math.max(visibleDeadline, startedAt + timeoutMs + hiddenGraceMs)
            : visibleDeadline;

        if (now < deadline) {
            timerId = setTimeout(check, Math.max(MIN_RECHECK_MS, deadline - now));
            return;
        }

        timerId = null;
        onExpire();
    };

    timerId = setTimeout(check, timeoutMs);

    return () => {
        cancelled = true;
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    };
}
