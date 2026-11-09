import { KEYBOARD_SOURCE } from './keyboard-source.js';

const SOURCE_CLASSES = [
    'kb-source-virtual-keyboard',
    'kb-source-visual-resize',
    'kb-source-layout-resize'
];

const managesLocalGeometry = (source) =>
    source === KEYBOARD_SOURCE.VIRTUAL ||
    source === KEYBOARD_SOURCE.VISUAL;

export function createGeometryPresenter({ session }) {
    let activeSurface = null;
    let appliedTop = -1;
    let appliedHeight = -1;
    let transitionId = 0;
    let token = null;
    let viewportSource = null;
    let appliedLayoutHeight = null;

    const mintToken = () => {
        token = `browser-keyboard-${++transitionId}`;
        return token;
    };

    const setLayoutHeight = (height) => {
        if (height === appliedLayoutHeight) return false;
        document.documentElement.style.setProperty(
            '--browser-layout-viewport-height',
            `${height}px`
        );
        appliedLayoutHeight = height;
        return true;
    };

    const clearLayoutHeight = () => {
        if (appliedLayoutHeight === null &&
            !document.documentElement.style.getPropertyValue(
                '--browser-layout-viewport-height'
            )) {
            return false;
        }
        document.documentElement.style.removeProperty(
            '--browser-layout-viewport-height'
        );
        appliedLayoutHeight = null;
        return true;
    };

    const setSource = (source) => {
        if (source === viewportSource) return false;
        const root = document.documentElement;
        root.classList.remove(...SOURCE_CLASSES);
        if (source !== KEYBOARD_SOURCE.PENDING) {
            root.classList.add(`kb-source-${source}`);
        }
        viewportSource = source;
        return true;
    };

    const setViewport = (source, layoutHeight) => {
        setSource(source);
        if (source === KEYBOARD_SOURCE.VIRTUAL) setLayoutHeight(layoutHeight);
        else clearLayoutHeight();
    };

    const clearManagedGeometry = (surface) => {
        if (!surface?.root) return false;
        const managed =
            surface.root.classList.contains('browser-viewport-managed');
        surface.root.classList.remove('browser-viewport-managed');
        surface.root.style.removeProperty('--browser-visual-viewport-top');
        surface.root.style.removeProperty('--browser-visual-viewport-height');
        return managed;
    };

    const commitGeometry = (surface, geometry, preserveAnchor = false) => {
        if (!surface?.root?.isConnected || !geometry) return false;
        if (activeSurface && activeSurface !== surface) clear(activeSurface);
        activeSurface = surface;

        if (!managesLocalGeometry(geometry.source)) {
            const changed = clearManagedGeometry(surface);
            appliedTop = -1;
            appliedHeight = -1;
            session.setGeometry(0, 0);
            return changed;
        }

        const geometryTop = geometry.top;
        const managed =
            surface.root.classList.contains('browser-viewport-managed');
        const heightChanged = geometry.height !== appliedHeight || !managed;
        const topChanged = geometryTop !== appliedTop;
        if (!heightChanged && !topChanged) return false;

        const commit = () => {
            surface.root.style.setProperty(
                '--browser-visual-viewport-top',
                `${geometryTop}px`
            );
            surface.root.style.setProperty(
                '--browser-visual-viewport-height',
                `${geometry.height}px`
            );
            surface.root.classList.add('browser-viewport-managed');
            appliedTop = geometryTop;
            appliedHeight = geometry.height;
            session.setGeometry(0, geometryTop);
        };

        if (preserveAnchor && heightChanged && surface.onGeometryChange) {
            surface.onGeometryChange(commit, { token });
        } else {
            commit();
        }
        return true;
    };

    function clear(surface = activeSurface) {
        if (!surface?.root) return;
        clearManagedGeometry(surface);
        if (surface !== activeSurface) return;
        activeSurface = null;
        appliedTop = -1;
        appliedHeight = -1;
        session.setGeometry(0, 0);
    }

    const open = (surface, geometry, size) => {
        mintToken();
        if (geometry.source === KEYBOARD_SOURCE.VIRTUAL) {
            session.willChange('open', size, surface);
        }
        session.setOpenState(true);
        commitGeometry(
            surface,
            geometry,
            true
        );
        session.changed('open', size, surface);
    };

    const openLayout = (surface, size) => {
        mintToken();
        clear(surface);
        activeSurface = surface;
        session.setOpenState(true);
        session.changed('open', size, surface);
    };

    const commitLayout = (surface) => {
        if (!surface?.root?.isConnected) return false;
        if (activeSurface && activeSurface !== surface) clear(activeSurface);
        if (surface.root.classList.contains('browser-viewport-managed')) {
            clear(surface);
        }
        activeSurface = surface;
        return false;
    };

    const close = (surface) => {
        mintToken();
        if (viewportSource === KEYBOARD_SOURCE.VIRTUAL) {
            session.willChange('close', 0, surface);
        }
        session.setOpenState(false);
        clear(surface);
        session.changed('close', 0, surface);
    };

    return {
        commitGeometry,
        open,
        openLayout,
        commitLayout,
        close,
        clear,
        setViewport,
        clearLayoutHeight,
        clearSource: () => {
            setSource(KEYBOARD_SOURCE.PENDING);
        },
        getToken: () => token,
        getAppliedGeometry: () => ({
            top: appliedTop,
            height: appliedHeight
        })
    };
}
