const LEADING_SPACE_ENTITY = /^[ \t]*(?:&#(?:x20|32);[ \t]*)+/i;

export function normalizeMermaidSourceArtifacts(definition) {
    let source = String(definition || '').replace(/^[^\r\n]*/gm, line =>
        LEADING_SPACE_ENTITY.test(line)
            ? line.replace(LEADING_SPACE_ENTITY, ' ')
            : line
    );
    // 仅修复流程图中带显式 ID 和标题的 subgroup 拼写，保留子图连线引用。
    if (/^[ \t]*(?:flowchart|graph)[ \t]+(?:TB|TD|BT|RL|LR)\b/im.test(source)
        && /^[ \t]*end[ \t]*;?[ \t]*\r?$/im.test(source)) {
        source = source.replace(
            /^([ \t]*)subgroup(?=[ \t]+[A-Za-z_][A-Za-z0-9_:-]*[ \t]*\[(?:"[^"\r\n]*"|[^\[\]"\r\n]+)\][ \t]*;?[ \t]*(?:%%[^\r\n]*)?\r?$)/gim,
            '$1subgraph'
        );
    }
    if (/^\s*flowchart\s+(?:TB|TD|BT|RL|LR)\b/im.test(source)
        && !/^\s*subgraph\b/im.test(source)
        && /^\s*end(?:\s|$|[\u3400-\u9fff])/im.test(source)) {
        source = source.replace(/^(\s*)subg(\["[^"\r\n]+"\])\s*$/im, '$1subgraph subg$2');
    }
    return source;
}

export function wrapStandaloneMermaidDefinition(markdown) {
    const source = String(markdown || '');
    const lines = source.trim().split(/\r?\n/);
    if (lines.length < 2 || lines.some(line => /^\s*(```|~~~)/.test(line))) return source;

    const normalizedSource = normalizeMermaidSourceArtifacts(source.trim());
    const normalizedLines = normalizedSource.split(/\r?\n/).map(line => line.trim());
    const directiveIndex = /^%%\{init\s*:/i.test(normalizedLines[0]) ? 1 : 0;
    if (!/^flowchart\s+(?:TB|TD|BT|RL|LR)\s*;?$/i.test(normalizedLines[directiveIndex] || '')) return source;

    const diagramLines = [...normalizedLines];
    let trailingText = '';
    const lastIndex = diagramLines.length - 1;
    const trailingEnd = diagramLines[lastIndex]?.match(/^(end)([\u3400-\u9fff].*)$/i);
    if (trailingEnd) {
        diagramLines[lastIndex] = trailingEnd[1];
        trailingText = trailingEnd[2];
    }
    const body = diagramLines.slice(directiveIndex + 1).filter(Boolean);
    if (!body.some(line => /(?:-->|==>|-\.->)/.test(line))) return source;
    if (!body.every(line => /^(?:%%|end\b|subgraph\b|classDef\b|class\b|linkStyle\b|style\b|[A-Za-z][A-Za-z0-9_:-]*\s*(?:\[|\(|\{|-->|==>|-\.->))/i.test(line))) return source;

    return `\`\`\`mermaid\n${diagramLines.join('\n')}\n\`\`\`${trailingText ? `\n${trailingText}` : ''}`;
}
