import test from 'node:test';
import assert from 'node:assert/strict';
import { protectMarkdownMathPlaceholders } from '../src/mathrender/markdown-math-protection.js';
import { MathRenderer, KATEX_CONFIG } from '../src/mathrender/math-renderer.js';
import { normalizeMermaidSourceArtifacts, wrapStandaloneMermaidDefinition } from '../src/rendering/mermaid-source-normalizer.js';
import { normalizeMermaidColorFormats } from '../src/rendering/mermaid-color-normalizer.js';
import { runParseTask, runParserWorker } from '../src/file-parsers/parse-task.js';
import { createKeyboardFsm } from '../src/keyboard/drivers/browser/keyboard-fsm.js';
import { KEYBOARD_SOURCE } from '../src/keyboard/drivers/browser/keyboard-source.js';

test('formula protection preserves fenced/inline code and round-trips real formulas', () => {
    const input = '行内 $x_1$ 与 `price = $5$`\n\n```js\nconst math = "$$code$$";\n```\n\n$$a^2+b^2=c^2$$';
    const result = protectMarkdownMathPlaceholders(input);
    assert.equal(result.inlineMath.length, 1);
    assert.equal(result.displayMath.length, 1);
    assert.ok(result.text.includes('`price = $5$`'));
    assert.ok(result.text.includes('"$$code$$"'));
    assert.equal(result.restore(result.text), input);
});

test('math preprocessing leaves code examples intact', () => {
    const renderer = new MathRenderer(KATEX_CONFIG);
    const input = '```text\n\\frac{1}{2} and $literal$\n```';
    assert.equal(renderer.preprocessMarkdown(input), input);
    assert.equal(renderer.normalizeDelimited('$x_1$'), '$x_{1}$');
});

test('diagram artifact recovery preserves explicit subgraph IDs and ordinary syntax', () => {
    const original = 'flowchart TD\nsubgraph Auth["认证"]\nA --> B\nend';
    assert.equal(normalizeMermaidSourceArtifacts(original.replace('subgraph', 'subgroup')), original);
    assert.equal(normalizeMermaidSourceArtifacts(original), original);
    assert.equal(normalizeMermaidSourceArtifacts('subgroup is a variable name'), 'subgroup is a variable name');
});

test('standalone flowcharts are fenced without rewriting prose or existing code', () => {
    const diagram = 'flowchart TD\nA["开始"] --> B["结束"]';
    assert.equal(wrapStandaloneMermaidDefinition(diagram), '```mermaid\n' + diagram + '\n```');
    const fenced = '```mermaid\n' + diagram + '\n```';
    assert.equal(wrapStandaloneMermaidDefinition(fenced), fenced);
    assert.equal(wrapStandaloneMermaidDefinition('A description\nwith two lines'), 'A description\nwith two lines');
});

test('diagram color recovery accepts alpha colors without altering normal colors', () => {
    assert.equal(normalizeMermaidColorFormats('style A fill:#abcd,stroke:#123456;'),
        'style A fill:#aabbcc,stroke:#123456;');
});

test('stalled parsing rejects with a recognizable timeout', async () => {
    await assert.rejects(runParseTask(() => new Promise(() => {}), null, { timeoutMs: 5 }, 'stalled'),
        { code: 'FILE_PARSE_TIMEOUT', message: 'stalled' });
    assert.equal(await runParseTask(async () => 'parsed', null, { timeoutMs: 100 }), 'parsed');
});

test('parser Worker results release the Worker and keep the returned content', async () => {
    let terminated = false;
    const worker = {
        terminate() { terminated = true; },
        postMessage(message) {
            queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: true, text: '正文' } }));
        }
    };
    const result = await runParserWorker(new Blob(['sample']), () => worker, new AbortController().signal);
    assert.equal(result.text, '正文');
    assert.equal(terminated, true);
    assert.equal(worker.onmessage, null);
});

test('aborting an active parser releases the Worker and preserves the abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    let terminated = false;
    const worker = {
        terminate() { terminated = true; },
        postMessage() { queueMicrotask(() => controller.abort(reason)); }
    };
    await assert.rejects(runParserWorker(new Blob(['sample']), () => worker, controller.signal),
        error => error === reason);
    assert.equal(terminated, true);
});

test('keyboard detection ignores unfocused viewport changes and tolerates close jitter', () => {
    const fsm = createKeyboardFsm({ openThreshold: 80, closeThreshold: 40, closeConfirmMs: 500 });
    const sample = { keyboardSource: KEYBOARD_SOURCE.LAYOUT, keyboardFocused: false, insetBottom: 300, sampledAt: 0 };
    assert.equal(fsm.step(sample).transition, null);
    assert.equal(fsm.isOpen(), false);
    assert.equal(fsm.step({ ...sample, keyboardFocused: true }).transition, 'open');
    assert.equal(fsm.step({ ...sample, insetBottom: 0, sampledAt: 10 }).pendingClose, true);
    assert.equal(fsm.step({ ...sample, insetBottom: 300, sampledAt: 20 }).pendingClose, false);
    assert.equal(fsm.isOpen(), true);
    fsm.step({ ...sample, insetBottom: 0, sampledAt: 30 });
    assert.equal(fsm.step({ ...sample, insetBottom: 0, sampledAt: 530, reason: 'c' }).transition, 'close');
});
