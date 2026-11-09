import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { buildMermaidConfig, getAppFontFamily, isDarkThemeRoot } from './chart-theme-config.js';
import { normalizeMermaidColorFormats } from './mermaid-color-normalizer.js';
import { normalizeMermaidSourceArtifacts } from './mermaid-source-normalizer.js';

export const MERMAID_SCRIPT_SOURCES = [
    '/libs/mermaid.min.js'
];
const MERMAID_GLOBAL = 'mermaid';
// Mermaid 会把 `#xxx;` 编码成 HTML 实体，只对 style/classDef 行豁免末尾分号，linkStyle 不在豁免内。
const LINK_STYLE_COLOR_TERMINATOR = /^([ \t]*linkStyle\b[^\r\n]*#\w+)[ \t]*;[ \t]*$/gim;

function stripLinkStyleColorTerminators(source) {
    return String(source || '').replace(LINK_STYLE_COLOR_TERMINATOR, '$1');
}
const DEFAULT_DOWNLOAD_ICON_PATH = '<path d="M5 20h14a1 1 0 0 0 1-1v-2h-2v1H6v-1H4v2a1 1 0 0 0 1 1zm7-3 5-5h-3V4h-4v8H7l5 5z"/>';

let mermaidInitPromise = null;
let mermaidConfigured = false;
let diagramIdCounter = 0;
const pendingRenders = new Set();

function isRenderableMermaidDefinition(definition) {
    const text = String(definition || '');
    if (!text.trim()) return false;
    const withoutCleanableHtml = text
        .replace(/<br\s*\/?>/gi, '')
        .replace(/<\/?(?:div|p|section|article|pre|blockquote|ul|ol|li|table|tr|td|th)[^>]*>/gi, '')
        .replace(/<\/?(?:span|strong|em|code|b|i|font|small|big|u|s|mark|sub|sup)[^>]*>/gi, '')
        .replace(/<\/?[A-Za-z][A-Za-z0-9_]*_[A-Za-z0-9_]*>/g, '');
    return !/(?:javascript\s*:|data\s*:\s*text\/html|<\s*\/?\s*[a-z][^>\n]*>|on[a-z]+\s*=)/i.test(withoutCleanableHtml);
}

function sanitizeMermaidSvg(svgText) {
    if (!svgText || typeof svgText !== 'string') return '';
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        return window.DOMPurify.sanitize(svgText, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ['script', 'foreignObject'],
            FORBID_ATTR: ['onload', 'onerror']
        });
    }
    return svgText;
}

function normalizeMermaidDirectiveBlocks(definition) {
    return String(definition || '').replace(/%%\{([\s\S]*?)\}%%/g, (match, body) => {
        const compactBody = String(body || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .join(' ');
        return `%%{${compactBody}}%%`;
    });
}

function sanitizeMermaidDefinition(definition) {
    if (typeof definition !== 'string') {
        return '';
    }

    const replacements = [
        { regex: /\r\n?/g, replacement: '\n' },
        { regex: /<([A-Za-z][A-Za-z0-9_]*_[A-Za-z0-9_]*)>/g, replacement: '&lt;$1&gt;' },
        { regex: /<br\s*\/?>/gi, replacement: '\\n' },
        { regex: /<\/?(?:div|p|section|article|pre|blockquote|ul|ol|li|table|tr|td|th)[^>]*>/gi, replacement: '\n' },
        { regex: /<\/?(?:span|strong|em|code|b|i|font|small|big|u|s|mark|sub|sup)[^>]*>/gi, replacement: '' },
        { regex: /&nbsp;/gi, replacement: ' ' }
    ];

    let sanitized = normalizeMermaidDirectiveBlocks(definition);
    for (const { regex, replacement } of replacements) {
        sanitized = sanitized.replace(regex, replacement);
    }
    sanitized = normalizeMermaidColorFormats(sanitized);
    sanitized = normalizeMermaidDirectiveBlocks(sanitized);
    sanitized = sanitized.replace(/<\/?[A-Za-z][^>\n]*>/g, '');
    sanitized = sanitized.replace(/\u00A0/g, ' ');
    sanitized = sanitized
        .replace(/[（]/g, '(')
        .replace(/[）]/g, ')')
        .replace(/[，]/g, ',')
        .replace(/[。]/g, '.')
        .replace(/[：]/g, ':')
        .replace(/[；]/g, ';')
        .replace(/[【]/g, '[')
        .replace(/[】]/g, ']')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—]/g, '-');
    sanitized = sanitized.replace(/[ \t]+$/gm, '');
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
    return sanitized.trim();
}

function normalizeTimelineMermaidInput(definition) {
    const raw = String(definition || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return '';

    const lines = raw.split('\n');
    const firstNonEmpty = lines.find(line => String(line || '').trim()) || '';
    if (!/^\s*timeline\b/i.test(firstNonEmpty)) return '';

    // 针对节点的严格清洗（剔除容易引发 Timeline 解析崩溃的符号）
    const sanitizeNodeText = (text) => String(text || '')
        .replace(/[【】\[\]（()）《》<>]/g, ' ')
        .replace(/[:;；]/g, ' ')
        .replace(/->|=>|--\>|==\>/g, ' → ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const out = ['timeline'];
    let hasTitle = false;
    let hasSection = false;

    const ensureSection = () => {
        if (!hasSection) {
            out.push(`  section Timeline`);
            hasSection = true;
        }
    };

    for (let i = 1; i < lines.length; i += 1) {
        let line = lines[i].trim();
        if (!line || line.startsWith('%%')) continue;

        // 【修复点 1】：处理标题（极其宽容）
        if (/^title\b/i.test(line)) {
            const titleText = line.replace(/^title\s*/i, '');
            // 标题不去括号，只把半角冒号转成全角避免误判
            out.push(`  title ${titleText.replace(/:/g, '：')}`);
            hasTitle = true;
            continue;
        }

        // 处理分段（Section 仍建议清洗）
        const sectionLine = line.match(/^section\s+(.+)$/i);
        if (sectionLine) {
            out.push(`  section ${sanitizeNodeText(sectionLine[1])}`);
            hasSection = true;
            continue;
        }

        // 【修复点 2】：节点处理前，保护时间：09:30 -> 09：30
        line = line.replace(/\b(\d{1,2}):(\d{2})\b/g, '$1：$2');

        let parts = line.split(':').map(s => s.trim());
        while (parts.length > 0 && parts[0] === '') {
            parts.shift();
        }
        if (parts.length === 0) continue;

        parts = parts.map(sanitizeNodeText).filter(Boolean);
        if (parts.length === 0) continue;

        ensureSection();

        if (parts.length === 1) {
            const match = parts[0].match(/^(\d{1,2}：\d{2})\s+(.+)$/);
            if (match) {
                out.push(`    ${match[1]} : ${match[2]}`);
            } else {
                out.push(`    ${parts[0]}`);
            }
        } else {
            const period = parts[0];
            const event = parts.slice(1).join(' - ');
            out.push(`    ${period} : ${event}`);
        }
    }

    if (!hasTitle) {
        out.splice(1, 0, '  title Timeline');
    }

    return out.join('\n');
}

function normalizeMindmapMermaidInput(definition) {
    let raw = String(definition || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return '';

    if (/^```/m.test(raw)) {
        raw = raw.replace(/^```\s*(?:mermaid|mindmap)\s*\n?/i, '');
        raw = raw.replace(/^```\s*\n?/, '');
        raw = raw.replace(/\n?```\s*$/i, '');
    }

    raw = raw
        .replace(/<br\s*\/?>/gi, '\\n')
        .replace(/<\/?(?:div|p|section|article|pre|blockquote|ul|ol|li|table|tr|td|th)[^>]*>/gi, '\n')
        .replace(/<\/?(?:span|strong|em|code|b|i|font|small|big|u|s|mark|sub|sup)[^>]*>/gi, '')
        .replace(/<\/?[A-Za-z][^>\n]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\u00A0/g, ' ');

    const lines = raw.split('\n').map(line => line.replace(/[ \t]+$/g, ''));
    const directiveIndex = lines.findIndex(line => /^\s*mindmap\b/i.test(line.trim()));
    if (directiveIndex === -1) return '';

    const firstContentIndex = lines.findIndex(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('%%');
    });
    if (firstContentIndex !== directiveIndex) return '';

    const preamble = lines
        .slice(0, directiveIndex)
        .filter(line => /^\s*%%/.test(line.trim()));
    const out = [...preamble, 'mindmap'];

    const normalizeMindmapNodeText = (text) => {
        const classMatch = String(text || '').match(/^(.*?)(\s+:::[A-Za-z][A-Za-z0-9_-]*)$/);
        let labelPart = classMatch ? classMatch[1] : String(text || '');
        const classPart = classMatch ? classMatch[2] : '';
        const shapeMatch = labelPart.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(\(\(|\{\{|\(-|\)\)|\(|\[)([\s\S]*)(\)\)|\}\}|-\)|\(\(|\)|\])$/);
        if (shapeMatch) {
            const nodeId = shapeMatch[1];
            const open = shapeMatch[2];
            const descr = shapeMatch[3].replace(/:/g, '：');
            const close = shapeMatch[4];
            return `${nodeId}${open}${descr}${close}${classPart}`.trim();
        }

        labelPart = labelPart
            .replace(/:/g, '：')
            .replace(/\(/g, '（')
            .replace(/\)/g, '）')
            .replace(/\[/g, '［')
            .replace(/\]/g, '］')
            .replace(/\{/g, '｛')
            .replace(/\}/g, '｝');
        return `${labelPart}${classPart}`.trim();
    };

    for (let i = directiveIndex + 1; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('%%')) {
            out.push(trimmed);
            continue;
        }
        const indent = (line.match(/^\s*/) || [''])[0].replace(/\t/g, '  ');
        out.push(`${indent}${normalizeMindmapNodeText(trimmed)}`);
    }

    return out.join('\n').trim();
}

function normalizeAndCorrectMermaid(definition) {
    const normalizedMindmap = normalizeMindmapMermaidInput(definition);
    if (normalizedMindmap) {
        return { corrected: normalizedMindmap, skippedReason: null };
    }

    let text = sanitizeMermaidDefinition(definition);
    if (text.length > 50000) {
        return { corrected: text, skippedReason: 'too-long-for-deep-normalization' };
    }
    const normalizedTimeline = normalizeTimelineMermaidInput(text);
    if (normalizedTimeline) {
        return { corrected: normalizedTimeline, skippedReason: null };
    }

    text = text.replace(/\["([^"\n]*)"\]\s*(?:\n\s*)?(?:\(|\uFF08)([^)\uFF09\]]+)(?:\)|\uFF09)\s*"?\]?/g, (match, label, suffix) => {
        const escapedSuffix = suffix.replace(/>/g, '&gt;').replace(/</g, '&lt;');
        return `["${label} (${escapedSuffix})"]`;
    });

    const collapseMathLineBreaks = (input) => {
        if (!input) return input;
        let out = '';
        let inMath = false;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (ch === '$') {
                inMath = !inMath;
                out += ch;
                continue;
            }
            if (inMath && (ch === '\n' || ch === '\r')) {
                continue;
            }
            out += ch;
        }
        return out;
    };

    text = collapseMathLineBreaks(text);

    if (/^```/m.test(text)) {
        text = text.replace(/^```\s*mermaid\s*\n?/i, '');
        text = text.replace(/^```\s*\n?/, '');
        text = text.replace(/\n?```\s*$/i, '');
    }

    text = text
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2192/g, '-->')
        .replace(/[\u00A0\t]+/g, ' ')
        .replace(/--\|>/g, '-->')
        .replace(/--｜>/g, '-->')
        .replace(/--\|＞/g, '-->')
        .replace(/--｜＞/g, '-->')
        .replace(/==\|>/g, '==>')
        .replace(/==｜>/g, '==>')
        .replace(/-\.\|>/g, '-.->')
        .replace(/-\.｜>/g, '-.->');

    text = text.replace(
        /([)\]"'}])\s*(?:\[(?:\d+(?:\s*,\s*\d+)*)\]\s*)+(?=\s*[A-Za-z][A-Za-z0-9_:-]*\s*(?:-->|==>|-\.->|--x|o--|x--|--o|<-->|<-.->|->|<-))/g,
        '$1\n'
    );
    text = text.replace(
        /([)\]"'}])\s*(?:\[(?:\d+(?:\s*,\s*\d+)*)\]\s*)+(?=\s*$)/gm,
        '$1'
    );

    text = text.replace(
        /([\]\)\}])\s*([A-Za-z][A-Za-z0-9_:-]*\s*(?:-->|==>|-\.->|--x|o--|x--|--o|<-->|<-.->|->|<-))/g,
        '$1\n$2'
    );

    const forceNewlineKeywords = (input, keywords) => {
        if (!input) return input;
        const re = new RegExp(`([^\\n])\\s+(${keywords.join('|')})(?=\\s|$)`, 'gi');
        return input.replace(re, (match, prev, keyword, offset, whole) => {
            if (String(keyword || '').toLowerCase() === 'critical') {
                const lineStart = whole.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
                const prefix = whole.slice(lineStart, offset + String(prev || '').length);
                if (/classDef\s*$/i.test(prefix.trim())) {
                    return `${prev} ${keyword}`;
                }
            }
            return `${prev}\n${keyword}`;
        });
    };
    text = forceNewlineKeywords(text, ['alt', 'else', 'end', 'opt', 'par', 'critical', 'break', 'loop', 'rect']);
    text = forceNewlineKeywords(text, ['activate', 'deactivate', 'participant', 'actor', 'autonumber', 'create', 'destroy', 'note', 'box']);
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/(--\|[^|\n]*\|)\s*(-->|==>|-\.->)\s*\|[^|\n]*\|/g, '$1 $2 ');

    let lines = text.split(/\n/).map(l => l.replace(/[ \t]+$/g, ''));
    lines = lines.filter(l => !/^\s*(copy|复制)\s*$/i.test(l));

    const stripInlineComments = (ln) => {
        const trimmed = ln.trimStart();
        if (trimmed.startsWith('%%')) return ln;
        const idx = ln.indexOf('%%');
        if (idx > -1) {
            return ln.slice(0, idx).replace(/[ \t]+$/g, '');
        }
        return ln;
    };

    lines = lines.map(stripInlineComments);
    lines = lines.filter(line => !/^\s*```/u.test(line));

    const repairSplitClassDefLines = (linesArr) => {
        const output = [];
        for (let i = 0; i < linesArr.length; i += 1) {
            const current = String(linesArr[i] || '');
            const trimmed = current.trim();
            if (/^classDef\s*;?\s*$/i.test(trimmed)) {
                const next = String(linesArr[i + 1] || '');
                const nextTrimmed = next.trim();
                const classDefBodyMatch = nextTrimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s+(.+)$/);
                if (classDefBodyMatch) {
                    output.push(`classDef ${classDefBodyMatch[1]} ${classDefBodyMatch[2]}`.trim());
                    i += 1;
                    continue;
                }
            }
            output.push(current);
        }
        return output;
    };

    const repairDanglingEdgeLines = (linesArr) => {
        const output = [];
        const edgeTailRe = /(?:-->|==>|-\.->|--x|o--|x--|--o|<-->|<-.->|->|<-)\s*$/;
        const targetHeadRe = /^\s*[A-Za-z][A-Za-z0-9_:-]*(?:\s*(?:\[|\(|\{|:::).*)?$/;
        for (let i = 0; i < linesArr.length; i += 1) {
            const current = String(linesArr[i] || '');
            const trimmed = current.trim();
            if (trimmed && !trimmed.startsWith('%%') && edgeTailRe.test(trimmed)) {
                const next = String(linesArr[i + 1] || '');
                const nextTrimmed = next.trim();
                if (nextTrimmed && !nextTrimmed.startsWith('%%') && targetHeadRe.test(nextTrimmed)) {
                    output.push(`${current.replace(/\s+$/, '')} ${nextTrimmed}`.trim());
                    i += 1;
                    continue;
                }
            }
            output.push(current);
        }
        return output;
    };

    const splitCompositeEdges = (linesArr) => {
        if (!Array.isArray(linesArr)) return linesArr;
        const output = [];

        for (const rawLine of linesArr) {
            const line = String(rawLine ?? '');
            const trimmed = line.trim();

            if (
                !trimmed ||
                trimmed.startsWith('%%') ||
                /^(classDef|class|style|linkStyle|subgraph|end)\b/i.test(trimmed)
            ) {
                output.push(line);
                continue;
            }

            const match = line.match(
                /^(\s*)([A-Za-z][A-Za-z0-9_:-]*)\s*(-->|==>|-\.->)\s*(\|[^|\n]*\|)?\s*([A-Za-z][A-Za-z0-9_:-]*(?:\s*&\s*[A-Za-z][A-Za-z0-9_:-]*)+)\s*(;?\s*)$/
            );

            if (!match) {
                output.push(line);
                continue;
            }

            const indent = match[1] || '';
            const fromId = match[2] || '';
            const edgeOp = match[3] || '-->';
            const edgeLabel = match[4] ? ` ${match[4]} ` : ' ';
            const targetsRaw = match[5] || '';
            const tail = match[6] || '';

            const targets = targetsRaw
                .split('&')
                .map((t) => t.trim())
                .filter(Boolean);

            if (targets.length <= 1) {
                output.push(line);
                continue;
            }

            targets.forEach((targetId) => {
                output.push(`${indent}${fromId} ${edgeOp}${edgeLabel}${targetId}${tail}`);
            });
        }

        return output;
    };

    lines = repairSplitClassDefLines(lines);
    lines = repairDanglingEdgeLines(lines);
    lines = splitCompositeEdges(lines);

    const fixBrokenTargetNodeLine = (() => {
        let autoNodeCounter = 0;
        const nodeIdByLabel = new Map();
        const edgeRe = /(.*?\s(?:-->|==>|-\.->|--x|o--|x--|--o|<-->|<-.->|->|<-)\s*)(.+)$/;

        const ensureNodeId = (labelText) => {
            const key = (labelText || '').trim();
            if (!key) return null;
            if (nodeIdByLabel.has(key)) {
                return nodeIdByLabel.get(key);
            }
            autoNodeCounter += 1;
            const id = `auto_node_${autoNodeCounter}`;
            nodeIdByLabel.set(key, id);
            return id;
        };

        return (line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('%%')) return line;
            if (/^\s*(subgraph|end|classDef|class|style|linkStyle)\b/i.test(trimmed)) return line;

            const match = line.match(edgeRe);
            if (!match) return line;

            const prefix = match[1];
            const rhs = (match[2] || '').trim();

            if (!rhs) return line;
            if (rhs.includes('|')) return line;
            if (/^[A-Za-z][A-Za-z0-9_:-]*(?:\s*(?:\[|\(|\{).*)?$/.test(rhs)) return line;

            const brokenLabelLike =
                /"\]\s*$/.test(rhs) ||
                /\)\s*"\]\s*$/.test(rhs) ||
                /\]\s*$/.test(rhs);

            if (!brokenLabelLike) return line;

            let label = rhs
                .replace(/^\s*"+/, '')
                .replace(/"\]\s*$/, '')
                .replace(/\]\s*$/, '')
                .trim();

            if (!label) return line;

            const nodeId = ensureNodeId(label);
            if (!nodeId) return line;

            const safeLabel = label
                .replace(/"/g, "'")
                .replace(/>/g, '&gt;')
                .replace(/</g, '&lt;');

            return `${prefix}${nodeId}["${safeLabel}"]`;
        };
    })();

    lines = lines.map(fixBrokenTargetNodeLine);

    const mergeDanglingLabelLines = (linesArr) => {
        const merged = [];
        linesArr.forEach((line) => {
            const trimmed = line.trim();
            const quotedContinuation = trimmed.match(/^[\(（]([^\)）]+)[\)）]\s*"?\]?$/);
            const continuation = trimmed.match(/^[\(（]([^\)\]"]+)[\)）]\s*"?\]?\s*$/);
            const asciiContinuation = trimmed.match(/^(?:\(|\uFF08)([^)\uFF09\]"]+)(?:\)|\uFF09)\s*"?\]?\s*$/);
            const fallbackContinuation = (() => {
                if (!trimmed) return null;
                const startsWithParen = trimmed.startsWith('(') || trimmed.startsWith('\uFF08');
                const endsWithBracket = trimmed.endsWith(']') || trimmed.endsWith('"]') || trimmed.endsWith(')');
                if (!startsWithParen || !endsWithBracket) return null;
                const cleaned = trimmed
                    .replace(/^\(|^\uFF08/, '')
                    .replace(/"?\]?\s*$/, '')
                    .replace(/\)$|\uFF09$/, '');
                if (!cleaned) return null;
                return [trimmed, cleaned];
            })();
            const effectiveContinuation = quotedContinuation || asciiContinuation || continuation || fallbackContinuation;
            if (effectiveContinuation) {
                const suffix = effectiveContinuation[1].trim();
                while (merged.length && !merged[merged.length - 1].trim()) {
                    merged.pop();
                }
                if (merged.length > 0) {
                    const prev = merged[merged.length - 1];
                    const endLabelMatch = prev.match(/\["([^"\n]*)"\]\s*$/);
                    if (endLabelMatch) {
                        const escapedSuffix = suffix.replace(/>/g, '&gt;').replace(/</g, '&lt;');
                        merged[merged.length - 1] = prev.replace(/\["([^"\n]*)"\]\s*$/, `["${endLabelMatch[1]} (${escapedSuffix})"]`);
                        return;
                    }
                    const lastStart = prev.lastIndexOf('["');
                    const lastEnd = prev.lastIndexOf('"]');
                    if (lastStart !== -1 && lastEnd > lastStart) {
                        const before = prev.slice(0, lastStart);
                        const label = prev.slice(lastStart + 2, lastEnd);
                        const after = prev.slice(lastEnd + 2);
                        const escapedSuffix = suffix.replace(/>/g, '&gt;').replace(/</g, '&lt;');
                        merged[merged.length - 1] = `${before}["${label} (${escapedSuffix})"]${after}`;
                        return;
                    }
                }
            }
            merged.push(line);
        });
        return merged;
    };

    lines = mergeDanglingLabelLines(lines);

    const mergeInlineLabelSuffix = (line) => {
        return line.replace(/\["([^"\n]*)"\]\s*(?:\(|\uFF08)([^)\uFF09\]]+)(?:\)|\uFF09)\s*"?\]?/g, (match, label, suffix) => {
            const escapedSuffix = suffix
                .replace(/>/g, '&gt;')
                .replace(/</g, '&lt;');
            const mergedLabel = `${label} (${escapedSuffix})`.trim();
            return `["${mergedLabel}"]`;
        });
    };

    const fixBrokenInlineEdgeInjection = (line) => {
        const fallbackLooseMatch = line.match(
            /^(\s*)([A-Za-z][A-Za-z0-9_:-]*)\["([^"\n]*?)\[([\s\S]*?)\b([A-Za-z][A-Za-z0-9_:-]*)"\]\s*([^"\n][\s\S]*?)"\]\s*$/
        );

        const sanitizeLabel = (value) => String(value || '')
            .replace(/`/g, '')
            .replace(/[\[\]]/g, '')
            .replace(/"/g, "'")
            .replace(/>/g, '&gt;')
            .replace(/</g, '&lt;')
            .trim();

        const normalizeEdgeLabel = (value) => String(value || '')
            .replace(/[`"'[\]]/g, '')
            .replace(/(?:\u2192|-->|->|=>)/g, '')
            .replace(/^[|｜]+|[|｜]+$/g, '')
            .replace(/^\s*[-=.]*/g, '')
            .replace(/[-=.]*(?:>|＞)\s*$/g, '')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        if (fallbackLooseMatch) {
            const indent = fallbackLooseMatch[1] || '';
            const fromId = fallbackLooseMatch[2] || '';
            const rawFromLabel = fallbackLooseMatch[3] || '';
            const rawInjection = fallbackLooseMatch[4] || '';
            const toId = fallbackLooseMatch[5] || '';
            const rawToLabel = fallbackLooseMatch[6] || '';

            const fromLabel = sanitizeLabel(rawFromLabel) || fromId;
            const toLabel = sanitizeLabel(rawToLabel) || toId;
            const edgeLabel = normalizeEdgeLabel(rawInjection);
            const edgeOp = edgeLabel ? ` -->|${edgeLabel}| ` : ' --> ';
            return `${indent}${fromId}["${fromLabel}"]${edgeOp}${toId}["${toLabel}"]`;
        }

        const baseMatch = line.match(
            /^(\s*)([A-Za-z][A-Za-z0-9_:-]*)\["([^"\n]*?)\[\s*(?:[`'"\\\/]+)?\s*(?:\u2192|-->|->|=>)\s*(.+)$/
        );
        if (!baseMatch) return line;

        const indent = baseMatch[1] || '';
        const fromId = baseMatch[2] || '';
        const rawFromLabel = baseMatch[3] || '';
        const edgePayload = (baseMatch[4] || '').trim();

        const edgePayloadMatch = edgePayload.match(
            /^(?:[|｜]\s*([^|｜\n]+?)\s*[|｜]\s*)?([A-Za-z][A-Za-z0-9_:-]*)"\]\s*([^\n]*)$/
        );
        if (!edgePayloadMatch) return line;

        const rawEdgeLabel = edgePayloadMatch[1] || '';
        const toId = edgePayloadMatch[2] || '';
        const rawTail = edgePayloadMatch[3] || '';

        const fromLabel = sanitizeLabel(rawFromLabel) || fromId;
        let toLabelRaw = rawTail
            .replace(/^["'\]\s]+/, '')
            .replace(/"\]\s*$/, '')
            .replace(/\]\s*$/, '')
            .trim();

        let trailingEdge = '';
        const trailingEdgeMatch = toLabelRaw.match(/\]\s*([A-Za-z][A-Za-z0-9_:-]*\s*(?:-->|==>|-\.->|--x|o--|x--|--o|<-->|<-.->|->|<-)\s*.+)$/);
        if (trailingEdgeMatch) {
            trailingEdge = trailingEdgeMatch[1];
            toLabelRaw = toLabelRaw.slice(0, trailingEdgeMatch.index).trim();
        } else {
            const directTrailingEdgeMatch = toLabelRaw.match(/([A-Za-z][A-Za-z0-9_:-]*\s*(?:-->|==>|-\.->|--x|o--|x--|--o|<-->|<-.->|->|<-)\s*.+)$/);
            if (directTrailingEdgeMatch && directTrailingEdgeMatch.index > 0) {
                trailingEdge = directTrailingEdgeMatch[1];
                toLabelRaw = toLabelRaw.slice(0, directTrailingEdgeMatch.index).trim();
            }
        }

        const edgeLabel = normalizeEdgeLabel(rawEdgeLabel)
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const toLabel = sanitizeLabel(toLabelRaw) || toId;
        const edgeOp = edgeLabel ? ` -->|${edgeLabel}| ` : ' --> ';
        const fixedPrimary = `${indent}${fromId}["${fromLabel}"]${edgeOp}${toId}["${toLabel}"]`;
        if (!trailingEdge) return fixedPrimary;
        return `${fixedPrimary}\n${indent}${trailingEdge.trim()}`;
    };

    const fixBrokenEdgeLabelBrackets = (line) => {
        let updated = line;
        updated = updated.replace(/(--\|[^|\n]*?)\[(\|--?>)/g, '$1$2');
        updated = updated.replace(/(==\|[^|\n]*?)\[(\|==>)/g, '$1$2');
        updated = updated.replace(/(--\|[^|\n]*?)\](\|--?>)/g, '$1$2');
        updated = updated.replace(/(==\|[^|\n]*?)\](\|==>)/g, '$1$2');
        return updated;
    };

    const normalizeClassDiagramLines = (line) => {
        if (/^\s*<>\s*$/.test(line)) {
            return '        <<interface>>';
        }
        return line;
    };

    const normalizeClassDefIdentifiers = (linesArr) => {
        const renameMap = new Map();
        const isStateDiagram = linesArr.some(line => /^\s*stateDiagram(?:-v2)?\b/i.test(line));
        const definedClassNames = new Set(linesArr.flatMap((line) => {
            const match = String(line || '').match(/^\s*classDef\s+([^\s,;]+)/i);
            return match ? [match[1].toLowerCase()] : [];
        }));
        let stateDefaultClassName = 'state_default';
        let stateDefaultSuffix = 2;
        while (definedClassNames.has(stateDefaultClassName.toLowerCase())) {
            stateDefaultClassName = `state_default_${stateDefaultSuffix}`;
            stateDefaultSuffix += 1;
        }
        const reserved = new Set([
            'end', 'subgraph', 'classdef', 'class', 'style', 'linkstyle',
            'flowchart', 'graph', 'sequencediagram', 'statediagram', 'classdiagram'
        ]);

        const normalizeName = (raw) => {
            const cleaned = String(raw || '')
                .trim()
                .replace(/[^\p{L}\p{N}_-]+/gu, '_')
                .replace(/^_+|_+$/g, '');
            if (!cleaned) return 'node_class';
            if (reserved.has(cleaned.toLowerCase())) return `${cleaned}_cls`;
            return cleaned;
        };

        const normalizedLines = linesArr.map((line) => {
            const match = line.match(/^(\s*classDef\s+)(.+)$/i);
            if (!match) return line;

            const prefix = match[1];
            const body = match[2].trim();
            if (!body) return line;

            const tokens = body.split(/\s+/);
            const styleStart = tokens.findIndex(token => token.includes(':'));
            if (styleStart <= 0) return line;

            const stylePart = tokens.slice(styleStart).join(' ');
            const namePartRaw = tokens.slice(0, styleStart).join(' ').trim();
            if (!namePartRaw) return line;

            let rawNames = [];
            if (namePartRaw.includes(',')) {
                rawNames = namePartRaw.split(',').map(s => s.trim()).filter(Boolean);
            } else if (tokens.slice(0, styleStart).length > 1) {
                const mergedName = tokens.slice(0, styleStart).join('_');
                rawNames = [mergedName];

                const firstToken = tokens[0];
                if (firstToken && firstToken !== mergedName) {
                    renameMap.set(firstToken, mergedName);
                }
            } else {
                rawNames = [namePartRaw];
            }

            const normalizedNames = rawNames.map((name) => {
                const normalized = isStateDiagram && name.toLowerCase() === 'default'
                    ? stateDefaultClassName
                    : normalizeName(name);
                if (normalized !== name) {
                    renameMap.set(name, normalized);
                }
                return normalized;
            });

            return `${prefix}${normalizedNames.join(',')} ${stylePart}`;
        });

        const applyRenameToClassRef = (line) => {
            let updated = line;
            renameMap.forEach((toName, fromName) => {
                const escaped = fromName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                updated = updated.replace(new RegExp(`:::\\s*${escaped}(?=\\b|\\s|$)`, 'g'), `:::${toName}`);
                updated = updated.replace(new RegExp(`\\bclass\\s+([^\\n]*\\s)?${escaped}(?=\\s|,|$)`, 'g'), (m) => {
                    return m.replace(new RegExp(`${escaped}(?=\\s|,|$)`), toName);
                });
            });
            return updated;
        };

        const renamedLines = normalizedLines.map(applyRenameToClassRef);
        if (!isStateDiagram) return renamedLines;

        const classApplications = [];
        const stabilizedLines = renamedLines.map((line) => {
            const aliasClassMatch = line.match(/^(\s*state\s+"[^"]*"\s+as\s+([A-Za-z_]\w*))\s*:::\s*([A-Za-z_]\w*)\s*;?\s*$/i);
            if (!aliasClassMatch) return line;

            classApplications.push(`class ${aliasClassMatch[2]} ${aliasClassMatch[3]}`);
            return aliasClassMatch[1];
        });

        return [...stabilizedLines, ...classApplications];
    };

    const repairQuoteBracketArtifacts = (line) => {
        let updated = line;
        updated = updated.replace(/\[""([^"\n]+)""\]/g, '["$1"]');
        updated = updated.replace(/\{""([^"\n]+)""\}/g, '{"$1"}');
        updated = updated.replace(/\["\]([^"\n]+)"\]/g, '["$1"]');
        updated = updated.replace(/\["([^"\n\]]+)\["\]/g, '["$1"]');
        updated = updated.replace(/\{"]([^"\n]+)"\}/g, '{"$1"}');
        updated = updated.replace(/\|([^\|\n\[]+)\[\|/g, '|$1|');
        return updated;
    };

    const normalizeMermaidLine = (line) => {
        let updated = line;
        updated = updated.replace(/^\s*subgraph\s+([A-Za-z0-9_:-]+)\s*\[([^\]]+)\]\s*$/i, 'subgraph "$2"');
        updated = updated.replace(/^(\s*[A-Za-z0-9_:-]+)\s+\[([^\]]+)\]\s*$/u, '$1["$2"]');
        updated = updated.replace(/--\|"\s*([^"\n]*?)\s*\|-->/g, '--|$1|-->');
        updated = updated.replace(
            /(^|\s)([A-Za-z][A-Za-z0-9_:-]*)"([^"\n\[\]]+)"(?=\s*(?:$|-->|==>|-\.->|:::|,\s*|;))/g,
            '$1$2["$3"]'
        );
        updated = updated.replace(
            /([\]\)\}])\s*([A-Za-z][A-Za-z0-9_:-]*\s*(?:-->|==>|-\.->|--x|o--|x--|--o|<-->|<-.->|->|<-))/g,
            '$1\n$2'
        );
        return updated;
    };

    const sanitizeSubgraphTitle = (line) => {
        const match = line.match(/^(\s*subgraph\s+)"(.*)"\s*$/i);
        if (!match) return line;
        let title = match[2];
        title = title
            .replace(/"/g, "'")
            .replace(/\[/g, '(')
            .replace(/\]/g, ')');
        return `${match[1]}"${title}"`;
    };

    const normalizeSubgraphBrackets = (line) => {
        if (!/^\s*subgraph\b/i.test(line)) return line;
        const openIndex = line.indexOf('[');
        const closeIndex = line.lastIndexOf(']');
        if (openIndex === -1 || closeIndex === -1 || closeIndex <= openIndex) {
            return line;
        }
        const rawTitle = line.slice(openIndex + 1, closeIndex).trim();
        const normalized = `subgraph "${rawTitle}"`;
        return sanitizeSubgraphTitle(normalized);
    };

    const normalizePlainSubgraphTitle = (line) => {
        const match = line.match(/^(\s*subgraph\s+)(.+)$/i);
        if (!match) return line;
        const prefix = match[1];
        const tail = (match[2] || '').trim();
        if (!tail) return line;
        if (tail.startsWith('"') || tail.startsWith('[')) return line;
        if (/^[A-Za-z0-9_:-]+$/.test(tail)) return line;
        if (!/[()\uFF08\uFF09]/.test(tail)) return line;

        const safeTail = tail
            .replace(/"/g, "'")
            .replace(/\[/g, '(')
            .replace(/\]/g, ')');
        return `${prefix}"${safeTail}"`;
    };

    const sanitizeQuotedNodeLabels = (line) => {
        const sanitizeLabel = (label) => {
            let updated = label;
            updated = updated.replace(/"/g, "'");
            updated = updated.replace(/\/'([^'\n]+)'\//g, '$1');
            updated = updated.replace(/\$/g, '＄');
            updated = updated.replace(/'/g, '`');
            updated = updated.replace(/\|/g, '｜');
            updated = updated.replace(/-->/g, '→');
            updated = updated.replace(/==>/g, '⇒');
            updated = updated.replace(/-\.->/g, '⇢');
            updated = updated.replace(/--\|/g, '--｜');
            updated = updated.replace(/\|--/g, '｜--');
            return updated;
        };

        const sanitizeBetween = (startToken, endToken) => {
            let result = '';
            let cursor = 0;
            while (cursor < line.length) {
                const start = line.indexOf(startToken, cursor);
                if (start === -1) {
                    result += line.slice(cursor);
                    break;
                }
                result += line.slice(cursor, start + startToken.length);
                let idx = start + startToken.length;
                let label = '';
                while (idx < line.length) {
                    if (line.startsWith(endToken, idx)) {
                        idx += endToken.length;
                        break;
                    }
                    label += line[idx];
                    idx += 1;
                }
                result += sanitizeLabel(label) + endToken;
                cursor = idx;
            }
            line = result;
        };

        sanitizeBetween('["', '"]');
        sanitizeBetween('{"', '"}');
        return line;
    };

    const sanitizeEdgeLabels = (line) => {
        let result = '';
        let cursor = 0;
        while (cursor < line.length) {
            const start = line.indexOf('|', cursor);
            if (start === -1) {
                result += line.slice(cursor);
                break;
            }
            const end = line.indexOf('|', start + 1);
            if (end === -1) {
                result += line.slice(cursor);
                break;
            }
            result += line.slice(cursor, start + 1);
            const label = line
                .slice(start + 1, end)
                .replace(/\$/g, '＄')
                .replace(/[\[\]]/g, '')
                .replace(/\(/g, '（')
                .replace(/\)/g, '）');
            result += label + '|';
            cursor = end + 1;
        }
        return result;
    };

    const protectMathRegions = (line) => {
        const mathPlaceholders = [];
        const makeMathToken = (kind, idx) =>
            `__MERMAID_MATH_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${idx}__`;
        let safeText = line.replace(/\$\$([^$]+)\$\$/g, (match) => {
            const token = makeMathToken('BLOCK', mathPlaceholders.length);
            mathPlaceholders.push({ token, original: match, isInline: false });
            return token;
        });
        safeText = safeText.replace(/\$([^$]+)\$/g, (match) => {
            const token = makeMathToken('INLINE', mathPlaceholders.length);
            mathPlaceholders.push({ token, original: match, isInline: true });
            return token;
        });
        return { safeText, mathPlaceholders };
    };

    const restoreMathRegions = (line, mathPlaceholders = []) => {
        let restored = line;
        mathPlaceholders.forEach((placeholder) => {
            const token = placeholder?.token;
            const original = placeholder?.original || '';
            if (!token) return;
            if (placeholder?.isInline && original.startsWith('$') && !original.startsWith('$$')) {
                const converted = `$${original}`;
                const finalConverted = converted.slice(0, -1) + '$$';
                restored = restored.replace(token, finalConverted);
            } else {
                restored = restored.replace(token, original);
            }
        });
        return restored;
    };

    const normalizeNestedParenNodeLabels = (line) => {
        const source = String(line || '');
        let result = '';
        let cursor = 0;

        const isIdStart = (ch) => /[A-Za-z]/.test(ch || '');
        const isIdPart = (ch) => /[A-Za-z0-9_:-]/.test(ch || '');

        while (cursor < source.length) {
            const ch = source[cursor];
            const prev = cursor > 0 ? source[cursor - 1] : '';
            if (!isIdStart(ch) || isIdPart(prev)) {
                result += ch;
                cursor += 1;
                continue;
            }

            let idEnd = cursor + 1;
            while (idEnd < source.length && isIdPart(source[idEnd])) {
                idEnd += 1;
            }

            let parenStart = idEnd;
            while (parenStart < source.length && /\s/.test(source[parenStart])) {
                parenStart += 1;
            }

            if (source[parenStart] !== '(' || source[parenStart + 1] === '(') {
                result += source.slice(cursor, idEnd);
                cursor = idEnd;
                continue;
            }

            let depth = 0;
            let idx = parenStart;
            let parenEnd = -1;
            while (idx < source.length) {
                if (source[idx] === '(') {
                    depth += 1;
                } else if (source[idx] === ')') {
                    depth -= 1;
                    if (depth === 0) {
                        parenEnd = idx;
                        break;
                    }
                }
                idx += 1;
            }

            if (parenEnd === -1) {
                result += source.slice(cursor, idEnd);
                cursor = idEnd;
                continue;
            }

            const rawLabel = source.slice(parenStart + 1, parenEnd);
            if (!/[()]/.test(rawLabel)) {
                result += source.slice(cursor, parenEnd + 1);
                cursor = parenEnd + 1;
                continue;
            }

            const safeLabel = rawLabel
                .trim()
                .replace(/^["']|["']$/g, '')
                .replace(/"/g, "'")
                .replace(/\(/g, '（')
                .replace(/\)/g, '）');

            result += `${source.slice(cursor, idEnd)}("${safeLabel}")`;
            cursor = parenEnd + 1;
        }

        return result;
    };

    const normalizeMermaidInlineStructures = (line) => {
        // 边文字不能吞掉完整箭头的 >，否则链式连线会被误改成带 | 的标签。
        return line
            .replace(
                /(\b[A-Za-z][A-Za-z0-9_:-]*)[ \t]*--[ \t]*([^|<>\s-][^|<>\r\n-]*?)[ \t]*---[ \t]*(\b[A-Za-z][A-Za-z0-9_:-]*)/g,
                '$1 -->|$2| $3'
            )
            .replace(/^\s*subgraph\s+""([^"]+)""\s*$/i, 'subgraph "$1"')
            .replace(/^\s*subgraph\s+\[([^\]]+)\]\s*$/i, 'subgraph "$1"')
            .replace(/^\s*subgraph\s+\w+\s+"([^"]+)"\s*$/i, 'subgraph "$1"')
            .replace(/(\b[A-Za-z0-9_:-]+)\s*\(\s*(\[[^\]\n]+\])\s*\)/g, '$1$2')
            .replace(/^(\s*)([A-Za-z0-9_:-]+)\[(?!")([^\]\n]+)\]/gm, '$1$2["$3"]')
            .replace(/(\b[A-Za-z0-9_:-]+)\(\(\s*"?\s*\(?\s*"?([^"()\n]+?)"?\s*\)?\s*"?\s*\)\)/g, '$1(("$2"))')
            .replace(/(\b[A-Za-z0-9_:-]+)\(\(\((?!")([^\)\n]+)\)\)\)/g, '$1((("$2")))')
            .replace(/(\b[A-Za-z0-9_:-]+)\{\{\s*"{0,2}([^"\n]+?)"{0,2}\s*\}\}/g, '$1{"$2"}')
            .replace(/(\b[A-Za-z0-9_:-]+)\{(?!")([^\}\n]+)\}/g, '$1{"$2"}')
            .replace(/--[ \t]*([^|<>\s-][^|<>\r\n-]*?)[ \t]*-->/g, '--|$1|-->')
            .replace(/--[ \t]*([^|<>\s-][^|<>\r\n-]*?)[ \t]*==>/g, '--|$1|==>')
            .replace(/--\s*"\s*([^"]+?)\s*"\s*-->/g, '--|$1|-->')
            .replace(/--\s*"\s*([^"]+?)\s*"\s*==>/g, '--|$1|==>')
            .replace(/-\.\s*"([^"\n]+?)"\s*\.-\s*->/g, '-. "$1" .->')
            .replace(/-\.\s*([^"\n]+?)\s*\.-\s*->/g, '-. $1 .->')
            .replace(/\.\-\s*->/g, '.->')
            .replace(/\|\s*"([^"\n]+?)"\s*\|/g, '|$1|')
            .replace(/\["\(\s*"?([^"\n]+?)"?\s*\)"\]/g, '[($1)]')
            .replace(/^\s*([A-Za-z0-9_:-]+\s*\[[^\]]+\])\s*:\s*$/g, '$1')
            .replace(/[《》〈〉「」『』【】〔〕〖〗〘〙〚〛①②③④⑤⑥⑦⑧⑨⑩]/g, '')
            .replace(/\)\s+:::/g, '):::')
            .replace(/\]\s+:::/g, ']:::')
            .replace(/\}\s+:::/g, '}:::')
            .replace(/:::\s+/g, ':::')
            .replace(/^(\s*subgraph\s+)"'([^'"]+)'"(\s*)$/gim, '$1"$2"$3')
            .replace(/\['([^'"\]]+)"\]/g, '[$1]')
            .replace(/\["([^'"\]]+)'\]/g, '[$1]');
    };

    const normalizeDirectionAliases = (line) => {
        return line.replace(/^(\s*direction\s+)TD(\s*;?\s*)$/i, '$1TB$2');
    };

    const applyLineCleaners = (linesArr, cleaners) =>
        linesArr.map((line) => cleaners.reduce((acc, cleaner) => cleaner(acc), line));

    const preMathLineCleaners = [
        mergeInlineLabelSuffix,
        fixBrokenInlineEdgeInjection,
        fixBrokenEdgeLabelBrackets
    ];

    const protectedLineCleaners = [
        normalizeDirectionAliases,
        normalizeSubgraphBrackets,
        normalizePlainSubgraphTitle,
        normalizeMermaidLine,
        repairQuoteBracketArtifacts,
        normalizeClassDiagramLines,
        normalizeNestedParenNodeLabels,
        normalizeMermaidInlineStructures,
        sanitizeSubgraphTitle,
        sanitizeQuotedNodeLabels,
        sanitizeEdgeLabels
    ];

    lines = applyLineCleaners(lines, preMathLineCleaners);

    const allMathPlaceholders = [];
    lines = lines.map(line => {
        const { safeText, mathPlaceholders } = protectMathRegions(line);
        allMathPlaceholders.push(mathPlaceholders);
        return safeText;
    });

    lines = applyLineCleaners(lines, protectedLineCleaners);
    lines = normalizeClassDefIdentifiers(lines);

    lines = lines.map((line, idx) => restoreMathRegions(line, allMathPlaceholders[idx]));

    lines = lines.map(line => {
        return line
            .replace(/--\|>/g, '-->')
            .replace(/--｜>/g, '-->')
            .replace(/==\|>/g, '==>')
            .replace(/==｜>/g, '==>')
            .replace(/-\.\|>/g, '-.->')
            .replace(/-\.｜>/g, '-.->');
    });

    lines = lines.map(line => {
        if (/^\s*classDef\b/i.test(line) && !/;\s*$/.test(line)) {
            return `${line.trimEnd()};`;
        }
        if (/^\s*linkStyle\b/i.test(line)) {
            const stripped = stripLinkStyleColorTerminators(line);
            if (stripped !== line || /#\w+\s*$/.test(line)) {
                return stripped.trimEnd();
            }
            if (!/;\s*$/.test(line)) {
                return `${line.trimEnd()};`;
            }
        }
        return line;
    });

    const countEdges = (linesArr) => {
        const edgePattern = /(?:-->|==>|-.->|--x|o--|<-->|<-.->|--o|x--|->|<-)/g;
        let count = 0;
        for (const ln of linesArr) {
            const trimmed = ln.trim();
            if (trimmed.startsWith('%%') || /^\s*(classDef|linkStyle|style|class|subgraph|end)\b/i.test(trimmed)) {
                continue;
            }
            const matches = ln.match(edgePattern);
            if (matches) {
                count += matches.length;
            }
        }
        return count;
    };

    const fixSequenceActivationStates = (linesArr) => {
        const activeCountByParticipant = new Map();
        const normalizeName = (name) => (name || '').trim().replace(/^["'`]|["'`]$/g, '');
        const getCount = (name) => activeCountByParticipant.get(name) || 0;
        const setCount = (name, count) => {
            if (!name) return;
            if (count > 0) activeCountByParticipant.set(name, count);
            else activeCountByParticipant.delete(name);
        };

        return linesArr.map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('%%')) return line;

            const activateMatch = trimmed.match(/^activate\s+([A-Za-z0-9_.:\-"`]+)\s*$/i);
            if (activateMatch) {
                const participant = normalizeName(activateMatch[1]);
                setCount(participant, getCount(participant) + 1);
                return line;
            }

            const deactivateMatch = trimmed.match(/^deactivate\s+([A-Za-z0-9_.:\-"`]+)\s*$/i);
            if (deactivateMatch) {
                const participant = normalizeName(deactivateMatch[1]);
                const current = getCount(participant);
                if (current <= 0) return '';
                setCount(participant, current - 1);
                return line;
            }

            const arrowMatch = line.match(/^(\s*[A-Za-z0-9_.:\-"`]+)\s*([-.=xo<]*>>?)\s*([+-])\s*([A-Za-z0-9_.:\-"`]+)([\s\S]*)$/);
            if (!arrowMatch) return line;

            const operator = arrowMatch[2];
            const sign = arrowMatch[3];
            const toRaw = normalizeName(arrowMatch[4]);
            const tail = arrowMatch[5] || '';

            if (sign === '+') {
                setCount(toRaw, getCount(toRaw) + 1);
                return line;
            }
            if (sign === '-') {
                const current = getCount(toRaw);
                if (current <= 0) {
                    return `${arrowMatch[1]}${operator}${toRaw}${tail}`;
                }
                setCount(toRaw, current - 1);
                return line;
            }
            return line;
        }).filter(line => line !== '');
    };

    const edgeCount = countEdges(lines);
    lines = lines.map(line => {
        const linkStyleMatch = line.match(/^(\s*linkStyle\s+)([^\s;]+)(.*)/i);
        if (!linkStyleMatch) return line;

        const prefix = linkStyleMatch[1];
        const indicesPart = linkStyleMatch[2];
        const suffix = linkStyleMatch[3];

        if (indicesPart.toLowerCase() === 'default') {
            return line;
        }

        const indices = indicesPart.split(',').map(s => s.trim());
        const validIndices = indices.filter(idx => {
            if (idx.toLowerCase() === 'default') return true;
            const num = parseInt(idx, 10);
            return !isNaN(num) && num >= 0 && num < edgeCount;
        });

        if (validIndices.length === 0) {
            return '';
        }

        return `${prefix}${validIndices.join(',')}${suffix}`;
    }).filter(line => line !== '');

    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    const directiveTypes = [
        'flowchart',
        'graph',
        'mindmap',
        'timeline',
        'sequenceDiagram',
        'classDiagram',
        'stateDiagram',
        'stateDiagram-v2',
        'erDiagram',
        'gantt',
        'journey',
        'pie'
    ];
    const getDirective = (line) => {
        const trimmed = line.trim();
        const match = directiveTypes.find(type => new RegExp(`^${type}\\b`, 'i').test(trimmed));
        return match || null;
    };
    const directiveEntries = lines
        .map((line, idx) => ({ idx, type: getDirective(line) }))
        .filter(item => !!item.type);
    let primaryEntry = null;
    if (directiveEntries.length > 0) {
        primaryEntry = directiveEntries[0];
        const preferredNonFlow = directiveEntries.find(item => !/^(flowchart|graph)$/i.test(String(item.type || '')));
        if (preferredNonFlow) {
            primaryEntry = preferredNonFlow;
        }
    }
    const directiveIndex = primaryEntry ? primaryEntry.idx : -1;
    let primaryDirective = primaryEntry ? primaryEntry.type : null;
    if (primaryDirective) {
        const preservedPreamble = lines.slice(0, directiveIndex).filter(line =>
            /^\s*%%\{/.test(line) || /^\s*%%/.test(line) || !line.trim()
        );
        lines = lines.filter((line, idx) => {
            const type = getDirective(line);
            if (!type) return true;
            return idx === directiveIndex;
        });
        if (directiveIndex > 0) {
            lines = [...preservedPreamble, ...lines.slice(directiveIndex)];
        }
    } else {
        lines.unshift('flowchart TD');
        primaryDirective = 'flowchart';
    }

    if (primaryDirective && /^sequenceDiagram$/i.test(primaryDirective)) {
        lines = fixSequenceActivationStates(lines);
    }

    const normalized = lines.join('\n').trim();

    // 轻量判断
    const looksLikeMermaid = /(?:graph|flowchart|mindmap|timeline|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|journey|pie|subgraph\b|-->|==>)/i.test(normalized);

    if (!looksLikeMermaid) {
        return { corrected: '', skippedReason: 'not-mermaid-like' };
    }

    if (!normalized) {
        return { corrected: '', skippedReason: 'empty-after-normalize' };
    }

    return { corrected: normalized, skippedReason: null };
}

function simplifyMermaidDefinition(definition) {
    if (!definition) return definition;
    let simplified = definition;
    simplified = simplified
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\[""([^"\n]+)""\]/g, '$1["$2"]')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\{""([^"\n]+)""\}/g, '$1{"$2"}')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\[\(\s*([^\]\n]+?)\s*\)\]/g, '$1["$2"]')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\(\(\(([^)\n]+)\)\)\)/g, '$1["$2"]')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\(\(([^)\n]+)\)\)/g, '$1["$2"]')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\{\{\s*"([^"\n]+)"\s*\}\}/g, '$1["$2"]')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\{\{\s*([^"}\n]+)\s*\}\}/g, '$1["$2"]')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\{\s*"([^"\n]+)"\s*\}/g, '$1["$2"]')
        .replace(/(\b[A-Za-z0-9_:-]+)\s*\{\s*([^"}\n]+)\s*\}/g, '$1["$2"]');

    simplified = simplified.replace(/\["([^"\n]+)"\]/g, (match, label) => {
        const withoutIcons = label.replace(/\bfa:[A-Za-z0-9-]+\b/g, '');
        const cleaned = withoutIcons.replace(/[^\w\u4E00-\u9FFF\s.,;:!?()\-\/]/g, '');
        const finalLabel = cleaned.trim() || 'node';
        return `["${finalLabel}"]`;
    });

    return simplified;
}

export function buildMermaidRenderCandidates(definition) {
    const rawDefinition = String(definition || '').trim();
    const candidates = [];
    const addCandidate = (source) => {
        const normalized = String(source || '').trim();
        if (normalized && !candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    let source = normalizeMermaidSourceArtifacts(rawDefinition);
    if (/^\s*flowchart\s+(?:TB|TD|BT|RL|LR)\b/im.test(source)
        && /^\s*subgraph\b/im.test(source)) {
        source = source.replace(/(\])end(?=\s*(?:$|[\u3400-\u9fff]))/gm, '$1\nend');
        source = source.replace(/^(\s*end)[\u3400-\u9fff][^\r\n]*$/im, '$1');
        // 最后一条完整 class 语句后误粘贴的中文说明保留为注释，不改动标签内容。
        source = source.replace(
            /^([ \t]*class[ \t]+[A-Za-z_][A-Za-z0-9_:-]*(?:[ \t]*,[ \t]*[A-Za-z_][A-Za-z0-9_:-]*)*[ \t]+[A-Za-z_][A-Za-z0-9_-]*[ \t]*;)[ \t]*([\u3400-\u9fff][^\r\n]*)(?:\r?\n[ \t]*)*(?![\s\S])/m,
            '$1\n%% $2'
        );
    }
    addCandidate(stripLinkStyleColorTerminators(normalizeMermaidColorFormats(source)));
    const { corrected, skippedReason } = normalizeAndCorrectMermaid(source);
    if (corrected && !skippedReason) {
        addCandidate(corrected);
        addCandidate(simplifyMermaidDefinition(corrected));
    }
    return candidates;
}

export function normalizeMermaidDefinitionForRender(definition) {
    const candidates = buildMermaidRenderCandidates(definition);
    return candidates[1] || candidates[0] || '';
}

async function resolveMermaidDefinitionForRender(definition, parseMermaidDefinition, pushAttempt = () => { }) {
    const rawDefinition = String(definition || '').trim();
    const candidates = buildMermaidRenderCandidates(rawDefinition);
    let lastParseError = null;

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const candidate = candidates[candidateIndex];
        const stage = candidateIndex === 0
            ? (candidate !== rawDefinition ? 'normalized-colors' : 'raw')
            : candidateIndex === 1
                ? 'corrected'
                : 'simplified';
        try {
            pushAttempt(stage, candidate, 'trying');
            if (typeof parseMermaidDefinition === 'function') {
                await parseMermaidDefinition(candidate);
            }
            pushAttempt(stage, candidate, 'ok');
            return {
                definition: candidate,
                usedSanitizedDefinition: candidate !== rawDefinition,
                skipped: false
            };
        } catch (candidateParseError) {
            lastParseError = candidateParseError;
            pushAttempt(stage, candidate, 'failed', candidateParseError);
        }
    }

    return {
        definition: '',
        usedSanitizedDefinition: false,
        skipped: candidates.length === 0,
        error: lastParseError || new Error('Mermaid definition could not be parsed')
    };
}

async function loadMermaidFromSources(loaderFn) {
    let lastError = null;
    for (const src of MERMAID_SCRIPT_SOURCES) {
        try {
            await loaderFn(src);
            return;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Mermaid script could not be loaded from any source.');
}

export function ensureMermaid(loadScript, { configure = true } = {}) {
    if (window[MERMAID_GLOBAL]) {
        if (configure && !mermaidConfigured) {
            configureMermaid(window[MERMAID_GLOBAL]);
        }
        return Promise.resolve(window[MERMAID_GLOBAL]);
    }

    if (!mermaidInitPromise) {
        const loader = typeof loadScript === 'function'
            ? loadMermaidFromSources((src) => loadScript(src, MERMAID_GLOBAL))
            : loadMermaidFromSources((src) => loadMermaidViaScriptTag(src));

        mermaidInitPromise = loader.then(() => {
            const mermaid = window[MERMAID_GLOBAL];
            if (!mermaid) {
                throw new Error('Mermaid failed to load');
            }
            return mermaid;
        }).catch(error => {
            mermaidInitPromise = null;
            throw error;
        });
    }

    return mermaidInitPromise.then(mermaid => {
        // 启动预加载只准备库，主题/字体仍在实际渲染时读取。
        if (configure) configureMermaid(mermaid);
        return mermaid;
    });
}

function notifyRenderState() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('mermaid-render-state', {
            detail: { pending: pendingRenders.size }
        }));
    }
}

function trackRenderPromise(promise) {
    pendingRenders.add(promise);
    notifyRenderState();
    promise.finally(() => {
        pendingRenders.delete(promise);
        notifyRenderState();
    });
    return promise;
}

function configureMermaid(mermaid) {
    if (mermaidConfigured || !mermaid || typeof mermaid.initialize !== 'function') {
        return;
    }

    try {
        mermaid.initialize(buildMermaidConfig({
            isDarkTheme: isDarkThemeRoot(document?.documentElement),
            fontFamily: getAppFontFamily()
        }));
    } catch (error) {
        console.warn('Mermaid initialization failed:', error);
    }
    mermaidConfigured = true;
}

function renderMathInMermaid(container) {
    if (!container || typeof window === 'undefined') return;
    try {
        if (window.mathRenderer && typeof window.mathRenderer.renderElement === 'function') {
            window.mathRenderer.renderElement(container, true);
            return;
        }
        if (typeof window.renderMathInElement === 'function') {
            window.renderMathInElement(container);
        }
    } catch (_) { }
}

function loadMermaidViaScriptTag(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[data-mermaid-loader="true"][data-mermaid-src="${src}"]`)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.setAttribute('data-mermaid-loader', 'true');
        script.setAttribute('data-mermaid-src', src);
        script.onload = () => resolve();
        script.onerror = () => {
            script.remove();
            reject(new Error(`Failed to load Mermaid from ${src}`));
        };
        document.head.appendChild(script);
    });
}

function getLocalizedLabel(key, fallback) {
    try {
        if (typeof window !== 'undefined' && typeof window.getToastMessage === 'function') {
            const label = window.getToastMessage(key);
            if (label && typeof label === 'string' && label.trim()) {
                return label;
            }
        }
    } catch (_) { }
    return fallback;
}

function getToastText(key, fallback) {
    try {
        const getter = (typeof window !== 'undefined' && typeof window['getToastMessage'] === 'function')
            ? window['getToastMessage']
            : null;
        if (getter) {
            const text = getter(key);
            if (text && typeof text === 'string' && text.trim()) {
                return text;
            }
        }
    } catch (_) { }
    return fallback;
}

function showToastSafe(key, fallback, type = 'info') {
    const text = getToastText(key, fallback);
    if (!text) return;
    if (typeof window?.showToast === 'function') {
        window.showToast(text, type);
    }
}

async function ensureStoragePermission() {
    const isAndroid = typeof Capacitor?.getPlatform === 'function' && Capacitor.getPlatform() === 'android';
    if (!isAndroid) return;
    try {
        const perm = await Filesystem.checkPermissions?.();
        if (perm?.publicStorage === 'granted') return;
        const req = await Filesystem.requestPermissions?.();
        if (req?.publicStorage === 'granted') return;
    } catch (_) { }
    const msg = getToastText('toast.grantStoragePermission', 'Storage permission required');
    if (typeof window?.showToast === 'function') {
        window.showToast(msg, 'error');
    }
    throw new Error(msg);
}

function createToolbarButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mermaid-download-btn';
    button.title = label;
    button.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            ${(typeof window !== 'undefined' && window.ICONS && window.ICONS.DOWNLOAD) || DEFAULT_DOWNLOAD_ICON_PATH}
        </svg>
        <span class="sr-only">${label}</span>
    `;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        try {
            const maybePromise = onClick();
            if (maybePromise && typeof maybePromise.catch === 'function') {
                maybePromise.catch(err => console.warn('Mermaid toolbar action failed:', err));
            }
        } catch (error) {
            console.warn('Mermaid toolbar action failed:', error);
        }
    });
    return button;
}

async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const base64String = String(reader.result || '');
            const pure = base64String.includes(',')
                ? base64String.split(',')[1]
                : base64String;
            resolve(pure);
        };
        reader.readAsDataURL(blob);
    });
}

async function triggerDownloadFromBlob(blob, filename) {
    const isNative = typeof Capacitor !== 'undefined' && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform();
    if (isNative) {
        try {
            await ensureStoragePermission();
            const base64 = await blobToBase64(blob);
            const mediaStore = Capacitor.Plugins?.MediaStore;
            if (mediaStore) {
                await mediaStore.saveImage({ base64, filename });
                showToastSafe('toast.imageSavedToAlbum', 'Saved', 'success');
                return;
            }

            const folder = 'Pictures/LittleAIBox';
            try {
                await Filesystem.mkdir({
                    path: folder,
                    directory: Directory.ExternalStorage,
                    recursive: true
                });
            } catch (_) { }
            await Filesystem.writeFile({
                path: `${folder}/${filename}`,
                data: base64,
                directory: Directory.ExternalStorage,
                recursive: true
            });
            showToastSafe('toast.imageSavedToAlbum', 'Saved', 'success');
            return;
        } catch (err) {
            showToastSafe('toast.downloadFailedRetry', 'Download failed', 'error');
        }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToastSafe('toast.downloadSuccess', 'Image downloaded successfully', 'success');
}

function downloadSvgFile(svgElement, filenameBase) {
    const serializer = new XMLSerializer();
    const cloned = svgElement.cloneNode(true);
    if (!cloned.getAttribute('xmlns')) {
        cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!cloned.getAttribute('xmlns:xlink')) {
        cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }
    const source = serializer.serializeToString(cloned);
    const svgBlob = new Blob(
        [`<?xml version="1.0" encoding="UTF-8"?>\n${source}`],
        { type: 'image/svg+xml;charset=utf-8' }
    );
    triggerDownloadFromBlob(svgBlob, `${filenameBase}.svg`);
}

function stripUnsafeUrlsInStyles(svgRoot) {
    if (!svgRoot || typeof svgRoot.querySelectorAll !== 'function') return;

    const isSafeUrl = (urlText) => {
        const cleaned = (urlText || '').trim().replace(/^['"]|['"]$/g, '');
        if (!cleaned) return true;
        if (/^data:/i.test(cleaned)) return true;
        try {
            const parsed = new URL(cleaned, window.location.href);
            return parsed.origin === window.location.origin;
        } catch (_) {
            return false;
        }
    };

    const replaceUnsafeUrls = (text) => text.replace(/url\(([^)]+)\)/gi, (match, group) => {
        return isSafeUrl(group) ? match : 'none';
    });

    svgRoot.querySelectorAll('*[style]').forEach((el) => {
        const style = el.getAttribute('style');
        if (style && /url\(/i.test(style)) {
            el.setAttribute('style', replaceUnsafeUrls(style));
        }
    });

    svgRoot.querySelectorAll('style').forEach((styleEl) => {
        const css = styleEl.textContent;
        if (css && /url\(/i.test(css)) {
            styleEl.textContent = replaceUnsafeUrls(css);
        }
    });
}

function stripExternalImages(svgRoot) {
    if (!svgRoot || typeof svgRoot.querySelectorAll !== 'function') return;
    const images = svgRoot.querySelectorAll('image, img, use[href], use[xlink\\:href]');
    images.forEach((node) => {
        const href = node.getAttribute('href') || node.getAttribute('xlink:href');
        if (href && !href.startsWith('data:')) {
            node.remove();
        }
    });
}

function getSvgSize(svgElement) {
    if (!svgElement) {
        return { width: 800, height: 600 };
    }

    const rect = typeof svgElement.getBoundingClientRect === 'function'
        ? svgElement.getBoundingClientRect()
        : null;
    if (rect && rect.width && rect.height) {
        return { width: rect.width, height: rect.height };
    }

    const viewBox = svgElement.viewBox && svgElement.viewBox.baseVal;
    if (viewBox && viewBox.width && viewBox.height) {
        return { width: viewBox.width, height: viewBox.height };
    }

    const widthAttr = parseFloat(svgElement.getAttribute('width'));
    const heightAttr = parseFloat(svgElement.getAttribute('height'));
    if (!Number.isNaN(widthAttr) && !Number.isNaN(heightAttr)) {
        return { width: widthAttr, height: heightAttr };
    }

    try {
        const bbox = typeof svgElement.getBBox === 'function' ? svgElement.getBBox() : null;
        if (bbox && bbox.width && bbox.height) {
            return { width: bbox.width, height: bbox.height };
        }
    } catch (_) { }

    return { width: 800, height: 600 };
}

function inlineComputedStyles(sourceSvg, targetSvg) {
    if (!sourceSvg || !targetSvg) return;
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return;

    const RELEVANT_STYLES = [
        'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
        'color', 'text-align', 'text-decoration',
        'fill', 'stroke', 'stroke-width',
        'background-color', 'opacity',
        'display', 'visibility',
        'align-items', 'justify-content', 'flex-direction', 'flex-wrap',
        'margin', 'padding', 'border-width', 'border-style', 'border-color',
        'box-sizing'
    ];

    const sourceNodes = [sourceSvg, ...sourceSvg.querySelectorAll('*')];
    const targetNodes = [targetSvg, ...targetSvg.querySelectorAll('*')];
    const count = Math.min(sourceNodes.length, targetNodes.length);

    for (let i = 0; i < count; i++) {
        const sourceNode = sourceNodes[i];
        const targetNode = targetNodes[i];
        if (sourceNode.closest('defs')) continue;

        let computed;
        try {
            computed = window.getComputedStyle(sourceNode);
        } catch (_) {
            continue;
        }
        if (!computed) continue;

        let styleText = '';
        RELEVANT_STYLES.forEach((prop) => {
            const value = computed.getPropertyValue(prop);
            if (value && value !== 'auto' && value !== 'normal' && value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
                styleText += `${prop}:${value};`;
            }
        });

        if (targetNode.tagName && targetNode.tagName.toLowerCase() === 'div' && !targetNode.getAttribute('xmlns')) {
            targetNode.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        }

        if (styleText) {
            const existing = targetNode.getAttribute('style') || '';
            targetNode.setAttribute('style', `${existing};${styleText}`);
        }
    }
}

function serializeSvgForExport(svgElement, {
    inlineStyles = true,
    stripExternal = true,
    stripUrls = true
} = {}) {
    const cloned = svgElement.cloneNode(true);
    const rect = svgElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        cloned.setAttribute('width', rect.width);
        cloned.setAttribute('height', rect.height);
        if (!cloned.hasAttribute('viewBox')) {
            cloned.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        }
    }

    cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    if (inlineStyles) {
        inlineComputedStyles(svgElement, cloned);
    }
    if (stripUrls) stripUnsafeUrlsInStyles(cloned);
    if (stripExternal) stripExternalImages(cloned);

    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(cloned);
    source = source.replace(/<foreignObject([^>]*)>/g, '<foreignObject$1 xmlns="http://www.w3.org/2000/svg">');
    return source;
}

async function downloadRasterFromSvg(svgElement, filenameBase, {
    mimeType = 'image/png',
    extension = 'png',
    scale = 4,
    backgroundColor = '#ffffff'
} = {}) {
    if (!svgElement) {
        throw new Error('SVG element is missing');
    }

    const { width, height } = getSvgSize(svgElement);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio)
        ? Math.max(1, window.devicePixelRatio)
        : 1;
    const effectiveScale = Math.min(6, scale * dpr);
    try {
        const source = serializeSvgForExport(svgElement, {
            inlineStyles: true,
            stripExternal: true,
            stripUrls: true
        });

        const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
            '<?xml version="1.0" standalone="no"?>\r\n' + source
        )}`;

        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = svgUrl;
        });

        const canvas = document.createElement('canvas');
        const canvasWidth = Math.floor(width * effectiveScale);
        const canvasHeight = Math.floor(height * effectiveScale);
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context is unavailable');
        ctx.imageSmoothingEnabled = true;
        if (typeof ctx.imageSmoothingQuality === 'string') {
            ctx.imageSmoothingQuality = 'high';
        }
        if (backgroundColor) {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
        ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b) resolve(b);
                else reject(new Error('Blob creation failed'));
            }, mimeType);
        });

        triggerDownloadFromBlob(blob, `${filenameBase}.${extension}`);
    } catch (error) {
        console.error('Mermaid Rasterization Failed:', error);
        showToastSafe('toast.exportFailed', 'Image generation failed, SVG file downloaded instead', 'error');
        downloadSvgFile(svgElement, filenameBase);
    }
}

function createMermaidToolbar(svgElement, filenameBase) {
    const toolbar = document.createElement('div');
    toolbar.className = 'mermaid-render-toolbar';
    const downloadImageLabel = getLocalizedLabel('ui.downloadImage', 'Download Image');
    const imageButton = createToolbarButton(downloadImageLabel, () => downloadRasterFromSvg(svgElement, filenameBase, {
        mimeType: 'image/png',
        extension: 'png',
        scale: 3
    }));
    toolbar.appendChild(imageButton);
    return toolbar;
}

function shouldRenderMermaid(codeElement, { isFinalRender, rootElement }) {
    if (!codeElement) {
        return false;
    }

    const processed = codeElement.dataset.mermaidProcessed;
    if (processed === 'true' || processed === 'error' || processed === 'skipped') {
        return false;
    }

    if (codeElement.dataset.mermaidSource === 'true') {
        return false;
    }

    const sourceWrapper = codeElement.closest('.mermaid-source');
    if (sourceWrapper) {
        return false;
    }

    const className = codeElement.className || '';
    const declaredLang = (codeElement.getAttribute('data-lang') || codeElement.getAttribute('class') || '').toLowerCase();
    const text = (codeElement.textContent || '').trim();
    const isMermaidLang = /\b(?:mermaid|mindmap)\b/.test(className)
        || /\b(?:mermaid|mindmap)\b/.test(declaredLang)
        || /^mindmap\b/i.test(text);

    if (!isMermaidLang) {
        return false;
    }

    if (!isRenderableMermaidDefinition(text)) {
        codeElement.dataset.mermaidProcessed = 'skipped';
        return false;
    }

    if (!isFinalRender) {
        const streamingHtml = rootElement?.__renderState?.streamingHtml;
        const isCurrentlyStreaming = typeof streamingHtml === 'string' && streamingHtml.length > 0;
        if (isCurrentlyStreaming) {
            codeElement.dataset.mermaidPending = 'true';
            return false;
        }
    }

    return true;
}

export function renderMermaidDiagrams(rootElement, { loadScript, isFinalRender } = {}) {
    if (!rootElement) {
        return null;
    }

    const codeBlocks = Array.from(rootElement.querySelectorAll('pre code'));
    const mermaidBlocks = codeBlocks.filter(code => shouldRenderMermaid(code, { isFinalRender, rootElement }));

    if (mermaidBlocks.length === 0) {
        return null;
    }

    const renderProcess = ensureMermaid(loadScript).then(async (mermaid) => {
        for (const codeElement of mermaidBlocks) {
            const parentPre = codeElement.closest('pre');
            if (!parentPre) {
                continue;
            }

            const rawDefinition = (codeElement.textContent || '').trim();
            let graphDefinition = normalizeMermaidColorFormats(rawDefinition);
            let usedSanitizedDefinition = graphDefinition !== rawDefinition;
            const debugAttempts = [];
            const pushAttempt = (stage, input, status, error) => {
                const normalizedInput = String(input || '');
                debugAttempts.push({
                    stage,
                    status,
                    length: normalizedInput.length,
                    preview: normalizedInput.slice(0, 500),
                    error: error ? String(error?.message || error) : ''
                });
            };

            if (!graphDefinition) {
                codeElement.dataset.mermaidProcessed = 'true';
                continue;
            }

            try {
                if (typeof mermaid.parse === 'function') {
                    const parseMermaidDefinition = async (source) => {
                        await Promise.resolve(mermaid.parse(source));
                    };
                    const resolved = await resolveMermaidDefinitionForRender(rawDefinition, parseMermaidDefinition, pushAttempt);
                    if (resolved.skipped) {
                        codeElement.dataset.mermaidProcessed = 'skipped';
                        continue;
                    }
                    if (!resolved.definition) {
                        throw new Error(resolved.error?.message || 'Mermaid definition could not be parsed');
                    }
                    graphDefinition = resolved.definition;
                    usedSanitizedDefinition = resolved.usedSanitizedDefinition;
                }

                if (usedSanitizedDefinition) {
                    codeElement.textContent = graphDefinition;
                    codeElement.dataset.mermaidSanitized = 'true';
                }

                const uniqueId = `mermaid-diagram-${Date.now()}-${diagramIdCounter++}`;
                pushAttempt('render', graphDefinition, 'trying');
                const renderResult = await mermaid.render(uniqueId, graphDefinition);
                pushAttempt('render', graphDefinition, 'ok');
                const wrapper = document.createElement('div');
                wrapper.className = 'mermaid-diagram-wrapper';
                wrapper.innerHTML = sanitizeMermaidSvg(renderResult.svg);
                renderMathInMermaid(wrapper);

                if (renderResult.bindFunctions) {
                    try {
                        renderResult.bindFunctions(wrapper);
                    } catch (_) { }
                }

                const details = document.createElement('details');
                details.className = 'mermaid-source-toggle';
                const summary = document.createElement('summary');
                summary.textContent = 'Mermaid source';
                const preClone = parentPre.cloneNode(true);
                preClone.classList.add('mermaid-source');
                preClone.querySelectorAll('code').forEach(code => {
                    code.dataset.mermaidSource = 'true';
                });
                details.appendChild(summary);
                details.appendChild(preClone);
                preClone.querySelectorAll('.copy-btn-wrapper').forEach(wrapper => wrapper.remove());
                try {
                    const codeInClone = preClone.querySelector('code');
                    if (codeInClone) {
                        if (typeof window.addCopyButtonToCodeBlock === 'function') {
                            window.addCopyButtonToCodeBlock(preClone, codeInClone);
                        } else {
                            const btn = document.createElement('button');
                            btn.textContent = 'Copy';
                            btn.style.position = 'absolute';
                            btn.style.top = '8px';
                            btn.style.right = '8px';
                            btn.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigator.clipboard.writeText(codeInClone.textContent || '').catch(() => { });
                            });
                            preClone.style.position = 'relative';
                            preClone.appendChild(btn);
                        }
                    }
                } catch (_) { }

                const container = document.createElement('div');
                container.className = 'mermaid-render-container';
                const svgElement = wrapper.querySelector('svg');
                if (svgElement) {
                    const toolbar = createMermaidToolbar(svgElement, uniqueId);
                    container.appendChild(toolbar);
                }
                container.appendChild(wrapper);
                container.appendChild(details);

                const copyWrapper = parentPre.closest('.code-block-wrapper');
                if (copyWrapper && copyWrapper.parentNode) {
                    copyWrapper.parentNode.replaceChild(container, copyWrapper);
                } else {
                    parentPre.replaceWith(container);
                }
                codeElement.dataset.mermaidProcessed = 'true';
                if (codeElement.dataset.mermaidPending === 'true') {
                    delete codeElement.dataset.mermaidPending;
                }
            } catch (error) {
                pushAttempt('render', graphDefinition, 'failed', error);
                codeElement.dataset.mermaidProcessed = 'error';
                if (codeElement.dataset.mermaidPending === 'true') {
                    delete codeElement.dataset.mermaidPending;
                }

                const errorBanner = document.createElement('div');
                errorBanner.className = 'mermaid-error-banner';
                errorBanner.textContent = `Mermaid diagram rendering failed: ${error.message || error}`;

                const wrapper = parentPre.parentNode?.classList?.contains('code-block-wrapper')
                    ? parentPre.parentNode
                    : null;
                const insertTarget = wrapper || parentPre;

                if (insertTarget.parentNode && typeof insertTarget.parentNode.insertBefore === 'function') {
                    insertTarget.parentNode
                        .querySelectorAll('.mermaid-error-banner, .mermaid-error-details')
                        .forEach((el) => el.remove());
                    insertTarget.parentNode.insertBefore(errorBanner, insertTarget);
                }
            }
        }
    }).catch(error => {
        console.warn('Mermaid library could not be loaded:', error);
    });

    return trackRenderPromise(renderProcess);
}

export function waitForAllMermaidRenders() {
    if (pendingRenders.size === 0) {
        return Promise.resolve();
    }
    return Promise.allSettled(Array.from(pendingRenders));
}

export function hasPendingMermaidRenders() {
    return pendingRenders.size > 0;
}
