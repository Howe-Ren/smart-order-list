import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
    entryPoints: ['src/reading-alignment.ts'], bundle: true, format: 'esm',
    platform: 'node', write: false, logLevel: 'silent'
});
const source = Buffer.from(bundle.outputFiles[0].contents).toString('base64');
const { calculateDynamicNestDistances, distanceForSlots, leadingHeaderCharacterIndex } = await import(`data:text/javascript;base64,${source}`);
const settingsBundle = await build({
    entryPoints: ['src/settings.ts'], bundle: true, format: 'esm',
    platform: 'node', write: false, logLevel: 'silent'
});
const settingsSource = Buffer.from(settingsBundle.outputFiles[0].contents).toString('base64');
const { normalizeSettings } = await import(`data:text/javascript;base64,${settingsSource}`);

test('dynamic parent distance follows the documented slot formula', () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(distanceForSlots), [2, 2, 4.3, 5.6, 6.9]);
});

test('the leading digit is selected inside parentheses and at the start of other prefixes', () => {
    assert.equal(leadingHeaderCharacterIndex('(12)'), 1);
    assert.equal(leadingHeaderCharacterIndex('12.3'), 0);
    assert.equal(leadingHeaderCharacterIndex('a.A'), 0);
    assert.equal(leadingHeaderCharacterIndex('一、'), 0);
});

test('a selected profile survives loading and invalid settings fall back to Profile 1', () => {
    assert.equal(normalizeSettings({ indentationProfile: 'profile2' }).indentationProfile, 'profile2');
    assert.equal(normalizeSettings({ indentationProfile: 'other' }).indentationProfile, 'profile1');
    assert.equal(normalizeSettings(null).indentationProfile, 'profile1');
});

test('parallel nests share a maximum within their own root and depth', () => {
    const lines = new Map([
        [0, { depth: 1, slotCount: 1 }],
        [1, { depth: 2, slotCount: 0 }],
        [2, { depth: 3, slotCount: 1 }],
        [3, { depth: 4, slotCount: 2 }],
        [4, { depth: 2, slotCount: 2 }],
        [5, { depth: 3, slotCount: 3 }],
        [6, { depth: 4, slotCount: 4 }],
        [7, { depth: 1, slotCount: 1 }],
        [8, { depth: 2, slotCount: 0 }],
        [9, { depth: 3, slotCount: 1 }]
    ]);
    const parents = new Map([[1, 0], [2, 1], [3, 2], [4, 0], [5, 4], [6, 5], [8, 7], [9, 8]]);
    const distances = calculateDynamicNestDistances(lines, parents);

    assert.deepEqual([1, 4].map(line => distances.get(line)), [2, 2]);
    assert.deepEqual([2, 5].map(line => distances.get(line)), [4.3, 4.3]);
    assert.deepEqual([3, 6].map(line => distances.get(line)), [5.6, 5.6]);
    assert.deepEqual([8, 9].map(line => distances.get(line)), [2, 2]);
});
