export const UNIFIED_DIAGRAM_LINE_COLOR = '#7a8798';

export function isDarkThemeRoot(root = document?.documentElement) {
    try {
        const themeAttr = String(root?.getAttribute('data-theme') || '').toLowerCase();
        return themeAttr === 'dark' || !!root?.classList?.contains('dark');
    } catch (_) {
        return false;
    }
}

export function getCssVariableValue(names = [], root = document?.documentElement) {
    try {
        const styles = window.getComputedStyle(root);
        for (const name of names) {
            const value = (styles.getPropertyValue(name) || '').trim();
            if (value) return value;
        }
    } catch (_) {}
    return '';
}

export function getAppFontFamily() {
    return getCssVariableValue(['--app-font-family']);
}

export function getCanvasPreviewFontFamily() {
    return getCssVariableValue(['--canvas-preview-font', '--app-font-family']);
}

export function buildMermaidConfig({ isDarkTheme = false, fontFamily = '' } = {}) {
    const lineColor = UNIFIED_DIAGRAM_LINE_COLOR;
    const themeVariables = {
        lineColor,
        defaultLinkColor: lineColor,
        arrowheadColor: lineColor
    };
    if (fontFamily) {
        themeVariables.fontFamily = fontFamily;
    }

    return {
        startOnLoad: false,
        securityLevel: 'loose',
        theme: isDarkTheme ? 'dark' : 'default',
        themeVariables,
        htmlLabels: false,
        flowchart: {
            htmlLabels: false,
            useMaxWidth: false,
            padding: 10
        },
        sequence: { useMaxWidth: true }
    };
}

const DARK_VEGA_THEME_CONFIG = {
    background: '#0f172a',
    view: { stroke: 'transparent' },
    axis: {
        domainColor: '#334155',
        gridColor: '#1f2937',
        tickColor: '#334155',
        labelColor: '#e2e8f0',
        titleColor: '#e2e8f0'
    },
    legend: {
        labelColor: '#e2e8f0',
        titleColor: '#e2e8f0'
    },
    title: { color: '#e2e8f0' },
    text: { fill: '#e2e8f0' }
};

const LIGHT_VEGA_THEME_CONFIG = {
    background: '#ffffff',
    view: { stroke: 'transparent' },
    axis: {
        domainColor: '#cbd5f5',
        gridColor: '#e2e8f0',
        tickColor: '#cbd5f5',
        labelColor: '#0f172a',
        titleColor: '#0f172a'
    },
    legend: {
        labelColor: '#0f172a',
        titleColor: '#0f172a'
    },
    title: { color: '#0f172a' },
    text: { fill: '#0f172a' }
};

export function buildVegaThemeConfig({ isDarkTheme = false, fontFamily = '' } = {}) {
    const lineColor = UNIFIED_DIAGRAM_LINE_COLOR;
    const base = isDarkTheme ? DARK_VEGA_THEME_CONFIG : LIGHT_VEGA_THEME_CONFIG;
    const fontConfig = fontFamily ? {
        font: fontFamily,
        axis: {
            labelFont: fontFamily,
            titleFont: fontFamily
        },
        legend: {
            labelFont: fontFamily,
            titleFont: fontFamily
        },
        title: {
            font: fontFamily,
            subtitleFont: fontFamily
        },
        header: {
            labelFont: fontFamily,
            titleFont: fontFamily
        },
        text: {
            font: fontFamily
        }
    } : null;

    return {
        ...base,
        ...(fontConfig || {}),
        axis: {
            ...base.axis,
            ...(fontConfig?.axis || {}),
            domainColor: lineColor,
            tickColor: lineColor
        },
        legend: {
            ...base.legend,
            ...(fontConfig?.legend || {})
        },
        title: {
            ...base.title,
            ...(fontConfig?.title || {})
        },
        header: {
            ...(fontConfig?.header || {})
        },
        text: {
            ...base.text,
            ...(fontConfig?.text || {})
        },
        line: { stroke: lineColor },
        rule: { stroke: lineColor },
        trail: { stroke: lineColor }
    };
}
