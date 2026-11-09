self.importScripts('/libs/xlsx.full.min.js');

const convertWorkbookToMarkdown = (workbook, labels = {}) => {
    labels.onProgress?.();
    const worksheetLabel = labels.worksheet || 'Worksheet';
    const maxColumns = Number.isFinite(labels.maxColumns) ? labels.maxColumns : 100;
    let allMarkdown = '';
    workbook.SheetNames.forEach(sheetName => {
        allMarkdown += `\n\n## ${worksheetLabel}: ${sheetName}\n\n`;
        const worksheet = workbook.Sheets[sheetName];
        const json = self.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (json.length > 0 && json[0].length > 0) {
            const columnCount = Math.min(json[0].length, maxColumns);
            const headerRow = json[0]
                .slice(0, columnCount)
                .map(cell => (cell === null || cell === undefined ? '' : String(cell).replace(/\n/g, '<br>')));
            allMarkdown += `| ${headerRow.join(' | ')} |\n`;
            allMarkdown += `| ${new Array(columnCount).fill('---').join(' | ')} |\n`;
            json.slice(1).forEach((row, index) => {
                const newRow = row.map(cell => {
                    if (cell === null || cell === undefined) return '';
                    return String(cell).replace(/\n/g, '<br>');
                });
                while (newRow.length < columnCount) newRow.push('');
                allMarkdown += `| ${newRow.slice(0, columnCount).join(' | ')} |\n`;
                if (index % 256 === 0) labels.onProgress?.();
            });
        }
        labels.onProgress?.();
    });
    return allMarkdown;
};

const detectEncodingFromBom = (bytes) => {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    return null;
};

const estimateNullRatio = (bytes) => {
    if (!bytes.length) return 0;
    let nullCount = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        if (bytes[i] === 0) nullCount += 1;
    }
    return nullCount / bytes.length;
};

const estimateReplacementRatio = (text) => {
    if (!text) return 1;
    let replacements = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\uFFFD') replacements += 1;
    }
    return replacements / text.length;
};

const decodeText = (data, encoding) => {
    try {
        return new TextDecoder(encoding).decode(data);
    } catch (_) {
        return null;
    }
};

const decodeWithStrategy = (data) => {
    const bomEncoding = detectEncodingFromBom(data);
    if (bomEncoding) {
        const decoded = decodeText(data, bomEncoding);
        if (decoded != null) return decoded;
    }
    if (estimateNullRatio(data) > 0.1) {
        const utf16Text = decodeText(data, 'utf-16le');
        if (utf16Text) return utf16Text;
    }
    const utf8Text = decodeText(data, 'utf-8');
    if (utf8Text && estimateReplacementRatio(utf8Text) < 0.02) return utf8Text;
    const gbText = decodeText(data, 'gb18030');
    if (gbText) return gbText;
    return utf8Text;
};

const parseExcel = ({ buffer, filename, labels }) => {
    const data = new Uint8Array(buffer);
    const extension = filename?.split('.').pop()?.toLowerCase();
    if (extension === 'csv') {
        try {
            return convertWorkbookToMarkdown(self.XLSX.read(data, { type: 'array', codepage: 65001 }), labels);
        } catch (_) { }
        try {
            return convertWorkbookToMarkdown(self.XLSX.read(data, { type: 'array', codepage: 936 }), labels);
        } catch (_) { }
        const decodedText = decodeWithStrategy(data);
        if (!decodedText) throw new Error('Unrecognized file encoding.');
        return convertWorkbookToMarkdown(self.XLSX.read(decodedText, { type: 'string' }), labels);
    }
    try {
        return convertWorkbookToMarkdown(self.XLSX.read(data, { type: 'array' }), labels);
    } catch (_) { }
    const decodedContent = decodeWithStrategy(data);
    if (!decodedContent) throw new Error('Unrecognized file encoding.');
    return convertWorkbookToMarkdown(self.XLSX.read(decodedContent, { type: 'string' }), labels);
};

self.onmessage = async (event) => {
    const { id, buffer, filename, labels = {} } = event.data || {};
    try {
        let lastProgress = 0;
        const onProgress = () => {
            if (Date.now() - lastProgress < 250) return;
            lastProgress = Date.now();
            self.postMessage({ id, type: 'progress' });
        };
        const text = parseExcel({ buffer, filename, labels: { ...labels, onProgress } });
        self.postMessage({ id, ok: true, text });
    } catch (error) {
        self.postMessage({ id, ok: false, error: error?.message || String(error) });
    }
};
