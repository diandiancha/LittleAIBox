import { throwIfParseAborted } from './parse-task.js';

export function yieldToBrowser(signal) {
    throwIfParseAborted(signal);
    return new Promise((resolve, reject) => {
        let frame;
        let timer;
        const cleanup = () => {
            clearTimeout(timer);
            if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
            signal?.removeEventListener('abort', onAbort);
        };
        const finish = () => {
            cleanup();
            resolve();
        };
        const onAbort = () => {
            cleanup();
            reject(signal.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (typeof requestAnimationFrame === 'function') {
            frame = requestAnimationFrame(finish);
            // Background tabs may stop delivering animation frames.
            timer = setTimeout(finish, 100);
            return;
        }
        timer = setTimeout(finish, 0);
    });
}
