self.importScripts('/libs/pdf.min.js');

const DEFAULT_CMAP_URL = '/libs/cmaps/';
const DEFAULT_RENDER_MAX_WIDTH = 2000;
const DEFAULT_RENDER_IMAGE_TYPE = 'image/webp';
const DEFAULT_RENDER_QUALITY = 0.94;
const DEFAULT_OCR_WINDOW_SIZE = 25;
const DEFAULT_OCR_K = 0.34;

const normalizeTextLine = (line) => (line || '')
    .replace(/\s+/g, ' ')
    .replace(/([a-z])- ([a-z])/g, '$1$2')
    .trim();

const sortItemsByLayout = (items, pageWidth) => {
    if (items.length < 50) return items.sort((a, b) => b.y - a.y);
    const bucketSize = 10;
    const histogram = new Array(Math.ceil(pageWidth / bucketSize)).fill(0);
    items.forEach(it => {
        const idx = Math.floor(it.x / bucketSize);
        if (histogram[idx] !== undefined) histogram[idx]++;
    });
    const centerIdx = Math.floor(histogram.length / 2);
    const range = Math.floor(histogram.length * 0.15);
    let minVal = Infinity;
    let splitIndex = -1;
    for (let i = centerIdx - range; i < centerIdx + range; i += 1) {
        if (histogram[i] < minVal) {
            minVal = histogram[i];
            splitIndex = i;
        }
    }
    const isTwoCol = minVal < items.length * 0.01;
    const splitX = splitIndex * bucketSize;
    return items.sort((a, b) => {
        if (isTwoCol) {
            const aLeft = a.x < splitX;
            const bLeft = b.x < splitX;
            if (aLeft !== bLeft) return aLeft ? -1 : 1;
        }
        if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
        return a.x - b.x;
    });
};

const groupItemsIntoLines = (items, viewport) => {
    const contentTop = viewport.height * 0.92;
    const contentBottom = viewport.height * 0.08;
    const bodyItems = items.filter(it => it.y < contentTop && it.y > contentBottom);
    const lines = [];
    bodyItems.forEach(item => {
        const y = Number(item.y) || 0;
        let line = lines.find(entry => Math.abs(entry.y - y) <= 4);
        if (!line) {
            line = { y, items: [] };
            lines.push(line);
        }
        line.items.push(item);
        line.y = (line.y * (line.items.length - 1) + y) / line.items.length;
    });
    lines.sort((a, b) => b.y - a.y);
    lines.forEach(line => line.items.sort((a, b) => a.x - b.x));
    return lines;
};

const splitLinesIntoColumns = (lines, pageWidth) => {
    if (!Array.isArray(lines) || lines.length < 12 || !pageWidth) return [lines || []];
    const middleStart = pageWidth * 0.38;
    const middleEnd = pageWidth * 0.62;
    const pageLeft = pageWidth * 0.18;
    const pageRight = pageWidth * 0.82;
    const groups = [];
    let segment = [];
    const isFullWidthLine = (line) => {
        const xs = line.items.map(item => Number(item.x) || 0);
        return Math.min(...xs) < pageLeft && Math.max(...xs) > pageRight;
    };
    const flushSegment = () => {
        if (!segment.length) return;
        const leftLines = [];
        const rightLines = [];
        let middleGapCandidates = 0;
        segment.forEach(line => {
            const xs = line.items.map(item => Number(item.x) || 0);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            if (maxX < middleStart) leftLines.push(line);
            else if (minX > middleEnd) rightLines.push(line);
            else middleGapCandidates += 1;
        });
        const sideLineCount = leftLines.length + rightLines.length;
        const hasBalancedColumns = leftLines.length >= 4
            && rightLines.length >= 4
            && sideLineCount >= segment.length * 0.55
            && middleGapCandidates <= segment.length * 0.45;
        if (hasBalancedColumns) groups.push(leftLines, rightLines);
        else groups.push(segment);
        segment = [];
    };
    lines.forEach(line => {
        if (isFullWidthLine(line)) {
            flushSegment();
            groups.push([line]);
            return;
        }
        segment.push(line);
    });
    flushSegment();
    return groups.length ? groups : [lines];
};

const mergeLineItems = (line) => {
    let text = '';
    let lastEndX = null;
    line.items.forEach(item => {
        const str = item.str || '';
        if (!str) return;
        const x = Number(item.x) || 0;
        const width = Number(item.width) || 0;
        if (lastEndX !== null && x - lastEndX > 8 && !/\s$/.test(text)) text += ' ';
        text += str;
        lastEndX = x + width;
    });
    return normalizeTextLine(text);
};

const cleanAndMergeText = (items, viewport) => {
    const lines = groupItemsIntoLines(items, viewport);
    const columns = splitLinesIntoColumns(lines, viewport.width);
    const paragraphs = [];
    columns.forEach(columnLines => {
        let paragraph = '';
        let previousY = null;
        columnLines.forEach(line => {
            const lineText = mergeLineItems(line);
            if (!lineText) return;
            const yGap = previousY === null ? 0 : Math.abs(previousY - line.y);
            const startsNewParagraph = yGap > 16 || /^[\s]*(\d+\.|[A-Z][A-Z\s]{3,}|#{1,6}\s)/.test(lineText);
            if (startsNewParagraph && paragraph) {
                paragraphs.push(paragraph.trim());
                paragraph = lineText;
            } else if (!paragraph) {
                paragraph = lineText;
            } else if (/[\u3002\uFF01\uFF1F.?!:;]$/.test(paragraph.trim())) {
                paragraph += '\n' + lineText;
            } else {
                paragraph += ' ' + lineText;
            }
            previousY = line.y;
        });
        if (paragraph) paragraphs.push(paragraph.trim());
    });
    return paragraphs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
};

const countEffectiveChars = (text) => {
    if (!text) return 0;
    const matches = text.match(/[A-Za-z0-9\u4e00-\u9fff]/g);
    return matches ? matches.length : 0;
};

const shouldPreferImageFallback = (items, pageText) => {
    if (!pageText || pageText.length < 50) return false;
    const trimmed = pageText.replace(/\s+/g, '');
    if (!trimmed) return true;
    const effectiveRatio = countEffectiveChars(pageText) / pageText.length;
    const uniqueRatio = new Set(trimmed).size / trimmed.length;
    return /(.)\1{8,}/.test(trimmed)
        || (items.length < 6 && trimmed.length > 120)
        || effectiveRatio < 0.25
        || uniqueRatio < 0.15;
};

const calculateTextMetrics = (items, pageText, viewport) => {
    const text = (pageText || '').trim();
    const compact = text.replace(/\s+/g, '');
    const effectiveChars = countEffectiveChars(text);
    const lines = groupItemsIntoLines(items || [], viewport || { height: 0, width: 0 });
    const xValues = [];
    const yValues = [];
    lines.forEach(line => {
        line.items.forEach(item => {
            xValues.push(Number(item.x) || 0);
            yValues.push(Number(item.y) || 0);
        });
    });
    const pageArea = viewport?.width && viewport?.height ? viewport.width * viewport.height : 0;
    const textArea = pageArea && xValues.length && yValues.length
        ? Math.max(0, Math.max(...xValues) - Math.min(...xValues)) * Math.max(0, Math.max(...yValues) - Math.min(...yValues))
        : 0;
    return {
        textLength: text.length,
        effectiveChars,
        effectiveRatio: text.length ? effectiveChars / text.length : 0,
        uniqueRatio: compact.length ? new Set(compact).size / compact.length : 0,
        hasLongRepeat: /(.)\1{8,}/.test(compact),
        itemCount: Array.isArray(items) ? items.length : 0,
        lineCount: lines.length,
        coverage: pageArea ? Math.min(1, textArea / pageArea) : 0
    };
};

const estimatePdfPageConfidence = (items, pageText, viewport) => {
    const metrics = calculateTextMetrics(items, pageText, viewport);
    if (!metrics.textLength) return { score: 0, label: 'visual_required', metrics };
    let score = 1;
    if (metrics.textLength < 50) score -= 0.45;
    else if (metrics.textLength < 160) score -= 0.16;
    if (metrics.itemCount < 6 && metrics.textLength > 120) score -= 0.35;
    if (metrics.lineCount < 2 && metrics.textLength > 180) score -= 0.22;
    if (metrics.effectiveRatio < 0.25) score -= 0.35;
    else if (metrics.effectiveRatio < 0.45) score -= 0.16;
    if (metrics.uniqueRatio < 0.15) score -= 0.3;
    else if (metrics.uniqueRatio < 0.25) score -= 0.12;
    if (metrics.hasLongRepeat) score -= 0.4;
    if (metrics.coverage > 0 && metrics.coverage < 0.03 && metrics.textLength > 100) score -= 0.15;
    score = Math.max(0, Math.min(1, score));
    const label = score >= 0.82 ? 'high' : score >= 0.58 ? 'medium' : score >= 0.3 ? 'low' : 'visual_required';
    return { score, label, metrics };
};

const makePagePreview = (pageText, maxLength = 220) => {
    const normalized = (pageText || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, maxLength).replace(/\s+\S*$/, '').trim() + '...';
};

const detectPageSignals = (pageText, confidence, source) => {
    const signals = [];
    const text = pageText || '';
    if (source === 'rendered_image') signals.push('scan_or_image_page');
    if (confidence.label === 'low' || confidence.label === 'visual_required') signals.push('low_text_quality');
    if (/\|.+\|/.test(text) || /\b(Table|琛ㄦ牸|琛╘s*\d+)\b/i.test(text)) signals.push('table_like');
    if (/[鈭戔埆鈭氣増鈮も墺卤鈭炩啋鈫愨啍]|\\frac|\\sum|\$[^$]+\$/.test(text)) signals.push('formula_like');
    if (/^(abstract|鎽樿|introduction|寮曡█|summary)\b/i.test(text.trim())) signals.push('section_like');
    return Array.from(new Set(signals));
};

const preprocessCanvasForOcr = (canvas, options = {}) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width || 0;
    const height = canvas.height || 0;
    if (width <= 0 || height <= 0) return;
    const windowSize = Number.isFinite(options.windowSize) ? options.windowSize : DEFAULT_OCR_WINDOW_SIZE;
    const k = Number.isFinite(options.k) ? options.k : DEFAULT_OCR_K;
    const half = Math.max(1, Math.floor(windowSize / 2));
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        gray[p] = Math.min(255, Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
    }
    const stride = width + 1;
    const size = (width + 1) * (height + 1);
    const integral = new Float64Array(size);
    const integralSq = new Float64Array(size);
    for (let y = 1; y <= height; y += 1) {
        let rowSum = 0;
        let rowSumSq = 0;
        const rowOffset = (y - 1) * width;
        const integralRow = y * stride;
        const integralPrevRow = (y - 1) * stride;
        for (let x = 1; x <= width; x += 1) {
            const val = gray[rowOffset + (x - 1)];
            rowSum += val;
            rowSumSq += val * val;
            const idx = integralRow + x;
            integral[idx] = integral[integralPrevRow + x] + rowSum;
            integralSq[idx] = integralSq[integralPrevRow + x] + rowSumSq;
        }
    }
    const getSum = (x1, y1, x2, y2) => integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1];
    const getSumSq = (x1, y1, x2, y2) => integralSq[y2 * stride + x2] - integralSq[y1 * stride + x2] - integralSq[y2 * stride + x1] + integralSq[y1 * stride + x1];
    for (let y = 0; y < height; y += 1) {
        const y1 = Math.max(0, y - half);
        const y2 = Math.min(height - 1, y + half) + 1;
        for (let x = 0; x < width; x += 1) {
            const x1 = Math.max(0, x - half);
            const x2 = Math.min(width - 1, x + half) + 1;
            const area = (x2 - x1) * (y2 - y1);
            const sum = getSum(x1, y1, x2, y2);
            const sumSq = getSumSq(x1, y1, x2, y2);
            const mean = sum / area;
            const variance = Math.max(0, sumSq / area - mean * mean);
            const std = Math.sqrt(variance);
            const threshold = mean * (1 + k * (std / 128 - 1));
            const idx = y * width + x;
            const out = gray[idx] > threshold ? 255 : 0;
            const dataIdx = idx * 4;
            data[dataIdx] = out;
            data[dataIdx + 1] = out;
            data[dataIdx + 2] = out;
            data[dataIdx + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
};

const renderPdfPageToBlob = async (page, viewport, options = {}) => {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas is unavailable');
    const maxWidth = Number.isFinite(options.renderMaxWidth) ? options.renderMaxWidth : DEFAULT_RENDER_MAX_WIDTH;
    const imageType = typeof options.renderImageType === 'string' ? options.renderImageType : DEFAULT_RENDER_IMAGE_TYPE;
    const quality = Number.isFinite(options.renderQuality) ? options.renderQuality : DEFAULT_RENDER_QUALITY;
    const scale = maxWidth > 0 ? maxWidth / viewport.width : 1;
    const scaledViewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.ceil(scaledViewport.width), Math.ceil(scaledViewport.height));
    const context = canvas.getContext('2d');
    if (!context) return null;
    await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
    if (options.ocrPreprocess === true) {
        preprocessCanvasForOcr(canvas, { windowSize: options.ocrWindowSize, k: options.ocrK });
    }
    let blob = await canvas.convertToBlob({ type: imageType, quality });
    let outputType = imageType;
    if (!blob && imageType !== 'image/png') {
        blob = await canvas.convertToBlob({ type: 'image/png' });
        outputType = 'image/png';
    }
    return { blob, width: canvas.width, height: canvas.height, scale, imageType: outputType, quality, ocrPreprocess: options.ocrPreprocess === true };
};

const parsePdf = async ({ buffer, filename, options, onProgress }) => {
    const pdfjsLib = self.pdfjsLib;
    if (!pdfjsLib) throw new Error('pdfjsLib is unavailable');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const loadingTask = pdfjsLib.getDocument({ data: buffer, cMapUrl: DEFAULT_CMAP_URL, cMapPacked: true, disableWorker: true });
    const pdf = await loadingTask.promise;
    onProgress();
    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 200;
    if (pdf.numPages > maxPages) throw new Error('File structure is too complex.');
    const allowImageFallback = options.allowImageFallback !== false;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();
        onProgress();
        let items = textContent.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, hasEOL: it.hasEOL }));
        items = sortItemsByLayout(items, viewport.width);
        const pageText = cleanAndMergeText(items, viewport);
        const canUseText = pageText.length > 50;
        const confidence = estimatePdfPageConfidence(items, pageText, viewport);
        const preferImageFallback = allowImageFallback && (confidence.label === 'visual_required' || shouldPreferImageFallback(items, pageText));
        const imageOps = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup', 'paintJpegXObject']
            .map(name => pdfjsLib.OPS[name]).filter(Number.isInteger);
        const hasPageImages = allowImageFallback && canUseText && !preferImageFallback
            && (await page.getOperatorList()).fnArray.some(op => imageOps.includes(op));
        onProgress();
        const keepTextWithImage = canUseText && !preferImageFallback && hasPageImages;
        if (canUseText && !preferImageFallback && !hasPageImages) {
            pages.push({ pageNumber: i, source: 'text', confidence, pageText, preview: makePagePreview(pageText), signals: detectPageSignals(pageText, confidence, 'text') });
            continue;
        }
        if (allowImageFallback) {
            const renderedImage = await renderPdfPageToBlob(page, viewport, { ...options, ocrPreprocess: keepTextWithImage ? false : options.ocrPreprocess });
            onProgress();
            if (renderedImage?.blob) {
                pages.push({
                    pageNumber: i,
                    source: keepTextWithImage ? 'text_image' : 'rendered_image',
                    confidence,
                    pageText,
                    preview: makePagePreview(pageText),
                    signals: keepTextWithImage ? [...detectPageSignals(pageText, confidence, 'text'), 'image_on_text_page'] : detectPageSignals(pageText, confidence, 'rendered_image'),
                    image: renderedImage,
                    originalWidth: Math.round(viewport.width),
                    originalHeight: Math.round(viewport.height)
                });
                continue;
            }
            if (keepTextWithImage) throw new Error('PDF page image rendering failed.');
        }
        if (canUseText) {
            pages.push({ pageNumber: i, source: 'text', confidence, pageText, preview: makePagePreview(pageText), signals: detectPageSignals(pageText, confidence, 'text') });
        } else {
            pages.push({ pageNumber: i, source: 'error', confidence, pageText: '', preview: '', signals: ['parse_failed'] });
        }
    }
    return { filename, pageCount: pdf.numPages, pages };
};

self.onmessage = async (event) => {
    const { id, buffer, filename, options = {} } = event.data || {};
    try {
        let lastProgress = 0;
        const onProgress = () => {
            if (Date.now() - lastProgress < 250) return;
            lastProgress = Date.now();
            self.postMessage({ id, type: 'progress' });
        };
        const result = await parsePdf({ buffer, filename, options, onProgress });
        self.postMessage({ id, ok: true, filename: result.filename, pageCount: result.pageCount, pages: result.pages });
    } catch (error) {
        self.postMessage({ id, ok: false, error: error?.message || String(error) });
    }
};
