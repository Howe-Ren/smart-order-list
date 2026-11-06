import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const browser = [
    process.env.SMART_ORDER_TEST_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome'
].filter(Boolean).find(candidate => existsSync(candidate));

test('Reading copy replaces only complete, plain and contiguous source lines', { skip: !browser }, async () => {
    const bundle = await build({
        entryPoints: ['src/reading-copy.ts'], bundle: true, format: 'iife',
        globalName: 'ReadingCopy', platform: 'browser', write: false, logLevel: 'silent'
    });
    const fixture = String.raw`
        const results = [];
        function check(name, condition) { results.push({ name, ok: Boolean(condition) }); }
        const section = document.createElement('div');
        section.innerHTML = '<ol>' +
            '<li class="smart-list-native-override-reading" data-line="0"><span class="smart-list-prefix">1. </span>a' +
            '<ol><li class="smart-list-custom-reading" data-line="1"><span class="smart-list-prefix">1.1 </span>b</li></ol></li>' +
            '<li class="smart-list-native-override-reading" data-line="2"><span class="smart-list-prefix">2. </span>c' +
            '<ol><li class="smart-list-custom-reading" data-line="3"><span class="smart-list-prefix">2.1 </span>d</li></ol></li>' +
            '</ol>';
        document.body.appendChild(section);
        const info = { text: '# Heading\n\n1. a\n    1.1 b\n2. c\n    2.1 d', lineStart: 2, lineEnd: 5 };
        const eligible = new Set([2, 3, 4, 5]);
        const selection = window.getSelection();
        const items = section.querySelectorAll('li');
        const textOf = item => Array.from(item.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        function select(fromNode, fromOffset, toNode, toOffset) {
            const range = document.createRange();
            range.setStart(fromNode, fromOffset);
            range.setEnd(toNode, toOffset);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        function evaluate() { return ReadingCopy.getReadingSelectionMarkdown(section, selection, info, eligible); }
        try {
            const firstPrefix = items[0].querySelector('.smart-list-prefix').firstChild;
            const lastBody = textOf(items[3]);
            select(firstPrefix, 0, lastBody, lastBody.length);
            check('full selection returns exact original Markdown', evaluate() === '1. a\n    1.1 b\n2. c\n    2.1 d');

            const childPrefix = items[1].querySelector('.smart-list-prefix').firstChild;
            const childBody = textOf(items[1]);
            select(childPrefix, 0, childBody, childBody.length);
            check('one complete nested item returns only that source line', evaluate() === '    1.1 b');

            select(childPrefix, 1, childBody, childBody.length);
            check('partial prefix does not intercept', evaluate() === null);
            select(childBody, 0, childBody, childBody.length);
            check('body-only selection does not intercept', evaluate() === null);

            const heading = document.createElement('p');
            heading.textContent = 'outside';
            section.prepend(heading);
            select(heading.firstChild, 0, lastBody, lastBody.length);
            check('mixed paragraph and list selection does not intercept', evaluate() === null);

            const external = document.createElement('p');
            external.textContent = 'other section';
            document.body.appendChild(external);
            select(firstPrefix, 0, external.firstChild, external.firstChild.length);
            check('cross-section selection does not intercept', evaluate() === null);

            const rich = document.createElement('strong');
            rich.textContent = 'b';
            childBody.replaceWith(rich);
            select(childPrefix, 0, rich.firstChild, rich.firstChild.length);
            check('formatted item does not intercept', evaluate() === null);
            rich.replaceWith(childBody);

            const image = document.createElement('img');
            section.insertBefore(image, section.querySelector('ol'));
            select(section, Array.from(section.childNodes).indexOf(image), lastBody, lastBody.length);
            check('selected image outside the list does not intercept', evaluate() === null);
            image.remove();

            const styled = document.createElement('span');
            styled.className = 'other-plugin-formatting';
            styled.textContent = 'b';
            childBody.replaceWith(styled);
            select(childPrefix, 0, styled.firstChild, styled.firstChild.length);
            check('other styled content does not intercept', evaluate() === null);
            styled.replaceWith(childBody);

            const second = items[2];
            second.setAttribute('data-line', '7');
            select(firstPrefix, 0, lastBody, lastBody.length);
            check('unknown or noncontiguous source lines do not intercept', evaluate() === null);
            second.setAttribute('data-line', '2');

            let current = info;
            let listenerCount = 0;
            const tracker = ReadingCopy.createReadingCopyTracker((doc, callback) => {
                listenerCount++;
                doc.addEventListener('copy', callback, true);
            });
            tracker.track(section, info, eligible, () => current);
            tracker.track(section, info, eligible, () => current);
            check('one listener is registered per document', listenerCount === 1);
            select(firstPrefix, 0, lastBody, lastBody.length);
            const clipboard = new DataTransfer();
            clipboard.setData('text/html', '<p>old</p>');
            const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard });
            document.dispatchEvent(event);
            check('safe copy writes only the exact plain Markdown', event.defaultPrevented && clipboard.getData('text/plain') === '1. a\n    1.1 b\n2. c\n    2.1 d' && !clipboard.getData('text/html'));

            current = { ...info, text: info.text + '\nchanged' };
            const stale = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
            document.dispatchEvent(stale);
            check('stale source snapshot does not intercept', !stale.defaultPrevented);
        } catch (error) {
            results.push({ name: String(error.stack || error), ok: false });
        }
        document.body.dataset.fixtureResult = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
    `;

    const tempRoot = realpathSync(os.tmpdir());
    const tempDir = realpathSync(mkdtempSync(path.join(tempRoot, 'smart-order-copy-')));
    try {
        const htmlPath = path.join(tempDir, 'fixture.html');
        writeFileSync(htmlPath, `<!doctype html><html><body><script>${bundle.outputFiles[0].text}</script><script>${fixture}</script></body></html>`);
        const output = execFileSync(browser, [
            '--headless=new', '--disable-gpu', '--no-sandbox',
            `--user-data-dir=${path.join(tempDir, 'profile')}`,
            '--dump-dom', pathToFileURL(htmlPath).href
        ], { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const encoded = output.match(/data-fixture-result="([^"]+)"/)?.[1];
        assert.ok(encoded, `Fixture did not return results: ${output.slice(0, 500)}`);
        const results = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        assert.deepEqual(results.filter(result => !result.ok), [], JSON.stringify(results, null, 2));
    } finally {
        if (path.dirname(tempDir) === tempRoot && path.basename(tempDir).startsWith('smart-order-copy-')) {
            rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    }
});
