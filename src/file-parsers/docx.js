// docx.js
import { renderOmml } from './mathUtils.js';
import {
    createMediaContext,
    extractImageMarkdown,
    readFileHeader,
    isZipHeader,
    getZipSafetyStats
} from './media-utils.js';
import { yieldToBrowser } from './yield.js';
import { runParseTask, throwIfParseAborted, reportParseProgress } from './parse-task.js';

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const DEFAULT_MAX_ZIP_ENTRIES = 4000;
const DEFAULT_MAX_XML_CHARS = 8 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSION_RATIO = 200;

const inferHeader = (rPr, pStyleVal) => {
    const match = pStyleVal && pStyleVal.match(/Heading(\d)/);
    if (match) {
        return parseInt(match[1], 10);
    }

    if (rPr) {
        const isBold = rPr.getElementsByTagName('w:b').length > 0;
        const szVal = rPr.getElementsByTagName('w:sz')[0]?.getAttribute('w:val');
        const size = Number(szVal || 0);
        if (isBold && size >= 32) return 1;
        if (isBold && size >= 28) return 2;
    }

    return 0;
};

export function createDocxReader({ loadScript, getToastMessage }) {
    const getMessage = (key, params) => {
        if (typeof getToastMessage !== 'function') return '';
        return getToastMessage(key, params);
    };

    const guardDocxFile = async (file, options) => {
        const maxFileBytes = Number.isFinite(options.maxFileBytes) ? options.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
        if (file?.size && file.size > maxFileBytes) {
            throw new Error(getMessage('fileManagement.fileTooLarge') || 'File too large.');
        }
        const header = await readFileHeader(file, 4);
        if (!isZipHeader(header)) {
            throw new Error(getMessage('fileManagement.invalidFileType') || 'Invalid file type.');
        }
    };

    const guardZip = (zip, options) => {
        const maxEntries = Number.isFinite(options.maxZipEntries) ? options.maxZipEntries : DEFAULT_MAX_ZIP_ENTRIES;
        const maxUncompressedBytes = Number.isFinite(options.maxUncompressedBytes)
            ? options.maxUncompressedBytes
            : DEFAULT_MAX_UNCOMPRESSED_BYTES;
        const maxCompressionRatio = Number.isFinite(options.maxCompressionRatio)
            ? options.maxCompressionRatio
            : DEFAULT_MAX_COMPRESSION_RATIO;
        const stats = getZipSafetyStats(zip);
        if (stats.entries > maxEntries) {
            throw new Error(getMessage('fileManagement.tooManyEntries') || 'Too many entries in archive.');
        }
        if (stats.uncompressedBytes && stats.uncompressedBytes > maxUncompressedBytes) {
            throw new Error(getMessage('fileManagement.fileCompressedTooLarge') || 'Compressed file too large.');
        }
        if (stats.compressedBytes > 0 && stats.uncompressedBytes > 0) {
            const ratio = stats.uncompressedBytes / stats.compressedBytes;
            if (ratio > maxCompressionRatio) {
                throw new Error(getMessage('fileManagement.fileCompressedTooLarge') || 'Compressed file too large.');
            }
        }
    };
    const parseSymbolNode = (node) => {
        if (!node || node.nodeType !== 1) return '';
        const hex = node.getAttribute('w:char') || node.getAttribute('char');
        if (!hex) return '';
        const code = parseInt(hex, 16);
        if (Number.isNaN(code)) return '';
        try {
            return String.fromCodePoint(code);
        } catch (_) {
            return '';
        }
    };

    const collectInlineContent = async (node, parts, ctx, includeImages) => {
        throwIfParseAborted(ctx.signal);
        if (!node) return;
        if (node.nodeType !== 1) return;

        const name = node.localName || node.nodeName;
        if (name === 'instrText' || name === 'delText' || name === 'fldChar') {
            return;
        }
        if (name === 'oMath' || name === 'oMathPara') {
            const math = renderOmml(node).trim();
            if (math) parts.push(` $${math}$ `);
            return;
        }
        if (name === 'tab') {
            parts.push(' ');
            return;
        }
        if (name === 'br') {
            parts.push('\n');
            return;
        }
        if (name === 'sym') {
            const symbol = parseSymbolNode(node);
            if (symbol) parts.push(symbol);
            return;
        }
        if (name === 'drawing' || name === 'pict' || name === 'object' || name === 'OLEObject' || name === 'imagedata') {
            if (!includeImages) {
                return;
            }
            const imageMarkdown = await extractImageMarkdown(node, ctx);
            parts.push(imageMarkdown || '[Image]');
            return;
        }
        if (name === 't') {
            if (node.textContent) parts.push(node.textContent);
            return;
        }

        for (const child of Array.from(node.childNodes)) {
            await collectInlineContent(child, parts, ctx, includeImages);
        }
    };

    const extractCellText = async (cell, ctx, includeImages) => {
        let cellText = '';
        const paragraphs = Array.from(cell.getElementsByTagName('w:p'));
        for (let index = 0; index < paragraphs.length; index += 1) {
            const paragraph = paragraphs[index];
            const parts = [];
            await collectInlineContent(paragraph, parts, ctx, includeImages);
            const line = parts.join('').trim();
            if (line) {
                cellText += (index > 0 ? '<br>' : '') + line;
            }
        }
        return cellText;
    };

    const extractDocxTextWithOmml = async (arrayBuffer, options = {}) => {
        const includeImages = options.includeImages !== false;
        await loadScript('/libs/jszip.min.js', 'JSZip');
        throwIfParseAborted(options.signal);
        const zip = await JSZip.loadAsync(arrayBuffer);
        reportParseProgress(options.signal);
        guardZip(zip, options);
        const docXml = await zip.file('word/document.xml').async('text');
        const maxXmlChars = Number.isFinite(options.maxXmlChars) ? options.maxXmlChars : DEFAULT_MAX_XML_CHARS;
        if (docXml.length > maxXmlChars) {
            throw new Error(getMessage('fileManagement.fileCompressedTooLarge') || 'Compressed file too large.');
        }
        const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('text');
        throwIfParseAborted(options.signal);
        const parser = new DOMParser();
        const doc = parser.parseFromString(docXml, 'application/xml');
        const relsDoc = relsXml ? parser.parseFromString(relsXml, 'application/xml') : null;
        const ctx = createMediaContext(zip, relsDoc, 'word', loadScript);
        ctx.signal = options.signal;

        let fullText = '';
        const body = doc.getElementsByTagName('w:body')[0];
        const bodyChildren = body ? body.childNodes : [];

        const nodes = Array.from(bodyChildren);
        for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
            if (nodeIndex % 8 === 0) {
                await yieldToBrowser(options.signal);
            }
            const node = nodes[nodeIndex];
            if (node.nodeName === 'w:p') {
                const pPr = node.getElementsByTagName('w:pPr')[0];
                const firstRun = node.getElementsByTagName('w:r')[0];
                const rPr = firstRun ? firstRun.getElementsByTagName('w:rPr')[0] : null;
                const pStyle = pPr?.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val');
                const level = inferHeader(rPr, pStyle);
                const numPr = node.getElementsByTagName('w:numPr')[0];
                const listPrefix = numPr ? '- ' : '';

                const parts = [];
                await collectInlineContent(node, parts, ctx, includeImages);
                const line = parts.join('').trim();
                if (line) {
                    const prefix = level > 0 ? '#'.repeat(level) + ' ' : listPrefix;
                    fullText += `${prefix}${line}\n\n`;
                }
            } else if (node.nodeName === 'w:tbl') {
                const rows = Array.from(node.getElementsByTagName('w:tr'));
                if (rows.length === 0) continue;

                const matrix = [];
                for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
                    if (rowIndex % 12 === 0) {
                        await yieldToBrowser(options.signal);
                    }
                    const row = rows[rowIndex];
                    const cells = Array.from(row.getElementsByTagName('w:tc'));
                    const rowValues = [];
                    for (const cell of cells) {
                        rowValues.push(await extractCellText(cell, ctx, includeImages));
                    }
                    matrix.push(rowValues);
                    reportParseProgress(options.signal);
                }

                const header = matrix[0];
                fullText += `| ${header.join(' | ')} |\n`;
                fullText += `| ${header.map(() => '---').join(' | ')} |\n`;
                matrix.slice(1).forEach(row => {
                    while (row.length < header.length) row.push('');
                    fullText += `| ${row.join(' | ')} |\n`;
                });
                fullText += '\n';
            }
            reportParseProgress(options.signal);
        }

        return { text: fullText };
    };

    const readDocxFile = async (file, options = {}) => {
        await guardDocxFile(file, options);
        return await runParseTask(async (signal) => {
            const buffer = await file.arrayBuffer();
            throwIfParseAborted(signal);
            return await extractDocxTextWithOmml(buffer, { ...options, signal });
        }, file, options, getMessage('fileManagement.parseTimeout'));
    };

    return { readDocxFile };
}
