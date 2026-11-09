const DEFAULT_PARSE_IDLE_TIMEOUT_MS = 300000;
const progressCallbacks = new WeakMap();

export function throwIfParseAborted(signal) {
    if (signal?.aborted) throw signal.reason;
}

export function reportParseProgress(signal) {
    throwIfParseAborted(signal);
    progressCallbacks.get(signal)?.();
}

// Compressed file size does not predict parsing cost. By default, only time
// without progress is limited; an explicit timeoutMs retains its total deadline.
export function getParseTimeoutMs(_file, options = {}) {
    if (Number.isFinite(options.timeoutMs)) return options.timeoutMs;
    return DEFAULT_PARSE_IDLE_TIMEOUT_MS;
}

export async function runParseTask(task, file, options, timeoutMessage) {
    const controller = new AbortController();
    const timeoutMs = getParseTimeoutMs(file, options);
    let timer;
    const timeout = new Promise((_, reject) => {
        if (timeoutMs <= 0) return;
        const armTimeout = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const error = new Error(timeoutMessage || 'File parsing stalled. Try splitting the file.');
                error.code = 'FILE_PARSE_TIMEOUT';
                controller.abort(error);
                reject(error);
            }, timeoutMs);
        };
        if (!Number.isFinite(options?.timeoutMs)) {
            progressCallbacks.set(controller.signal, armTimeout);
        }
        armTimeout();
    });
    try {
        // Start inside the race so synchronous errors also clear the timer.
        return await Promise.race([Promise.resolve().then(() => task(controller.signal)), timeout]);
    } finally {
        clearTimeout(timer);
        progressCallbacks.delete(controller.signal);
    }
}

export async function runParserWorker(file, createWorker, signal, request = {}) {
    const buffer = await file.arrayBuffer();
    reportParseProgress(signal);
    const worker = createWorker();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return await new Promise((resolve, reject) => {
        const cleanup = () => {
            signal.removeEventListener('abort', onAbort);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        };
        const fail = (error) => {
            cleanup();
            reject(error);
        };
        const onAbort = () => fail(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        worker.onmessage = (event) => {
            const payload = event.data || {};
            if (payload.id !== id) return;
            if (payload.type === 'progress') {
                reportParseProgress(signal);
                return;
            }
            cleanup();
            if (payload.ok) {
                reportParseProgress(signal);
                resolve(payload);
            }
            else reject(new Error(payload.error || 'File worker parse failed.'));
        };
        worker.onerror = (event) => fail(new Error(event?.message || 'File worker failed.'));
        worker.onmessageerror = () => fail(new Error('File worker result could not be read.'));
        try {
            throwIfParseAborted(signal);
            worker.postMessage({ ...request, id, buffer }, [buffer]);
        } catch (error) {
            fail(error);
        }
    });
}
