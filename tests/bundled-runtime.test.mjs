import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { protectMarkdownMathPlaceholders } from '../src/mathrender/markdown-math-protection.js';
import { MathRenderer, KATEX_CONFIG } from '../src/mathrender/math-renderer.js';

function loadCommonJsBundle(filename) {
    const module = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports, console });
    vm.runInContext(readFileSync(new URL('../public/libs/' + filename, import.meta.url), 'utf8'), context);
    return module.exports;
}

test('bundled Markdown and KaTeX preserve code while accepting the normalized formula', () => {
    const marked = loadCommonJsBundle('marked.min.js');
    const katex = loadCommonJsBundle('katex.min.js');
    const renderer = new MathRenderer(KATEX_CONFIG);
    const source = '公式 $x_1^2$\n\n```js\nconst cost = "$10$";\n```';
    const protection = protectMarkdownMathPlaceholders(renderer.preprocessMarkdown(source), {
        normalizeMath: value => renderer.normalizeDelimited(value),
        displayTokenPrefix: '%%DISPLAY_MATH_',
        inlineTokenPrefix: '%%INLINE_MATH_'
    });
    const html = protection.restore(marked.parse(protection.text));
    assert.ok(html.includes('$x_{1}^{2}$'));
    assert.ok(html.includes('$10$'));
    assert.ok(html.includes('<code class="language-js">'));
    const formula = protection.inlineMath[0].slice(1, -1);
    assert.ok(katex.renderToString(formula, { throwOnError: true }).includes('katex'));
});

function createSpreadsheetWorker() {
    const replies = [];
    const context = vm.createContext({ console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout });
    context.self = context;
    context.postMessage = value => replies.push(value);
    context.importScripts = url => {
        assert.equal(url, '/libs/xlsx.full.min.js');
        vm.runInContext(readFileSync(new URL('../public' + url, import.meta.url), 'utf8'), context);
    };
    vm.runInContext(readFileSync(new URL('../src/worker-parsers/excel-parser-worker.js', import.meta.url), 'utf8'), context);
    return { context, replies };
}

test('actual spreadsheet Worker source parses UTF-8 CSV with Chinese text', async () => {
    const { context, replies } = createSpreadsheetWorker();
    await context.onmessage({ data: {
        id: 'csv', filename: 'sample.csv',
        buffer: new TextEncoder().encode('姓名,成绩\n小明,95').buffer,
        labels: { worksheet: '工作表' }
    } });
    const result = replies.find(reply => reply.ok !== undefined);
    assert.equal(result.ok, true, result.error);
    assert.ok(result.text.includes('| 姓名 | 成绩 |'));
    assert.ok(result.text.includes('| 小明 | 95 |'));
    assert.ok(replies.some(reply => reply.type === 'progress'));
});

test('actual spreadsheet Worker source reads generated XLSX and honors the column cap', async () => {
    const { context, replies } = createSpreadsheetWorker();
    const buffer = vm.runInContext(`
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook,
            XLSX.utils.aoa_to_sheet([['名称', '数值', '额外列'], ['例子', 42, '不显示']]), '测试页');
        XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    `, context);
    await context.onmessage({ data: { id: 'xlsx', filename: 'sample.xlsx', buffer, labels: { maxColumns: 2 } } });
    const result = replies.find(reply => reply.ok !== undefined);
    assert.equal(result.ok, true, result.error);
    assert.ok(result.text.includes('测试页'));
    assert.ok(result.text.includes('| 例子 | 42 |'));
    assert.equal(result.text.includes('额外列'), false);
    assert.equal(result.text.includes('不显示'), false);
});
