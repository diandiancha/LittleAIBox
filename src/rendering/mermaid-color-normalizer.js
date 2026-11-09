export function normalizeMermaidColorFormats(definition) {
    const normalizeHexColorToken = (token) => {
        const hex = String(token || '').replace(/^#/, '').replace(/[\u0966-\u096F]/g, digit =>
            String(digit.charCodeAt(0) - 0x0966)
        );
        if (!/^[0-9a-fA-F]+$/.test(hex)) {
            return token;
        }

        if (hex.length === 3 || hex.length === 6) {
            return `#${hex}`;
        }

        if (hex.length === 4) {
            return `#${hex.slice(0, 3).split('').map(ch => ch + ch).join('')}`;
        }

        if (hex.length === 8) {
            return `#${hex.slice(0, 6)}`;
        }

        if (hex.length < 3) {
            return `#${hex.padEnd(3, hex[hex.length - 1] || '0')}`;
        }

        if (hex.length < 6) {
            return `#${hex.padEnd(6, hex[hex.length - 1] || '0')}`;
        }

        return `#${hex.slice(0, 6)}`;
    };

    return String(definition || '').replace(
        /(^|[^0-9A-Za-z_-])#([0-9a-fA-F\u0966-\u096F]{1,8})(?![0-9a-fA-F\u0966-\u096F])/g,
        (match, prefix, hex) => `${prefix}${normalizeHexColorToken(`#${hex}`)}`
    );
}
