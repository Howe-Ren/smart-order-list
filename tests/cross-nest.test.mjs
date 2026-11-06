import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Bundle the TypeScript module in memory so the tests work on Node 18+.
const bundle = await build({
    entryPoints: ['src/cross-nest.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent'
});
const source = Buffer.from(bundle.outputFiles[0].contents).toString('base64');
const { decideCrossNest } = await import(`data:text/javascript;base64,${source}`);
const tokens = (...types) => types.map(type => ({ type }));

test('manual single-slot triggers follow the documented single-slot Base matrix', () => {
    const types = ['number', 'paren', 'upper', 'lower', 'chinese'];
    const results = {
        number:  ['inherit',   'overwrite', 'overwrite', 'overwrite', 'overwrite'],
        paren:   ['overwrite', 'overwrite', 'overwrite', 'overwrite', 'overwrite'],
        upper:   ['overwrite', 'overwrite', 'inherit',   'overwrite', 'overwrite'],
        lower:   ['overwrite', 'overwrite', 'inherit',   'inherit',   'overwrite'],
        chinese: ['overwrite', 'overwrite', 'overwrite', 'overwrite', 'overwrite']
    };
    for (const base of types) {
        for (const [index, trigger] of types.entries()) {
            assert.equal(decideCrossNest(tokens(base), tokens(trigger)), results[base][index], `${base} / ${trigger}`);
        }
    }
});

test('multi-slot Base or Trigger preserves valid ancestry and rejects non-mixable last slot', () => {
    assert.equal(decideCrossNest(tokens('lower', 'lower'), tokens('paren')), 'overwrite'); // Case_3-9
    assert.equal(decideCrossNest(tokens('lower', 'number'), tokens('upper')), 'inherit'); // Case_4-5
    assert.equal(decideCrossNest(tokens('lower'), tokens('upper', 'upper')), 'inherit'); // Case_4-4
    assert.equal(decideCrossNest(tokens('number', 'number', 'number', 'number'), tokens('number')), 'inherit');
});

test('explicit Tab nesting keeps the existing slot-exceeding fallback path', () => {
    assert.equal(decideCrossNest(tokens('paren'), tokens('paren'), true), 'inherit');
    assert.equal(decideCrossNest(tokens('chinese'), tokens('chinese'), true), 'inherit');
    assert.equal(decideCrossNest(tokens('number', 'number', 'number', 'number'), tokens('number'), true), 'inherit');
});
