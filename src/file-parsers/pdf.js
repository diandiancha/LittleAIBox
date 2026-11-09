// pdf.js
import { processAndSaveImage, readFileHeader, isPdfHeader } from './media-utils.js';
import { yieldToBrowser } from './yield.js';
import { runParseTask, runParserWorker, throwIfParseAborted, reportParseProgress } from './parse-task.js';

const DEFAULT_MAX_FILE_BYTES = 30 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 200;
const DEFAULT_OCR_WINDOW_SIZE = 25;
const DEFAULT_OCR_K = 0.34;
const DEFAULT_RENDER_MAX_WIDTH = 2000;
const DEFAULT_RENDER_IMAGE_TYPE = 'image/webp';
const DEFAULT_RENDER_QUALITY = 0.94;
const DEFAULT_CMAP_URL = '/libs/cmaps/';

export function createPdfReader({ loadScript, getToastMessage }) {
    const getMessage = (key, params) => {
        if (typeof getToastMessage !== 'function') return '';
        return getToastMessage(key, params);
    };

    const guardPdfFile = async (file, options) => {
        const maxFileBytes = Number.isFinite(options.maxFileBytes) ? options.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
        if (file?.size && file.size > maxFileBytes) {
            throw new Error(getMessage('fileManagement.fileTooLarge') || 'File too large.');
        }
        const header = await readFileHeader(file, 4);
        if (!isPdfHeader(header)) {
            throw new Error(getMessage('fileManagement.invalidFileType') || 'Invalid file type.');
        }
    };

    const canUsePdfParserWorker = (options = {}) => {
        return options.disableParserWorker !== true
            && typeof Worker !== 'undefined'
            && typeof OffscreenCanvas !== 'undefined';
    };

    const buildPdfWorkerOptions = (options = {}) => ({
        allowImageFallback: options.allowImageFallback !== false,
        ocrPreprocess: options.ocrPreprocess === true,
        outputFormat: options.outputFormat === 'structured_context' ? 'structured_context' : 'markdown',
        maxPages: Number.isFinite(options.maxPages) ? options.maxPages : DEFAULT_MAX_PAGES,
        renderMaxWidth: Number.isFinite(options.renderMaxWidth) ? options.renderMaxWidth : DEFAULT_RENDER_MAX_WIDTH,
        renderImageType: typeof options.renderImageType === 'string' ? options.renderImageType : DEFAULT_RENDER_IMAGE_TYPE,
        renderQuality: Number.isFinite(options.renderQuality) ? options.renderQuality : DEFAULT_RENDER_QUALITY,
        ocrWindowSize: options.ocrWindowSize,
        ocrK: options.ocrK
    });

    const parsePdfInWorker = (file, options, signal) => runParserWorker(file,
        () => new Worker(new URL('../worker-parsers/pdf-parser-worker.js', import.meta.url)), signal, {
            filename: file?.name || 'document.pdf',
            options: buildPdfWorkerOptions(options)
        });

    const sortItemsByLayout = (items, pageWidth) => {
        if (items.length < 50) {
            return items.sort((a, b) => b.y - a.y);
        }

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

        for (let i = centerIdx - range; i < centerIdx + range; i++) {
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

    const normalizeTextLine = (line) => (line || '')
        .replace(/\s+/g, ' ')
        .replace(/([a-z])- ([a-z])/g, '$1$2')
        .trim();

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
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            return minX < pageLeft && maxX > pageRight;
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
                if (maxX < middleStart) {
                    leftLines.push(line);
                } else if (minX > middleEnd) {
                    rightLines.push(line);
                } else {
                    middleGapCandidates += 1;
                }
            });

            const sideLineCount = leftLines.length + rightLines.length;
            const hasBalancedColumns = leftLines.length >= 4
                && rightLines.length >= 4
                && sideLineCount >= segment.length * 0.55
                && middleGapCandidates <= segment.length * 0.45;

            if (hasBalancedColumns) {
                groups.push(leftLines, rightLines);
            } else {
                groups.push(segment);
            }
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
            if (lastEndX !== null && x - lastEndX > 8 && !/\s$/.test(text)) {
                text += ' ';
            }
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
        const effectiveChars = countEffectiveChars(pageText);
        const effectiveRatio = effectiveChars / pageText.length;
        const uniqueChars = new Set(trimmed).size;
        const uniqueRatio = uniqueChars / trimmed.length;
        const hasLongRepeat = /(.)\1{8,}/.test(trimmed);
        const tooFewItems = items.length < 6 && trimmed.length > 120;
        const lowSignal = effectiveRatio < 0.25 || uniqueRatio < 0.15;
        return hasLongRepeat || tooFewItems || lowSignal;
    };

    const calculateTextMetrics = (items, pageText, viewport) => {
        const text = (pageText || '').trim();
        const compact = text.replace(/\s+/g, '');
        const effectiveChars = countEffectiveChars(text);
        const effectiveRatio = text.length ? effectiveChars / text.length : 0;
        const uniqueRatio = compact.length ? new Set(compact).size / compact.length : 0;
        const hasLongRepeat = /(.)\1{8,}/.test(compact);
        const itemCount = Array.isArray(items) ? items.length : 0;
        const lines = groupItemsIntoLines(items || [], viewport || { height: 0, width: 0 });
        const lineCount = lines.length;
        const xValues = [];
        const yValues = [];
        lines.forEach(line => {
            line.items.forEach(item => {
                xValues.push(Number(item.x) || 0);
                yValues.push(Number(item.y) || 0);
            });
        });
        const minX = xValues.length ? Math.min(...xValues) : 0;
        const maxX = xValues.length ? Math.max(...xValues) : 0;
        const minY = yValues.length ? Math.min(...yValues) : 0;
        const maxY = yValues.length ? Math.max(...yValues) : 0;
        const pageArea = viewport?.width && viewport?.height ? viewport.width * viewport.height : 0;
        const textArea = pageArea ? Math.max(0, maxX - minX) * Math.max(0, maxY - minY) : 0;
        const coverage = pageArea ? Math.min(1, textArea / pageArea) : 0;

        return {
            textLength: text.length,
            effectiveChars,
            effectiveRatio,
            uniqueRatio,
            hasLongRepeat,
            itemCount,
            lineCount,
            coverage
        };
    };

    const estimatePdfPageConfidence = (items, pageText, viewport) => {
        const metrics = calculateTextMetrics(items, pageText, viewport);
        if (!metrics.textLength) {
            return { score: 0, label: 'visual_required', metrics };
        }

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

        const label = score >= 0.82
            ? 'high'
            : score >= 0.58
                ? 'medium'
                : score >= 0.3
                    ? 'low'
                    : 'visual_required';
        return { score, label, metrics };
    };

    const buildParseNotes = (confidence, source) => {
        const notes = [];
        if (source === 'rendered_image') {
            notes.push('Text extraction was unavailable or low quality. Use image detail retrieval before answering visual or exact-content questions about this page.');
        } else if (confidence.label === 'low') {
            notes.push('Text was extracted from the PDF text layer, but reading order or character quality may be unreliable.');
        } else if (confidence.label === 'medium') {
            notes.push('Text was extracted from the PDF text layer. Tables, formulas, columns, and footnotes may need caution.');
        } else {
            notes.push('Text was extracted from the PDF text layer.');
        }
        const metrics = confidence.metrics || {};
        notes.push(`Signals: chars=${metrics.textLength || 0}, items=${metrics.itemCount || 0}, lines=${metrics.lineCount || 0}, effectiveRatio=${(metrics.effectiveRatio || 0).toFixed(2)}, uniqueRatio=${(metrics.uniqueRatio || 0).toFixed(2)}.`);
        return notes.join(' ');
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
        if (/\|.+\|/.test(text) || /\b(Table|表格|表\s*\d+)\b/i.test(text)) signals.push('table_like');
        if (/[∑∫√≈≤≥±∞→←↔]|\\frac|\\sum|\$[^$]+\$/.test(text)) signals.push('formula_like');
        if (/^(abstract|摘要|introduction|引言|summary)\b/i.test(text.trim())) signals.push('section_like');
        return Array.from(new Set(signals));
    };

    const buildDisplayTextPage = (pageNumber, pageText) => {
        return [`### Page ${pageNumber}`, pageText].filter(Boolean).join('\n\n');
    };

    const buildDisplayImagePage = (pageNumber, refId) => {
        return [`### Page ${pageNumber}`, `![page-${pageNumber}](${refId})`].join('\n\n');
    };

    const formatDocumentMap = (pageRecords, pageCount) => {
        const textPages = pageRecords.filter(page => page.source === 'text' || page.source === 'text_image').length;
        const imagePages = pageRecords.filter(page => page.source === 'rendered_image').length;
        const lowConfidencePages = pageRecords.filter(page =>
            page.confidence === 'low' || page.confidence === 'visual_required'
        ).length;
        const lines = [
            '<DocumentMap>',
            `Total pages: ${pageCount}`,
            `Text pages: ${textPages}`,
            `Image fallback pages: ${imagePages}`,
            `Low confidence pages: ${lowConfidencePages}`
        ];

        pageRecords.forEach(page => {
            const attrs = [
                `number="${page.pageNumber}"`,
                `source="${page.source}"`,
                `confidence="${page.confidence}"`,
                `chars="${page.textLength || 0}"`
            ].join(' ');
            lines.push(`<PageMap ${attrs}>`);
            if (page.preview) lines.push(`Preview: ${page.preview}`);
            if (page.signals.length) lines.push(`Signals: ${page.signals.join(', ')}`);
            lines.push('</PageMap>');
        });

        lines.push('</DocumentMap>');
        return lines.join('\n');
    };

    const buildParseMeta = (pageRecords, pageCount) => {
        const textPages = pageRecords.filter(page => page.source === 'text' || page.source === 'text_image').length;
        const imageFallbackPages = pageRecords.filter(page => page.source === 'rendered_image').length;
        const lowConfidencePages = pageRecords
            .filter(page => page.confidence === 'low' || page.confidence === 'visual_required')
            .map(page => page.pageNumber);

        return {
            format: 'pdf_structured_v1',
            pageCount,
            textPages,
            imageFallbackPages,
            imagePageCount: pageRecords.filter(page => page.source === 'rendered_image' || page.source === 'text_image').length,
            lowConfidencePages,
            pages: pageRecords.map(page => ({
                pageNumber: page.pageNumber,
                source: page.source,
                confidence: page.confidence,
                score: page.score,
                textLength: page.textLength,
                signals: page.signals
            }))
        };
    };

    const formatTextPage = (pageNumber, pageText, confidence, outputFormat) => {
        if (outputFormat !== 'structured_context') {
            return `\n<Page: ${pageNumber}>\n${pageText}\n`;
        }
        return [
            `\n<Page number="${pageNumber}" source="text" confidence="${confidence.label}" score="${confidence.score.toFixed(2)}">`,
            '<ParseNotes>',
            buildParseNotes(confidence, 'text'),
            '</ParseNotes>',
            '<Text>',
            pageText,
            '</Text>',
            '</Page>\n'
        ].join('\n');
    };

    const formatImagePage = (pageNumber, refId, confidence, outputFormat, pageText = '') => {
        if (outputFormat !== 'structured_context') {
            return `\n<PageImage: ${pageNumber}>\n${pageText}\n![page-${pageNumber}](${refId})\n`;
        }
        return [
            `\n<Page number="${pageNumber}" source="${pageText ? 'text_image' : 'rendered_image'}" confidence="${pageText ? confidence.label : 'visual_required'}" score="${confidence.score.toFixed(2)}">`,
            ...(pageText ? ['<Text>', pageText, '</Text>'] : []),
            '<ImageRef>',
            refId,
            '</ImageRef>',
            '<ParseNotes>',
            pageText ? 'Text and visual evidence coexist on this page. Read the image for details absent from the text layer.' : buildParseNotes(confidence, 'rendered_image'),
            '</ParseNotes>',
            '</Page>\n'
        ].join('\n');
    };

    const buildPdfResultFromWorkerPayload = async (payload, file, options = {}) => {
        const allowImageFallback = options.allowImageFallback !== false;
        const outputFormat = options.outputFormat === 'structured_context' ? 'structured_context' : 'markdown';
        const pageCount = Number.isFinite(payload?.pageCount) ? payload.pageCount : 0;
        const pages = Array.isArray(payload?.pages) ? payload.pages : [];
        let documentText = outputFormat === 'structured_context'
            ? `<DocumentContext format="pdf_structured_v1" filename="${String(file?.name || payload?.filename || 'document.pdf').replace(/"/g, '&quot;')}" pages="${pageCount}">\n`
            : '';
        let displayText = '';
        const pageRecords = [];
        const pageErrors = [];
        let parsedPages = 0;
        let imageFallbackPages = 0;

        for (const page of pages) {
            // The previous page (if any) has been fully assembled and saved.
            reportParseProgress(options.signal);
            const pageNumber = page.pageNumber;
            const pageText = page.pageText || '';
            const confidence = page.confidence && typeof page.confidence === 'object'
                ? page.confidence
                : estimatePdfPageConfidence([], pageText, { width: 0, height: 0 });
            const signals = Array.isArray(page.signals) ? page.signals : detectPageSignals(pageText, confidence, page.source);

            if (page.source === 'text') {
                documentText += formatTextPage(pageNumber, pageText, confidence, outputFormat);
                displayText += `${displayText ? '\n\n' : ''}${buildDisplayTextPage(pageNumber, pageText)}`;
                pageRecords.push({
                    pageNumber,
                    source: 'text',
                    confidence: confidence.label,
                    score: Number(confidence.score.toFixed(2)),
                    textLength: pageText.length,
                    preview: page.preview || makePagePreview(pageText),
                    signals
                });
                parsedPages += 1;
                continue;
            }

            if ((page.source === 'rendered_image' || page.source === 'text_image') && page.image?.blob) {
                const keptText = page.source === 'text_image' ? pageText : '';
                const refId = await processAndSaveImage(
                    page.image.blob,
                    page.image.width,
                    page.image.height,
                    {
                        source: 'rendered_page',
                        originalWidth: Math.round(page.originalWidth || 0),
                        originalHeight: Math.round(page.originalHeight || 0),
                        renderScale: page.image.scale,
                        renderMaxWidth: Number.isFinite(options.renderMaxWidth) ? options.renderMaxWidth : DEFAULT_RENDER_MAX_WIDTH,
                        renderMime: page.image.blob.type || page.image.imageType,
                        renderQuality: page.image.quality,
                        ocrPreprocess: page.image.ocrPreprocess
                    }
                );
                if (!refId && keptText) throw new Error('PDF page image persistence failed.');
                if (refId) {
                    documentText += formatImagePage(pageNumber, refId, confidence, outputFormat, keptText);
                    displayText += `${displayText ? '\n\n' : ''}${keptText ? `${buildDisplayTextPage(pageNumber, keptText)}\n\n![page-${pageNumber}](${refId})` : buildDisplayImagePage(pageNumber, refId)}`;
                    pageRecords.push({
                        pageNumber,
                        source: keptText ? 'text_image' : 'rendered_image',
                        confidence: keptText ? confidence.label : 'visual_required',
                        score: Number(confidence.score.toFixed(2)),
                        textLength: pageText.length,
                        preview: '',
                        signals
                    });
                    if (!keptText) imageFallbackPages += 1;
                    parsedPages += 1;
                }
                continue;
            }

            pageErrors.push(`Failed to parse page ${pageNumber}`);
        }

        if (outputFormat === 'structured_context') {
            documentText += `${formatDocumentMap(pageRecords, pageCount)}\n`;
            documentText += '</DocumentContext>\n';
        }

        const parseMeta = buildParseMeta(pageRecords, pageCount);
        if (parsedPages === 0) {
            if (imageFallbackPages > 0) {
                return { text: documentText.trim(), displayText: displayText.trim(), parseMeta };
            }
            if (!allowImageFallback) {
                return { text: '', displayText: '', parseMeta };
            }
            if (pageErrors.length === pages.length && pageErrors.length > 0) {
                throw new Error(pageErrors.join('\n'));
            }
            throw new Error(
                getMessage('fileManagement.pdfScanVersion')
                    || 'This PDF may be a scan and cannot be parsed.'
            );
        }

        return { text: documentText, displayText, parseMeta };
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
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            gray[p] = Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
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

        const getSum = (x1, y1, x2, y2) => {
            const a = y1 * stride + x1;
            const b = y1 * stride + x2;
            const c = y2 * stride + x1;
            const d = y2 * stride + x2;
            return integral[d] - integral[b] - integral[c] + integral[a];
        };
        const getSumSq = (x1, y1, x2, y2) => {
            const a = y1 * stride + x1;
            const b = y1 * stride + x2;
            const c = y2 * stride + x1;
            const d = y2 * stride + x2;
            return integralSq[d] - integralSq[b] - integralSq[c] + integralSq[a];
        };

        for (let y = 0; y < height; y += 1) {
            const y1 = Math.max(0, y - half);
            const y2 = Math.min(height - 1, y + half);
            const iy1 = y1;
            const iy2 = y2 + 1;
            for (let x = 0; x < width; x += 1) {
                const x1 = Math.max(0, x - half);
                const x2 = Math.min(width - 1, x + half);
                const ix1 = x1;
                const ix2 = x2 + 1;
                const area = (ix2 - ix1) * (iy2 - iy1);
                const sum = getSum(ix1, iy1, ix2, iy2);
                const sumSq = getSumSq(ix1, iy1, ix2, iy2);
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

    const canvasToBlob = (canvas, imageType, quality) => new Promise((resolve) => {
        if (!canvas || typeof canvas.toBlob !== 'function') {
            resolve(null);
            return;
        }
        canvas.toBlob((blob) => resolve(blob), imageType, quality);
    });

    const renderPdfPageToBlob = async (page, viewport, options = {}) => {
        const {
            maxWidth = DEFAULT_RENDER_MAX_WIDTH,
            imageType = DEFAULT_RENDER_IMAGE_TYPE,
            quality = DEFAULT_RENDER_QUALITY,
            ocrPreprocess = false,
            ocrWindowSize,
            ocrK
        } = options;
        const scale = maxWidth > 0 ? maxWidth / viewport.width : 1;
        const scaledViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(scaledViewport.width);
        canvas.height = Math.ceil(scaledViewport.height);
        const context = canvas.getContext('2d');
        if (!context) return '';
        await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
        if (ocrPreprocess) {
            try {
                preprocessCanvasForOcr(canvas, {
                    windowSize: ocrWindowSize,
                    k: ocrK
                });
            } catch (_) { }
        }
        let blob = await canvasToBlob(canvas, imageType, quality);
        let outputType = imageType;
        if (!blob && imageType !== 'image/png') {
            blob = await canvasToBlob(canvas, 'image/png');
            outputType = 'image/png';
        }
        return {
            blob,
            width: canvas.width,
            height: canvas.height,
            scale,
            imageType: outputType,
            quality,
            ocrPreprocess
        };
    };

    const parsePdfFile = async (file, options, signal) => {
        const allowImageFallback = options.allowImageFallback !== false;
        const ocrPreprocess = options.ocrPreprocess === true;
        const outputFormat = options.outputFormat === 'structured_context' ? 'structured_context' : 'markdown';
        if (canUsePdfParserWorker(options)) {
            try {
                const workerPayload = await parsePdfInWorker(file, options, signal);
                return await buildPdfResultFromWorkerPayload(workerPayload, file, { ...options, signal });
            } catch (_) {
                throwIfParseAborted(signal);
                if (options.forceParserWorker === true) throw _;
            }
        }

        await loadScript('/libs/pdf.min.js', 'pdfjsLib');
        throwIfParseAborted(signal);
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/libs/pdf.worker.min.js';

        return await new Promise(async (resolve, reject) => {
            let loadingTask;
            const destroyLoadingTask = () => {
                const task = loadingTask;
                loadingTask = null;
                if (task) {
                    try { Promise.resolve(task.destroy()).catch(() => {}); } catch (_) { }
                }
            };
            try {
                const buffer = await file.arrayBuffer();
                throwIfParseAborted(signal);
                loadingTask = pdfjsLib.getDocument({
                    data: buffer,
                    cMapUrl: DEFAULT_CMAP_URL,
                    cMapPacked: true,
                    useWorkerFetch: true
                });
                signal.addEventListener('abort', destroyLoadingTask, { once: true });
                    const pdf = await loadingTask.promise;
                    reportParseProgress(signal);
                    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : DEFAULT_MAX_PAGES;
                    if (pdf.numPages > maxPages) {
                        throw new Error(getMessage('fileManagement.fileCompressedTooLarge') || 'File structure is too complex.');
                    }
                    let documentText = outputFormat === 'structured_context'
                        ? `<DocumentContext format="pdf_structured_v1" filename="${String(file?.name || 'document.pdf').replace(/"/g, '&quot;')}" pages="${pdf.numPages}">\n`
                        : '';
                    let displayText = '';
                    const pageRecords = [];
                    const pageErrors = [];
                    let parsedPages = 0;
                    let imageFallbackPages = 0;

                    for (let i = 1; i <= pdf.numPages; i++) {
                        await yieldToBrowser(signal);
                        let requiresPageImage = false;
                        try {
                            const page = await pdf.getPage(i);
                            const viewport = page.getViewport({ scale: 1.0 });
                            const textContent = await page.getTextContent();
                            reportParseProgress(signal);

                            let items = textContent.items.map(it => ({
                                str: it.str,
                                x: it.transform[4],
                                y: it.transform[5],
                                width: it.width,
                                hasEOL: it.hasEOL
                            }));

                            items = sortItemsByLayout(items, viewport.width);
                            const pageText = cleanAndMergeText(items, viewport);
                            const canUseText = pageText.length > 50;
                            const confidence = estimatePdfPageConfidence(items, pageText, viewport);
                            const preferImageFallback = allowImageFallback
                                && (confidence.label === 'visual_required' || shouldPreferImageFallback(items, pageText));
                            const imageOps = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup', 'paintJpegXObject']
                                .map(name => pdfjsLib.OPS[name]).filter(Number.isInteger);
                            const hasPageImages = allowImageFallback && canUseText && !preferImageFallback
                                && (await page.getOperatorList()).fnArray.some(op => imageOps.includes(op));
                            reportParseProgress(signal);
                            const keepTextWithImage = canUseText && !preferImageFallback && hasPageImages;
                            requiresPageImage = keepTextWithImage;

                            if (canUseText && !preferImageFallback && !hasPageImages) {
                                documentText += formatTextPage(i, pageText, confidence, outputFormat);
                                displayText += `${displayText ? '\n\n' : ''}${buildDisplayTextPage(i, pageText)}`;
                                pageRecords.push({
                                    pageNumber: i,
                                    source: 'text',
                                    confidence: confidence.label,
                                    score: Number(confidence.score.toFixed(2)),
                                    textLength: pageText.length,
                                    preview: makePagePreview(pageText),
                                    signals: detectPageSignals(pageText, confidence, 'text')
                                });
                                parsedPages += 1;
                            } else if (allowImageFallback) {
                                await yieldToBrowser(signal);
                                const renderedImage = await renderPdfPageToBlob(page, viewport, {
                                    maxWidth: Number.isFinite(options.renderMaxWidth) ? options.renderMaxWidth : DEFAULT_RENDER_MAX_WIDTH,
                                    imageType: typeof options.renderImageType === 'string' ? options.renderImageType : DEFAULT_RENDER_IMAGE_TYPE,
                                    quality: Number.isFinite(options.renderQuality) ? options.renderQuality : DEFAULT_RENDER_QUALITY,
                                    ocrPreprocess: keepTextWithImage ? false : ocrPreprocess,
                                    ocrWindowSize: options.ocrWindowSize,
                                    ocrK: options.ocrK
                                });
                                reportParseProgress(signal);
                                if (!renderedImage?.blob && keepTextWithImage) throw new Error('PDF page image rendering failed.');
                                if (renderedImage?.blob) {
                                    const refId = await processAndSaveImage(
                                        renderedImage.blob,
                                        renderedImage.width,
                                        renderedImage.height,
                                        {
                                            source: 'rendered_page',
                                            originalWidth: Math.round(viewport.width),
                                            originalHeight: Math.round(viewport.height),
                                            renderScale: renderedImage.scale,
                                            renderMaxWidth: Number.isFinite(options.renderMaxWidth) ? options.renderMaxWidth : DEFAULT_RENDER_MAX_WIDTH,
                                            renderMime: renderedImage.blob.type || renderedImage.imageType,
                                            renderQuality: renderedImage.quality,
                                            ocrPreprocess: renderedImage.ocrPreprocess
                                        }
                                    );
                                    if (!refId && keepTextWithImage) throw new Error('PDF page image persistence failed.');
                                    if (refId) {
                                        documentText += formatImagePage(i, refId, confidence, outputFormat, keepTextWithImage ? pageText : '');
                                        displayText += `${displayText ? '\n\n' : ''}${keepTextWithImage ? `${buildDisplayTextPage(i, pageText)}\n\n![page-${i}](${refId})` : buildDisplayImagePage(i, refId)}`;
                                        pageRecords.push({
                                            pageNumber: i,
                                            source: keepTextWithImage ? 'text_image' : 'rendered_image',
                                            confidence: keepTextWithImage ? confidence.label : 'visual_required',
                                            score: Number(confidence.score.toFixed(2)),
                                            textLength: pageText.length,
                                            preview: '',
                                            signals: keepTextWithImage ? [...detectPageSignals(pageText, confidence, 'text'), 'image_on_text_page'] : detectPageSignals(pageText, confidence, 'rendered_image')
                                        });
                                        if (!keepTextWithImage) imageFallbackPages += 1;
                                        parsedPages += 1;
                                    }
                                }
                            } else if (canUseText) {
                                documentText += formatTextPage(i, pageText, confidence, outputFormat);
                                displayText += `${displayText ? '\n\n' : ''}${buildDisplayTextPage(i, pageText)}`;
                                pageRecords.push({
                                    pageNumber: i,
                                    source: 'text',
                                    confidence: confidence.label,
                                    score: Number(confidence.score.toFixed(2)),
                                    textLength: pageText.length,
                                    preview: makePagePreview(pageText),
                                    signals: detectPageSignals(pageText, confidence, 'text')
                                });
                                parsedPages += 1;
                            }
                        } catch (pageError) {
                            throwIfParseAborted(signal);
                            if (requiresPageImage) throw pageError;
                            const message = getMessage('fileManagement.pageParseFailed', { number: i })
                                || `Failed to parse page ${i}`;
                            pageErrors.push(message);
                        }
                        reportParseProgress(signal);
                    }
                    if (outputFormat === 'structured_context') {
                        documentText += `${formatDocumentMap(pageRecords, pdf.numPages)}\n`;
                        documentText += '</DocumentContext>\n';
                    }
                    const parseMeta = buildParseMeta(pageRecords, pdf.numPages);
                    if (parsedPages === 0) {
                        if (imageFallbackPages > 0) {
                            resolve({ text: documentText.trim(), displayText: displayText.trim(), parseMeta });
                            return;
                        }
                        if (!allowImageFallback) {
                            resolve({ text: '', displayText: '', parseMeta });
                            return;
                        }
                        if (pageErrors.length === pdf.numPages) {
                            throw new Error(pageErrors.join('\n'));
                        }
                        throw new Error(
                            getMessage('fileManagement.pdfScanVersion')
                                || 'This PDF may be a scan and cannot be parsed.'
                        );
                    }
                    resolve({ text: documentText, displayText, parseMeta });
            } catch (e) {
                reject(e);
            } finally {
                signal.removeEventListener('abort', destroyLoadingTask);
                destroyLoadingTask();
            }
        });
    };

    const readPdfFile = async (file, options = {}) => {
        await guardPdfFile(file, options);
        return await runParseTask(signal => parsePdfFile(file, options, signal),
            file, options, getMessage('fileManagement.parseTimeout'));
    };

    return { readPdfFile };
}
