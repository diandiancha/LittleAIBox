export const KATEX_CONFIG = {
    delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
    ],
    throwOnError: false,
    strict: false,
    trust: true,
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    ignoredClasses: ['sources-list-container'],
    macros: {
        // Accept textdegree in both math and text mode (e.g. temperature units).
        "\\textdegree": "\\degree",
        "\\RR": "\\mathbb{R}",
        "\\NN": "\\mathbb{N}",
        "\\ZZ": "\\mathbb{Z}",
        "\\QQ": "\\mathbb{Q}",
        "\\CC": "\\mathbb{C}",
        "\\lnot": "\\neg ",
        "\\bra": "\\langle #1 |",
        "\\ket": "| #1 \\rangle",
        "\\braket": "\\langle #1 | #2 \\rangle",
        "\\vec": "\\overrightarrow{#1}",
        "\\vect": "\\overrightarrow{#1}"
    }
};

export function buildKatexConfigRuntimeLiteral() {
    return JSON.stringify(KATEX_CONFIG);
}
