import {
    createKeyboardSession,
    KEYBOARD_CLOSE_THRESHOLD,
    KEYBOARD_OPEN_THRESHOLD
} from '../keyboard-session.js';
import {
    getActiveKeyboardSurface,
    getKeyboardSurfaceForTarget
} from '../keyboard-surfaces.js';
import { createGeometryPresenter } from './browser/geometry-presenter.js';
import {
    createKeyboardFsm,
    getKeyboardCloseConfirmMs
} from './browser/keyboard-fsm.js';
import { KEYBOARD_SOURCE } from './browser/keyboard-source.js';
import {
    createKeyboardSourceRouter
} from './browser/keyboard-source-router.js';
import {
    createViewportDebouncer,
    DEFAULT_STABLE_HOLD_MS
} from './browser/viewport-debouncer.js';
import { createViewportSampler } from './browser/viewport-sampler.js';
import { createViewportReader } from './browser/viewport-reader.js';
import {
    resolveVisualRootGeometry
} from './browser/visual-root-geometry.js';

const FOCUS_OUT_SETTLE_MS = 120;

export function createBrowserKeyboardDriver({ emitWillChange, emitChanged }) {
    let initialized = false;
    let destroyed = false;
    let activeSurface = null;
    let syncRaf = null;
    let focusOutTimer = null;
    let closeConfirmTimer = null;
    let stableProbeTimer = null;
    let syncReason = 'i';
    let virtualKeyboardEventCount = 0;
    let visualSessionBaselineHeight = 0;
    let presenter = null;

    const sampler = createViewportSampler();
    const debouncer = createViewportDebouncer();
    const sourceRouter = createKeyboardSourceRouter({
        minKeyboardInset: KEYBOARD_OPEN_THRESHOLD
    });
    const fsm = createKeyboardFsm({
        openThreshold: KEYBOARD_OPEN_THRESHOLD,
        closeThreshold: KEYBOARD_CLOSE_THRESHOLD,
        closeConfirmMs: getKeyboardCloseConfirmMs
    });

    const session = createKeyboardSession({
        compensatesInCss: false,
        emitWillChange: (surface, detail) => {
            emitWillChange(surface, {
                ...detail,
                token: presenter?.getToken() || null
            });
        },
        emitChanged: (surface, detail) => {
            emitChanged(surface, {
                ...detail,
                token: presenter?.getToken() || null
            });
        },
        onSurfaceUnregistered: (surface) => {
            if (activeSurface !== surface) return;
            presenter?.clear(surface);
            activeSurface = null;
            fsm.reset();
            debouncer.reset();
            cancelCloseConfirm();
            cancelStableProbe();
        }
    });
    presenter = createGeometryPresenter({ session });
    const readViewport = createViewportReader({
        getVirtualKeyboard: sourceRouter.getVirtualKeyboard
    });

    const processSample = (rawSample) => {
        const surface = session.getSurface() || activeSurface;
        if (!surface?.root?.isConnected) return;
        activeSurface = surface;

        if (!fsm.isOpen() &&
            rawSample.insetBottom < KEYBOARD_OPEN_THRESHOLD &&
            (!rawSample.keyboardFocused || rawSample.reason === 'f')) {
            visualSessionBaselineHeight = rawSample.viewportHeight;
        }

        const routed = sourceRouter.resolve(rawSample);
        const keyboardExtent =
            routed.keyboardSource === KEYBOARD_SOURCE.VISUAL
                ? Math.max(
                    0,
                    visualSessionBaselineHeight - routed.viewportHeight
                )
                : routed.insetBottom;
        const resolved = {
            ...routed,
            keyboardExtent,
            visualViewportMode:
                routed.keyboardSource === KEYBOARD_SOURCE.VISUAL
                    ? 'resize'
                    : null
        };
        const { sample, waiting } = debouncer.resolve(resolved);
        presenter.setViewport(
            sample.keyboardSource,
            sample.layoutHeight
        );

        const result = fsm.step(sample);
        const visualGeometry = resolveVisualRootGeometry(sample);
        const geometry = {
            top: sample.keyboardSource === KEYBOARD_SOURCE.VISUAL
                ? visualGeometry.top
                : sample.viewportTop,
            height: sample.keyboardSource === KEYBOARD_SOURCE.VISUAL
                ? visualGeometry.height
                : sample.viewportHeight,
            insetBottom: sample.insetBottom,
            source: sample.keyboardSource
        };
        const layoutManaged =
            sample.keyboardSource === KEYBOARD_SOURCE.LAYOUT;

        if (result.transition === 'open') {
            if (layoutManaged) {
                presenter.openLayout(surface, sample.keyboardExtent);
            } else {
                presenter.open(surface, geometry, sample.insetBottom);
            }
        } else if (result.transition === 'close') {
            presenter.close(surface);
            visualSessionBaselineHeight = sample.viewportHeight;
            if (!getActiveKeyboardSurface()) session.release();
            sourceRouter.resetSession();
            presenter.setViewport(
                sourceRouter.getSource(),
                sample.layoutHeight
            );
            debouncer.reset();
        } else if (fsm.isOpen()) {
            if (layoutManaged) presenter.commitLayout(surface);
            else presenter.commitGeometry(surface, geometry, true);
        }

        syncCloseConfirm(
            result.pendingClose,
            getKeyboardCloseConfirmMs(sample),
            sample.reason !== 'c'
        );
        syncStableProbe(waiting);
    };

    const sampleNow = () => {
        const rawSample = sampler.sample(
            readViewport(syncReason, virtualKeyboardEventCount)
        );
        processSample(rawSample);
    };

    function cancelCloseConfirm() {
        if (closeConfirmTimer === null) return;
        window.clearTimeout(closeConfirmTimer);
        closeConfirmTimer = null;
    }

    function cancelStableProbe() {
        if (stableProbeTimer === null) return;
        window.clearTimeout(stableProbeTimer);
        stableProbeTimer = null;
    }

    function syncStableProbe(waiting) {
        if (!waiting) {
            cancelStableProbe();
            return;
        }
        if (stableProbeTimer !== null) return;
        stableProbeTimer = window.setTimeout(() => {
            stableProbeTimer = null;
            if (destroyed) return;
            syncReason = 'q';
            sampleNow();
        }, DEFAULT_STABLE_HOLD_MS);
    }

    function syncCloseConfirm(pending, confirmMs, restart = false) {
        if (!pending) {
            cancelCloseConfirm();
            return;
        }
        if (restart) cancelCloseConfirm();
        if (closeConfirmTimer !== null) return;
        closeConfirmTimer = window.setTimeout(() => {
            closeConfirmTimer = null;
            if (destroyed) return;
            syncReason = 'c';
            sampleNow();
        }, confirmMs + 32);
    }

    const syncViewport = (reason) => {
        syncReason = reason || syncReason;
        if (destroyed || syncRaf !== null) return;
        syncRaf = requestAnimationFrame(() => {
            syncRaf = null;
            if (!destroyed) sampleNow();
        });
    };

    const adoptSurface = (surface) => {
        if (!surface) return;
        if (focusOutTimer !== null) {
            window.clearTimeout(focusOutTimer);
            focusOutTimer = null;
        }
        if (activeSurface && activeSurface !== surface) {
            presenter.clear(activeSurface);
        }
        activeSurface = surface;
        session.adopt(surface);
        sampleNow();
    };

    const handleFocusIn = (event) => {
        syncReason = 'f';
        adoptSurface(getKeyboardSurfaceForTarget(event.target));
    };

    const handleFocusOut = () => {
        if (focusOutTimer !== null) window.clearTimeout(focusOutTimer);
        focusOutTimer = window.setTimeout(() => {
            focusOutTimer = null;
            const nextSurface = getActiveKeyboardSurface();
            if (nextSurface) {
                adoptSurface(nextSurface);
                return;
            }
            syncViewport('f');
        }, FOCUS_OUT_SETTLE_MS);
    };

    const handlePointerDown = (event) => {
        if (!fsm.isOpen()) return;
        if (!session.shouldDismiss(event)) return;
        session.blur();
        syncViewport('d');
    };

    const handleVirtualKeyboardGeometry = () => {
        virtualKeyboardEventCount += 1;
        syncViewport('v');
    };
    const handleWindowResize = () => syncViewport('w');
    const handleViewportResize = () => syncViewport('r');
    const handleViewportScroll = () => syncViewport('s');
    const handleViewportScrollEnd = () => syncViewport('e');

    const init = () => {
        if (initialized || destroyed || !window.visualViewport) return false;
        initialized = true;
        sourceRouter.init();

        const initialSample = sampler.sample(readViewport('i'));
        visualSessionBaselineHeight = initialSample.viewportHeight;
        presenter.setViewport(
            sourceRouter.getSource(),
            initialSample.layoutHeight
        );
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('focusout', handleFocusOut);
        document.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('resize', handleWindowResize, {
            passive: true
        });
        window.visualViewport.addEventListener(
            'resize',
            handleViewportResize,
            { passive: true }
        );
        window.visualViewport.addEventListener(
            'scroll',
            handleViewportScroll,
            { passive: true }
        );
        window.visualViewport.addEventListener(
            'scrollend',
            handleViewportScrollEnd,
            { passive: true }
        );
        sourceRouter.getVirtualKeyboard()?.addEventListener(
            'geometrychange',
            handleVirtualKeyboardGeometry
        );

        const initialSurface = getActiveKeyboardSurface();
        if (initialSurface) adoptSurface(initialSurface);
        return true;
    };

    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        initialized = false;
        document.removeEventListener('focusin', handleFocusIn);
        document.removeEventListener('focusout', handleFocusOut);
        document.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('resize', handleWindowResize);
        window.visualViewport?.removeEventListener(
            'resize',
            handleViewportResize
        );
        window.visualViewport?.removeEventListener(
            'scroll',
            handleViewportScroll
        );
        window.visualViewport?.removeEventListener(
            'scrollend',
            handleViewportScrollEnd
        );
        sourceRouter.getVirtualKeyboard()?.removeEventListener(
            'geometrychange',
            handleVirtualKeyboardGeometry
        );
        if (syncRaf !== null) cancelAnimationFrame(syncRaf);
        if (focusOutTimer !== null) window.clearTimeout(focusOutTimer);
        focusOutTimer = null;
        cancelCloseConfirm();
        cancelStableProbe();
        debouncer.reset();
        presenter.clear();
        presenter.clearLayoutHeight();
        presenter.clearSource();
        sourceRouter.destroy();
        fsm.reset();
        session.destroy();
    };

    return {
        init,
        destroy,
        dismiss: () => session.blur(),
        isVisible: () => fsm.isOpen()
    };
}
