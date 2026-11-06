import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

// Exercise the actual CodeMirror handlers with an in-memory editor state.
const source = await readFile('src/main.ts', 'utf8');
const bundle = await build({
    stdin: {
        contents: source + '\nexport { EditorState, smartSpacePlugin, smartEnterPlugin, handleIndent, autoFormatVisibleRanges, createHotkeyCleanup, isLineInFencedCode, PREFIX_REGEX, SPACE_REGEX, parseTokens, buildPrefixString, isRollbackNeeded, toChinese, fromChinese };',
        sourcefile: 'main.ts', resolveDir: path.resolve('src'), loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    plugins: [{
        name: 'mock-obsidian', setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
            builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
                contents: 'export class Plugin {} export class PluginSettingTab {} export class Setting {} export class MarkdownRenderChild {} export class Notice {}', loader: 'js'
            }));
        }
    }]
});
const { EditorState, smartSpacePlugin, smartEnterPlugin, handleIndent, autoFormatVisibleRanges, createHotkeyCleanup, isLineInFencedCode, PREFIX_REGEX, SPACE_REGEX, parseTokens, buildPrefixString, isRollbackNeeded, toChinese, fromChinese } =
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

function editor(doc, cursor = doc.length) {
    return {
        state: EditorState.create({ doc, selection: { anchor: cursor } }),
        get visibleRanges() { return [{ from: 0, to: this.state.doc.length }]; },
        dispatch(spec) { this.state = this.state.update(spec).state; }
    };
}
const space = view => smartSpacePlugin.inner.value[0].run(view);
const enter = view => smartEnterPlugin.inner.value[0].run(view);
const text = view => view.state.doc.toString();

test('manual cross-nest triggers keep their intended single-slot prefix after Space and refresh', () => {
    for (const [before, expected] of [
        ['a. 1\n\t1.', 'a. 1\n\t1. '],
        ['A. 1\n\ta.', 'A. 1\n\ta. '],
        ['a. 1\n\ta.a 2\n\t\t(1)', 'a. 1\n\ta.a 2\n\t\t(1) ']
    ]) {
        const view = editor(before);
        assert.equal(space(view), true);
        assert.equal(text(view), expected);
        autoFormatVisibleRanges(view);
        assert.equal(text(view), expected);
    }
});

test('Space preserves a checked marker, existing body text, and cursor position', () => {
    for (const quote of ['', '> ']) {
        const before = `${quote}a. parent\n${quote}\t- [x] 1.child`;
        const cursor = before.indexOf('child');
        const view = editor(before, cursor);
        assert.equal(space(view), true);
        assert.equal(text(view), `${quote}a. parent\n${quote}\t- [x] 1. child`);
        assert.equal(view.state.selection.main.head, text(view).indexOf('child'));
        autoFormatVisibleRanges(view);
        assert.equal(text(view), `${quote}a. parent\n${quote}\t- [x] 1. child`);
    }
});

test('documented cross-nest inheritance remains available for multi-slot and lower-to-upper inputs', () => {
    for (const [before, expected] of [
        ['a. 1\n\tA.', 'a. 1\n\ta.A '],
        ['a. 1\n\tA.A', 'a. 1\n\ta.A '],
        ['a. 1\n\ta.1 2\n\t\tA.', 'a. 1\n\ta.1 2\n\t\ta.1.A ']
    ]) {
        const view = editor(before);
        assert.equal(space(view), true);
        assert.equal(text(view), expected);
    }
});

test('Tab keeps the documented parenthesized and Chinese fallback', () => {
    for (const [before, expected] of [
        ['(1) 1\n(2) 2', '(1) 1\n\t- 2'],
        ['一、 1\n二、 2', '一、 1\n\t- 2'],
        ['1. parent\n(1) child', '1. parent\n\t- child'],
        ['1. parent\n一、 child', '1. parent\n\t- child']
    ]) {
        const view = editor(before);
        assert.equal(handleIndent(view, 1), true);
        assert.equal(text(view), expected);
    }
});

test('Space initializes a nested quoted prefix without changing the quote container', () => {
    const view = editor('> 1. [ ] a\n> 2. [ ] b\n> \t1.');
    assert.equal(space(view), true);
    assert.equal(text(view), '> 1. [ ] a\n> 2. [ ] b\n> \t2.1 ');
});

test('Enter continues a quoted list inside the same quote', () => {
    const view = editor('> 1. first');
    assert.equal(enter(view), true);
    assert.equal(text(view), '> 1. first\n> 2. ');
});

test('same-element zero prefixes are recognized and mixed zero falls back', () => {
    for (const prefix of ['0.', '2.0', '0.1', '1.0.1', '0.0.0.0', '10.', '1.10']) {
        assert.equal(SPACE_REGEX.test(prefix), true, prefix);
        assert.equal(PREFIX_REGEX.test(prefix + ' body'), true, prefix);
    }
    for (const prefix of ['A.0', '0.A', '1.0.A']) {
        assert.equal(SPACE_REGEX.test(prefix), true, prefix);
        const view = editor(prefix);
        assert.equal(space(view), true, prefix);
        assert.equal(text(view), '- ', prefix);
    }
    for (const prefix of ['(0)', '01.', '1.02', '1.2.', 'I.e.']) {
        assert.equal(SPACE_REGEX.test(prefix), false, prefix);
        assert.equal(PREFIX_REGEX.test(prefix + ' body'), false, prefix);
    }
});

test('manual zero survives activation and refresh while the normal initial value remains one', () => {
    for (const quote of ['', '> ']) {
        const initial = `${quote}1. a\n${quote}2. b\n${quote}\t2.0`;
        const view = editor(initial);
        assert.equal(space(view), true);
        assert.equal(text(view), initial + ' ');
        view.dispatch({ changes: { from: view.state.doc.length, insert: 'c' }, selection: { anchor: view.state.doc.length + 1 } });
        autoFormatVisibleRanges(view);
        assert.equal(text(view), initial + ' c');
        assert.equal(enter(view), true);
        assert.equal(text(view), initial + ` c\n${quote}\t2.1 `);
    }
    const root = editor('0.');
    assert.equal(space(root), true);
    assert.equal(text(root), '0. ');
    const normal = editor('1. parent\n2. child');
    assert.equal(handleIndent(normal, 1), true);
    assert.equal(text(normal), '1. parent\n\t1.1 child');
    const zeroOnIndent = editor('1. parent\n0. child');
    assert.equal(handleIndent(zeroOnIndent, 1), true);
    assert.equal(text(zeroOnIndent), '1. parent\n\t1.1 child');
});

test('a zero introduced in a parent is inherited by a same-element child', () => {
    const view = editor('1. root\n\t1.0 parent\n\t\t1.1');
    assert.equal(space(view), true);
    assert.equal(text(view), '1. root\n\t1.0 parent\n\t\t1.0.1 ');
    autoFormatVisibleRanges(view);
    assert.equal(text(view), '1. root\n\t1.0 parent\n\t\t1.0.1 ');
    const rootZero = editor('0. root\n\t1.');
    assert.equal(space(rootZero), true);
    assert.equal(text(rootZero), '0. root\n\t0.1 ');
});

test('zero inherited by a mixed child falls back to a bullet', () => {
    const manual = editor('0. parent\n\tA.A');
    assert.equal(space(manual), true);
    assert.equal(text(manual), '0. parent\n\t- ');
    const indent = editor('0. parent\nA. child');
    assert.equal(handleIndent(indent, 1), true);
    assert.equal(text(indent), '0. parent\n\t- child');
});

test('manual zero still obeys the existing same-level continuation rule', () => {
    const view = editor('1. root\n\t1.1 first\n\t1.0');
    assert.equal(space(view), true);
    assert.equal(text(view), '1. root\n\t1.1 first\n\t1.2 ');
});

test('ordered values at the supported boundaries continue or fall back', () => {
    for (const [input, expected] of [
        ['y. 25', 'y. 25\nz. '],
        ['z. 26', 'z. 26\n- '],
        ['Z. 26', 'Z. 26\n- '],
        ['\t1.z nested', '\t1.z nested\n\t- '],
        ['> \tA.Z quoted', '> \tA.Z quoted\n> \t- '],
        ['九十九、 99', '九十九、 99\n一百、 '],
        ['一百、 100', '一百、 100\n- '],
        ['9007199254740991. max', '9007199254740991. max\n- '],
        ['(9007199254740991) max', '(9007199254740991) max\n- '],
        ['9. 9', '9. 9\n10. ']
    ]) {
        const view = editor(input);
        assert.equal(enter(view), true, input);
        assert.equal(text(view), expected, input);
    }
});

test('out-of-range elements are rejected regardless of slot', () => {
    for (const tokens of [
        [{ type: 'lower', value: 27 }],
        [{ type: 'upper', value: 27 }, { type: 'number', value: 1 }],
        [{ type: 'number', value: 1 }, { type: 'lower', value: 27 }, { type: 'number', value: 1 }],
        [{ type: 'number', value: Number.MAX_SAFE_INTEGER + 1 }, { type: 'number', value: 1 }],
        [{ type: 'number', value: 0 }, { type: 'upper', value: 1 }],
        [{ type: 'chinese', value: 101 }]
    ]) assert.equal(isRollbackNeeded(tokens), true, JSON.stringify(tokens));
    assert.equal(isRollbackNeeded([{ type: 'number', value: 0 }, { type: 'number', value: 1 }]), false);
});

test('one hundred is a valid Chinese prefix and autoformat falls back after z', () => {
    for (let value = 1; value <= 100; value++) {
        assert.equal(fromChinese(toChinese(value)), value, String(value));
    }
    assert.equal(SPACE_REGEX.test('一百、'), true);
    assert.equal(buildPrefixString(parseTokens('一百、'), '一百、'), '一百、');
    const alphabet = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(97 + i)}. ${i + 1}`).join('\n');
    const view = editor(`${alphabet}\na. 27`);
    autoFormatVisibleRanges(view);
    assert.equal(text(view), `${alphabet}\n- 27`);
});

test('manually typed unsafe numeric elements fall back without losing nesting or content', () => {
    for (const [input, expected] of [
        ['9007199254740992.', '- '],
        ['> \t1.9007199254740992', '> \t- '],
        ['(9007199254740992)', '- ']
    ]) {
        const view = editor(input);
        assert.equal(space(view), true, input);
        assert.equal(text(view), expected, input);
    }
    const view = editor('1. parent\n\t1.9007199254740992 body');
    autoFormatVisibleRanges(view);
    assert.equal(text(view), '1. parent\n\t- body');
});

test('manually typed out-of-range Chinese numerals fall back', () => {
    for (const input of ['一百零一、', '二百、', '一千、', '一万、', '一亿、', '零、']) {
        const view = editor(input);
        assert.equal(space(view), true, input);
        assert.equal(text(view), '- ', input);
    }
    assert.deepEqual([parseTokens('九十九、')[0].value, parseTokens('一百、')[0].value], [99, 100]);
});

test('dependent and independent callouts have different external continuation', () => {
    const dependent = editor('1. a\n> [!NOTE] title\n> b\n\n2. c');
    autoFormatVisibleRanges(dependent);
    assert.equal(text(dependent), '1. a\n> [!NOTE] title\n> b\n\n2. c');

    const independent = editor('1. a\n\n> [!NOTE] title\n> b\n\n1. c');
    autoFormatVisibleRanges(independent);
    assert.equal(text(independent), '1. a\n\n> [!NOTE] title\n> b\n\n1. c');
});

test('quoted fenced code stays untouched when formatting nearby lists', () => {
    for (const input of [
        '> ```\n> 9. code\n> ```\n> 1. item',
        '```\n> 9. code\n```\n1. item',
        '> ```\n> > 9. code\n> ```\n> 1. item'
    ]) {
        const view = editor(input);
        autoFormatVisibleRanges(view);
        assert.equal(text(view), input);
    }
});

test('quote-looking text in indented code is not treated as a blockquote', () => {
    const input = '    > 9. literal\n    > 15. also literal';
    const view = editor(input);
    autoFormatVisibleRanges(view);
    assert.equal(text(view), input);
});

test('autoformat initializes nested quoted lists and keeps the outer list separate', () => {
    for (const header of ['', '> [!NOTE] title\n']) {
        const input = `1. outside\n${header}> 1. [ ] a\n> 2. [ ] b\n> \t1. [ ] c\n> \t\t1. [ ] d\n> 3. [ ] e\n2. outside`;
        const expected = `1. outside\n${header}> 1. [ ] a\n> 2. [ ] b\n> \t2.1 [ ] c\n> \t\t2.1.1 [ ] d\n> 3. [ ] e\n2. outside`;
        const view = editor(input);
        autoFormatVisibleRanges(view);
        assert.equal(text(view), expected);
    }
});

test('autoformat keeps quoted task markers and outer continuation', () => {
    const input = '1. outside\n> - [ ] 1. a\n> - [ ] 2. b\n> \t- [ ] 1. c\n> \t\t- [ ] 1. d\n> - [ ] 3. e\n2. outside';
    const expected = '1. outside\n> - [ ] 1. a\n> - [ ] 2. b\n> \t- [ ] 2.1 c\n> \t\t- [ ] 2.1.1 d\n> - [ ] 3. e\n2. outside';
    const view = editor(input);
    autoFormatVisibleRanges(view);
    assert.equal(text(view), expected);
});

test('Tab indents a quoted list inside its quote and retains its content', () => {
    const view = editor('> 1. parent\n> 2. child');
    assert.equal(handleIndent(view, 1), true);
    assert.equal(text(view), '> 1. parent\n> \t1.1 child');
});

test('outer and quoted code fences protect apparent inner quote markers', () => {
    for (const input of [
        '```\n> 9. literal\n```\n1. list',
        '> ```\n> > 9. literal\n> ```\n> 1. list'
    ]) {
        const view = editor(input);
        autoFormatVisibleRanges(view);
        assert.equal(text(view), input);
    }
});

test('Enter on an empty quoted root list keeps the quote marker', () => {
    const view = editor('> 1. ');
    assert.equal(enter(view), true);
    assert.equal(text(view), '> ');
});

// Model the precise prefix replacement produced by Obsidian's built-in list
// commands; the implementation still needs testing with the live application.
function nativeListCommand(doc, lineNumbers, marker, userEvent) {
    const first = doc.split('\n').slice(0, lineNumbers[0] - 1).join('\n').length + (lineNumbers[0] > 1 ? 1 : 0);
    const last = doc.split('\n').slice(0, lineNumbers.at(-1)).join('\n').length;
    const state = EditorState.create({ doc, selection: { anchor: first, head: last },
        extensions: [createHotkeyCleanup(isLineInFencedCode)] });
    const changes = lineNumbers.map(number => {
        const line = state.doc.line(number);
        const match = line.text.match(/^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/);
        return { from: line.from, to: line.from + match[0].length, insert: match[1] + marker };
    });
    return state.update({ changes, userEvent }).state.doc.toString();
}

test('native numbered and bullet commands remove the old custom prefix', () => {
    for (const [input, marker, expected] of [
        ['1. a\n\t1.1 b', '1. ', '1. a\n\tb'],
        ['1. a\n\t1.0 b', '1. ', '1. a\n\tb'],
        ['a. A\nb. B', '1. ', 'a. A\n1. B'],
        ['a. 1\nb. 2', '- ', 'a. 1\n- 2'],
        ['a.A text', '1. ', 'a.1 text'],
        ['(1) text', '1. ', '1. text'],
        ['一、 text', '- ', '- text'],
        ['- [x] 1.1 task', '1. ', '1. task'],
        ['> \t1.1 quoted', '- ', '> \t- quoted']
    ]) {
        const line = input.split('\n').length;
        assert.equal(nativeListCommand(input, [line], marker), expected, input);
    }
});

test('hotkey cleanup handles multiple selected lines and preserves unrelated transactions', () => {
    assert.equal(nativeListCommand('a. A\nb. B', [1, 2], '- '), '- A\n- B');
    assert.equal(nativeListCommand('b. body', [1], '- ', 'input.type'), '- b. body');
    assert.equal(nativeListCommand('b. body', [1], '- ', 'input.paste'), '- b. body');
    assert.equal(nativeListCommand('b. body', [1], '- ', 'undo'), '- b. body');
    assert.equal(nativeListCommand('```\na. code\n```', [2], '- '), '```\n- a. code\n```');
    assert.equal(nativeListCommand('a. body', [1], '- [ ] '), '- [ ] a. body');
    assert.equal(nativeListCommand('b. body', [1], '1. ', 'input.renumber'), '1. body');
    assert.equal(nativeListCommand('b. body', [1], '3. ', 'input.renumber'), '3. body');
    assert.equal(nativeListCommand('b. body', [1], '- ', 'input.renumber'), '- b. body');
});

test('numbered cleanup preserves native renumbering of surrounding lines', () => {
    const state = EditorState.create({ doc: 'a. A\n1. B', selection: { anchor: 3 },
        extensions: [createHotkeyCleanup(isLineInFencedCode)] });
    const result = state.update({ changes: [{ from: 0, insert: '1. ' }, { from: 5, to: 8, insert: '2. ' }],
        userEvent: 'input.renumber' }).state;
    assert.equal(result.doc.toString(), '1. A\n2. B');
});
