// Split the synchronous application graph without making lazy features eager.
// Keep shared dependencies together to avoid introducing chunk-level cycles.
export function createApplicationChunks(entryId) {
    const entry = entryId.replace(/\\/g, '/');
    const root = entry.slice(0, -'src/main.js'.length);
    return (id, { getModuleInfo }) => {
        const normalized = id.replace(/\\/g, '/');
        if (normalized.includes('/node_modules/')) return 'vendor';
        if (normalized === entry || !/\.[cm]?js(?:\?|$)/.test(normalized)) return undefined;
        if (!normalized.startsWith(`${root}src/`) && !normalized.startsWith(`${root}shared-runtime/`)) return undefined;

        // Walk static importers only. Dynamic feature roots stay under Rollup's
        // automatic splitting, while dependencies also used at startup are shared.
        const pending = [id];
        const visited = new Set();
        while (pending.length) {
            const current = pending.pop();
            if (visited.has(current)) continue;
            visited.add(current);
            if (current.replace(/\\/g, '/') === entry) return 'app-runtime';
            for (const importer of getModuleInfo(current)?.importers || []) pending.push(importer);
        }
        return undefined;
    };
}
