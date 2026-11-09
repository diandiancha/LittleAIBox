import { Keyboard } from '@capacitor/keyboard';
import { getActiveKeyboardSurface } from '../keyboard-surfaces.js';
import { createKeyboardSession } from '../keyboard-session.js';

export function createNativeKeyboardDriver({
    emitWillChange,
    emitChanged,
    nativePlatform
}) {
    let initialized = false;
    let destroyed = false;
    let isKeyboardVisible = false;
    let isKeyboardClosing = false;
    let lastKeyboardToggle = 0;
    let keyboardClosingTimer = null;
    let pendingHideBlur = null;
    const nativeListenerHandles = [];
    const KEYBOARD_DEBOUNCE_MS = 300;
    const session = createKeyboardSession({
        compensatesInCss: true,
        emitWillChange,
        emitChanged,
        onSurfaceUnregistered: (surface) => {
            if (pendingHideBlur?.surface === surface) pendingHideBlur = null;
            isKeyboardVisible = false;
            isKeyboardClosing = false;
            lastAppliedKeyboardHeight = 0;
        }
    });

    let lastAppliedKeyboardHeight = 0;

    const getVisualViewportOffset = () => {
        if (!isKeyboardVisible) return 0;
        return Math.max(
            0,
            Math.round(window.visualViewport?.offsetTop || 0)
        );
    };

    const applyNativeGeometry = (keyboardHeight) => {
        const measured = Math.max(0, keyboardHeight);
        session.setGeometry(measured, getVisualViewportOffset());
        lastAppliedKeyboardHeight = measured;
    };

    const syncVisualViewportOffset = () => {
        session.setGeometry(
            lastAppliedKeyboardHeight,
            getVisualViewportOffset()
        );
    };

    const measureKeyboardHeight = () => {
        const visualViewport = window.visualViewport;
        if (!visualViewport) return null;
        return Math.max(0, Math.round(window.innerHeight - visualViewport.height));
    };

    const syncKeyboardHeight = () => {
        if (!isKeyboardVisible) return;
        const measured = measureKeyboardHeight();
        if (measured == null || measured < 50) return;
        if (Math.abs(measured - lastAppliedKeyboardHeight) < 8) return;
        applyNativeGeometry(measured);
    };

    const handleVisualViewportChange = () => {
        syncVisualViewportOffset();
        syncKeyboardHeight();
    };

    const setKeyboardOpenState = (visible) => {
        isKeyboardVisible = visible;
        session.setOpenState(visible);
        if (!visible) {
            applyNativeGeometry(0);
        }
    };

    const handleKeyboardWillShow = (info) => {
        const keyboardHeight = Math.max(0, Number(info?.keyboardHeight || 0));
        pendingHideBlur = null;
        isKeyboardClosing = false;
        if (keyboardClosingTimer) window.clearTimeout(keyboardClosingTimer);
        keyboardClosingTimer = null;
        const surface = session.adopt(getActiveKeyboardSurface());
        session.willChange('open', keyboardHeight, surface);
        setKeyboardOpenState(true);
        applyNativeGeometry(keyboardHeight);
        requestAnimationFrame(() => {
            if (!destroyed) syncKeyboardHeight();
        });
    };

    const handleKeyboardDidShow = () => {
        pendingHideBlur = null;
        isKeyboardClosing = false;
        if (keyboardClosingTimer) window.clearTimeout(keyboardClosingTimer);
        keyboardClosingTimer = null;
        setKeyboardOpenState(true);
        syncKeyboardHeight();
        const surface = session.getSurface();
        session.changed('open', lastAppliedKeyboardHeight, surface ?? undefined);
    };

    const handleKeyboardWillHide = () => {
        isKeyboardClosing = false;
        if (keyboardClosingTimer) window.clearTimeout(keyboardClosingTimer);
        keyboardClosingTimer = null;
        const surface = session.adopt(
            getActiveKeyboardSurface(),
            { fallbackToCurrent: true }
        );
        pendingHideBlur = surface && getActiveKeyboardSurface() === surface
            ? { surface, input: document.activeElement }
            : null;
        session.willChange('close', 0, surface ?? undefined);
        setKeyboardOpenState(false);
    };

    const handleKeyboardDidHide = () => {
        isKeyboardClosing = false;
        if (keyboardClosingTimer) window.clearTimeout(keyboardClosingTimer);
        keyboardClosingTimer = null;
        const pendingBlur = pendingHideBlur;
        pendingHideBlur = null;
        const surface = pendingBlur?.surface || session.getSurface();
        setKeyboardOpenState(false);
       
        if (pendingBlur && document.activeElement === pendingBlur.input &&
            getActiveKeyboardSurface() === pendingBlur.surface) {
            session.blur(pendingBlur.surface);
        }
        session.changed('close', 0, surface ?? undefined);
        session.release();
    };

    const dismiss = () => {
        if (isKeyboardClosing) return;
        const shouldTrackClosing = isKeyboardVisible;
        if (shouldTrackClosing) {
            isKeyboardClosing = true;
            if (keyboardClosingTimer) window.clearTimeout(keyboardClosingTimer);
            keyboardClosingTimer = window.setTimeout(() => {
                keyboardClosingTimer = null;
                isKeyboardClosing = false;
            }, 600);
        }
        Promise.resolve(Keyboard.hide()).catch(() => {
            if (shouldTrackClosing) {
                isKeyboardClosing = false;
            }
        });
    };

    const handlePointerStart = (event) => {
        if (!isKeyboardVisible || isKeyboardClosing) return;

        const now = Date.now();
        if (now - lastKeyboardToggle < KEYBOARD_DEBOUNCE_MS) return;
        if (!session.shouldDismiss(event)) return;

        event.preventDefault();
        lastKeyboardToggle = now;
        dismiss();
    };

    const handleTouchMove = (event) => {
        if (!isKeyboardVisible || !(event.target instanceof Element)) return;
        const surface = session.getSurface();
        if (!surface) return;
        if (!surface.root.contains(event.target)) return;
        const canMove = surface.touchMoveSelector &&
            event.target.closest(surface.touchMoveSelector);
        if (!canMove) {
            event.preventDefault();
        }
    };

    const trackNativeListener = (eventName, handler) => {
        Promise.resolve(Keyboard.addListener(eventName, handler))
            .then((handle) => {
                if (!handle?.remove) return;
                if (destroyed) {
                    handle.remove();
                    return;
                }
                nativeListenerHandles.push(handle);
            })
            .catch((error) => {
                console.error(`Failed to register keyboard listener: ${eventName}`, error);
            });
    };

    const init = () => {
        if (initialized || destroyed) return false;
        initialized = true;

        try {
            if (nativePlatform === 'ios') {
                Keyboard.setScroll({ isDisabled: true }).catch((error) => {
                    console.error('Failed to configure keyboard scroll:', error);
                });
                Keyboard.setResizeMode({ mode: 'native' }).catch((error) => {
                    console.error('Failed to configure keyboard resize mode:', error);
                });
            }
        } catch (error) {
            console.error('Failed to configure keyboard:', error);
        }

        trackNativeListener('keyboardWillShow', handleKeyboardWillShow);
        trackNativeListener('keyboardDidShow', handleKeyboardDidShow);
        trackNativeListener('keyboardWillHide', handleKeyboardWillHide);
        trackNativeListener('keyboardDidHide', handleKeyboardDidHide);

        document.addEventListener('mousedown', handlePointerStart);
        document.addEventListener('touchstart', handlePointerStart, { passive: false });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.visualViewport?.addEventListener(
            'scroll',
            handleVisualViewportChange,
            { passive: true }
        );
        window.visualViewport?.addEventListener(
            'resize',
            handleVisualViewportChange,
            { passive: true }
        );
        return true;
    };

    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        initialized = false;

        document.removeEventListener('mousedown', handlePointerStart);
        document.removeEventListener('touchstart', handlePointerStart);
        document.removeEventListener('touchmove', handleTouchMove);
        window.visualViewport?.removeEventListener(
            'scroll',
            handleVisualViewportChange
        );
        window.visualViewport?.removeEventListener(
            'resize',
            handleVisualViewportChange
        );

        nativeListenerHandles.splice(0).forEach((handle) => {
            try {
                handle.remove();
            } catch (_) { }
        });

        if (keyboardClosingTimer) window.clearTimeout(keyboardClosingTimer);
        keyboardClosingTimer = null;
        pendingHideBlur = null;
        setKeyboardOpenState(false);
        session.destroy();
    };

    return {
        init,
        destroy,
        dismiss,
        isVisible: () => isKeyboardVisible
    };
}
