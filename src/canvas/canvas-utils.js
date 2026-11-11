const CANVAS_TYPE_ALIASES = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    md: 'markdown',
    doc: 'markdown',
    document: 'markdown',
    mdx: 'markdown',
    mind_map: 'markmap',
    'mind-map': 'markmap',
    mindmap: 'markmap',
    mark_map: 'markmap',
    'mark-map': 'markmap',
    mmd: 'mermaid',
    vegalite: 'vega-lite',
    'vega_lite': 'vega-lite',
    'vega-lite': 'vega-lite',
    p5: 'p5js',
    p5js: 'p5js',
    yml: 'yaml',
    py: 'python',
    sh: 'shell',
    bash: 'shell',
    'c++': 'cpp',
    cxx: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    'c#': 'csharp',
    cs: 'csharp',
    rs: 'rust',
    rb: 'ruby',
    kt: 'kotlin',
    kts: 'kotlin',
    docker: 'dockerfile',
    make: 'makefile',
    mk: 'makefile'
};

const CANVAS_TYPES = new Set([
    'html',
    'svg',
    'react',
    'vue',
    'code',
    'markdown',
    'mermaid',
    'markmap',
    'vega',
    'vega-lite',
    'text',
    'json',
    'yaml',
    'css',
    'javascript',
    'typescript',
    'python',
    'c',
    'cpp',
    'csharp',
    'java',
    'go',
    'rust',
    'php',
    'ruby',
    'swift',
    'kotlin',
    'dart',
    'sql',
    'shell',
    'xml',
    'p5js',
    'dockerfile',
    'makefile',
    'cmake',
    'ini',
    'diff'
]);

export function normalizeCanvasType(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    const normalized = CANVAS_TYPE_ALIASES[raw] || raw;
    return CANVAS_TYPES.has(normalized) ? normalized : 'text';
}

export function getCanvasFenceLanguage(type = '') {
    switch (normalizeCanvasType(type)) {
        case 'html': return 'html';
        case 'json': return 'json';
        case 'svg': return 'xml';
        case 'yaml': return 'yaml';
        case 'css': return 'css';
        case 'react': return 'jsx';
        case 'vue': return 'vue';
        case 'javascript': return 'javascript';
        case 'typescript': return 'typescript';
        case 'python': return 'python';
        case 'c': return 'c';
        case 'cpp': return 'cpp';
        case 'csharp': return 'csharp';
        case 'java': return 'java';
        case 'go': return 'go';
        case 'rust': return 'rust';
        case 'php': return 'php';
        case 'ruby': return 'ruby';
        case 'swift': return 'swift';
        case 'kotlin': return 'kotlin';
        case 'dart': return 'dart';
        case 'sql': return 'sql';
        case 'shell': return 'bash';
        case 'xml': return 'xml';
        case 'p5js': return 'javascript';
        case 'dockerfile': return 'dockerfile';
        case 'makefile': return 'makefile';
        case 'cmake': return 'cmake';
        case 'ini': return 'ini';
        case 'diff': return 'diff';
        case 'markdown': return 'markdown';
        case 'markmap': return 'markdown';
        case 'mermaid': return 'mermaid';
        case 'vega':
        case 'vega-lite':
            return 'json';
        case 'code': return 'text';
        case 'text':
        default:
            return 'text';
    }
}

export function getCanvasFileExtension(type = '') {
    switch (normalizeCanvasType(type)) {
        case 'html': return 'html';
        case 'svg': return 'svg';
        case 'react': return 'jsx';
        case 'vue': return 'vue';
        case 'markdown': return 'md';
        case 'markmap': return 'md';
        case 'mermaid': return 'mmd';
        case 'vega': return 'vega.json';
        case 'vega-lite': return 'vega-lite.json';
        case 'json': return 'json';
        case 'yaml': return 'yaml';
        case 'css': return 'css';
        case 'javascript': return 'js';
        case 'typescript': return 'ts';
        case 'python': return 'py';
        case 'c': return 'c';
        case 'cpp': return 'cpp';
        case 'csharp': return 'cs';
        case 'java': return 'java';
        case 'go': return 'go';
        case 'rust': return 'rs';
        case 'php': return 'php';
        case 'ruby': return 'rb';
        case 'swift': return 'swift';
        case 'kotlin': return 'kt';
        case 'dart': return 'dart';
        case 'sql': return 'sql';
        case 'shell': return 'sh';
        case 'xml': return 'xml';
        case 'p5js': return 'js';
        case 'dockerfile': return 'Dockerfile';
        case 'makefile': return 'mk';
        case 'cmake': return 'cmake';
        case 'ini': return 'ini';
        case 'diff': return 'diff';
        case 'code':
        case 'text':
        default:
            return 'txt';
    }
}

export function encodeCanvasAttribute(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function decodeCanvasAttribute(value = '') {
    return String(value || '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
