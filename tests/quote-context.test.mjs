import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Compile the TypeScript helper in memory, so these tests work with Node 18+.
const source = await readFile(new URL('../src/quote-context.ts', import.meta.url), 'utf8');
const output = await transform(source, { loader: 'ts', format: 'esm' });
const { parseQuoteLine, isCalloutHeader, isIndependentCallout, QuoteContextStacks, consumeFence } =
    await import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);

test('quote splitting preserves the exact markers and relative list indentation', () => {
    assert.deepEqual(parseQuoteLine('> \t1. [ ] child'), {
        quotePrefix: '> ', content: '\t1. [ ] child', depth: 1,
    });
    assert.deepEqual(parseQuoteLine('>     1.1 child'), {
        quotePrefix: '> ', content: '    1.1 child', depth: 1,
    });
    assert.deepEqual(parseQuoteLine(' >  > 2. child'), {
        quotePrefix: ' >  > ', content: '2. child', depth: 2,
    });
    assert.deepEqual(parseQuoteLine('>1. child'), {
        quotePrefix: '>', content: '1. child', depth: 1,
    });
    assert.deepEqual(parseQuoteLine('\t1. ordinary'), {
        quotePrefix: '', content: '\t1. ordinary', depth: 0,
    });
    assert.deepEqual(parseQuoteLine('    > 9. code'), {
        quotePrefix: '', content: '    > 9. code', depth: 0,
    });
    assert.deepEqual(parseQuoteLine('\t> 9. code'), {
        quotePrefix: '', content: '\t> 9. code', depth: 0,
    });
});

test('independent callouts depend on the preceding physical line', () => {
    assert.equal(isCalloutHeader('> [!NOTE] Title'), true);
    assert.equal(isCalloutHeader('> plain quote'), false);
    assert.equal(isIndependentCallout('> [!NOTE] Title', '1. a'), false);
    assert.equal(isIndependentCallout('> [!NOTE] Title', ''), true);
    assert.equal(isIndependentCallout('> [!NOTE] Title', '  '), true);
    assert.equal(isIndependentCallout('> [!NOTE] Title'), true);
    assert.equal(isIndependentCallout('> plain quote', ''), false);
});

test('quote contexts preserve the outer list while resetting exited quotes', () => {
    const scopes = new QuoteContextStacks(() => []);
    scopes.select(0).push('outer');
    scopes.select(1).push('quote');
    scopes.select(2).push('nested');
    assert.deepEqual(scopes.select(1), ['quote']);
    assert.deepEqual(scopes.select(2), []);
    assert.deepEqual(scopes.select(0), ['outer']);
    assert.deepEqual(scopes.select(1), []);
    scopes.select(1).push('old callout');
    assert.deepEqual(scopes.reset(1), []);
    assert.deepEqual(scopes.select(0), ['outer']);
});

test('quote-stripped fences protect their contents and require a matching close', () => {
    let state = null;
    const consume = (line) => {
        const result = consumeFence(parseQuoteLine(line).content, state);
        state = result.fence;
        return result.inCode;
    };
    assert.equal(consume('> ````ts'), true);
    assert.equal(consume('> 1. raw code'), true);
    assert.equal(consume('> ```'), true); // too short to close
    assert.equal(consume('> ````'), true);
    assert.equal(consume('> 1. list'), false);
    assert.deepEqual(consumeFence('    ```', null), { fence: null, inCode: false });
    assert.deepEqual(consumeFence('```bad`info', null), { fence: null, inCode: false });
    const opened = consumeFence('~~~', null);
    assert.equal(consumeFence('```', opened.fence).inCode, true);
    assert.equal(consumeFence('~~~~', opened.fence).fence, null);
});
