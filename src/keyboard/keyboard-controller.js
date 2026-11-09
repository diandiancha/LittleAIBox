import { Capacitor } from '@capacitor/core';
import { createBrowserKeyboardDriver } from './drivers/browser-driver.js';
import { createNativeKeyboardDriver } from './drivers/native-driver.js';

export function createKeyboardController() {
    const isNative = Capacitor.isNativePlatform();
    const root = document.documentElement;
    root.classList.toggle('kb-regime-native', isNative);

    const emitWillChange = (surface, detail) => {
        if (surface?.root.isConnected) surface.onWillChange?.(detail);
    };
    const emitChanged = (surface, detail) => {
        if (surface?.root.isConnected) surface.onChanged?.(detail);
    };
    const options = { emitWillChange, emitChanged };
    const driver = isNative
        ? createNativeKeyboardDriver({
            ...options,
            nativePlatform: Capacitor.getPlatform()
        })
        : createBrowserKeyboardDriver(options);

    return {
        init: () => driver.init(),
        destroy: () => driver.destroy(),
        dismiss: () => driver.dismiss(),
        isVisible: () => driver.isVisible()
    };
}
