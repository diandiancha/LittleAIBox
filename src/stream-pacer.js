const ARRIVAL_WINDOW_MS = 2400;

export function createStreamPacer(modelId, initialSpeed, now = () => performance.now()) {
    const model = String(modelId || '').toLowerCase();
    const isClaude = model.startsWith('claude-');
    const isGpt = model.startsWith('gpt-');
    if (!isClaude && !/^(?:gpt-|o[134](?:-|$)|grok-|deepseek)/.test(model)) return null;

    const baseRate = isClaude || isGpt ? 40 : 30;
    const initialRate = Math.min(baseRate * 1.2, Math.max(12, (Number(initialSpeed) || 1) * baseRate));
    const readableRateLimit = isClaude ? 50 : isGpt ? 60 : 48;
    const maxReadableRate = Math.min(readableRateLimit, initialRate * 1.5);
    const reserveMs = isClaude ? 480 : 320;
    const arrivals = [];
    let totalReceived = 0;
    let chunkIntervalMs = 0;
    let lastTickAt = null;
    let renderRate = initialRate;
    let credit = 0;

    return {
        initialBufferChars: isClaude ? 24 : 20,
        resumeBufferChars: isClaude ? 16 : 12,
        initialWaitMs: isClaude ? 240 : 180,
        resumeWaitMs: isClaude ? 160 : 120,

        recordArrival(count) {
            if (!(count > 0)) return;
            const time = now();
            totalReceived += count;
            const last = arrivals[arrivals.length - 1];
            // 同一批解析出的文字、图片槽和画布标记合并采样。
            if (last && time - last.time < 16) {
                last.total = totalReceived;
            } else {
                if (last) {
                    const interval = Math.min(2000, time - last.time);
                    chunkIntervalMs = chunkIntervalMs
                        ? chunkIntervalMs * 0.75 + interval * 0.25
                        : interval;
                }
                arrivals.push({ time, total: totalReceived });
            }
            while (arrivals.length > 2 && arrivals[1].time < time - ARRIVAL_WINDOW_MS) {
                arrivals.shift();
            }
        },

        resetRenderClock() {
            lastTickAt = null;
            credit = 0;
        },

        take(queueLength, done = false) {
            const time = now();
            // 为正常渲染耗时补足进度，长时间卡顿最多补偿 100ms，避免集中吐字。
            const elapsedMs = lastTickAt === null ? 16 : Math.min(100, Math.max(0, time - lastTickAt));
            lastTickAt = time;
            if (queueLength === 0) {
                credit = 0;
                return 0;
            }

            let targetRate;
            if (done) {
                // 正文已全部缓冲，平滑提升到阅读上限，避免锁在起步或断流时的低速。
                targetRate = maxReadableRate;
            } else {
                const first = arrivals[0];
                const last = arrivals[arrivals.length - 1];
                const arrivalRate = arrivals.length > 1
                    ? (last.total - first.total) * 1000 / Math.max(200, time - first.time)
                    : initialRate;
                const targetBuffer = Math.max(8, Math.min(180,
                    arrivalRate * (reserveMs + chunkIntervalMs * 0.5) / 1000));
                targetRate = Math.max(2, Math.min(maxReadableRate,
                    arrivalRate + (queueLength - targetBuffer) / 1.6));
                // 上游长时间没有正文时仍释放尾部，避免少量文字一直留在缓冲区。
                if (last && time - last.time > Math.max(1500, chunkIntervalMs * 2)) {
                    targetRate = Math.max(8, targetRate);
                }
            }
            const smoothingMs = targetRate < renderRate ? 180 : 500;
            renderRate += (targetRate - renderRate) * (1 - Math.exp(-elapsedMs / smoothingMs));

            credit += renderRate * elapsedMs / 1000;
            const count = Math.min(queueLength, Math.floor(credit));
            credit -= count;
            if (count === queueLength) credit = 0;
            return count;
        }
    };
}
