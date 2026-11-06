import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { obsidianDomFixture } from './obsidian-dom-fixture.mjs';

// Exercise the actual registered postprocessor in a browser DOM. The fixture
// models Obsidian's rendered list markup; a real Obsidian test is still needed
// for clipboard conversion, themes, and task source persistence.
const candidates = [
    process.env.SMART_ORDER_TEST_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
].filter(Boolean);
const browser = candidates.find(candidate => existsSync(candidate));

test('Reading postprocessor retains parents, prefix spacing, and task markup', { skip: !browser }, async () => {
    const bundle = await build({
        entryPoints: ['src/main.ts'],
        bundle: true,
        format: 'iife',
        globalName: 'SmartOrderFixture',
        platform: 'browser',
        write: false,
        logLevel: 'silent',
        plugins: [{
            name: 'obsidian-test-stub',
            setup(plugin) {
                plugin.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
                plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                    contents: `
                        export class Plugin {
                            constructor() { this.app = {}; }
                            async loadData() { return { indentationProfile: 'profile1' }; }
                            async saveData() {}
                            register() {}
                            addSettingTab() {}
                            registerEditorExtension() {}
                            registerMarkdownPostProcessor(fn) { window.readingProcessor = fn; }
                            registerDomEvent(doc, name, fn, options) { doc.addEventListener(name, fn, options); }
                            addCommand() {}
                        }
                        export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
                        export class Setting {}
                        export class Notice {}
                        export class MarkdownRenderChild { constructor(element) { this.containerEl = element; } }
                        export class TFile {}
                    `,
                    loader: 'js'
                }));
            }
        }]
    });
    const alignmentBundle = await build({
        entryPoints: ['src/reading-alignment.ts'], bundle: true, format: 'iife',
        globalName: 'ReadingAlignmentFixture', platform: 'browser', write: false, logLevel: 'silent'
    });

    const fixture = String.raw`
        (async () => {
        const outcomes = [];
        const sectionObservers = [];
        window.ResizeObserver = class {
            constructor(callback) { this.callback = callback; }
            observe(target) { this.target = target; sectionObservers.push(this); }
            disconnect() { this.target = null; }
        };
        function verify(name, condition) {
            outcomes.push({ name, ok: Boolean(condition) });
        }
        function processFixture(markdown, start, end, html) {
            const container = document.createElement('div');
            container.className = 'markdown-rendered';
            container.innerHTML = html;
            document.body.appendChild(container);
            window.readingProcessor(container, {
                getSectionInfo: () => ({ text: markdown, lineStart: start, lineEnd: end }),
                addChild: child => child.onload()
            });
            return container;
        }
        try {
            await new SmartOrderFixture.default().onload();
        } catch (error) {
            outcomes.push({ name: 'plugin initialization: ' + String(error.stack || error), ok: false });
        }
        try {
            const ordered = processFixture(
                '# Heading\n\n1. a\n    1.1 b\n2. c\n    2.1 d', 2, 5,
                '<ol><li data-line="0">a<br>1.1 b</li><li data-line="2">c<br>2.1 d</li></ol>'
            );
            const roots = ordered.querySelectorAll(':scope > ol > li');
            const firstChild = roots[0].querySelector(':scope > ol > li');
            const secondChild = roots[1].querySelector(':scope > ol > li');
            verify('first child stays under first native parent', firstChild?.textContent === '1.1 b');
            verify('second child stays under second native parent', secondChild?.textContent === '2.1 d');
            verify('a native root has a copyable space after its prefix', roots[0].textContent.startsWith('1. a'));
            const firstPrefix = roots[0].querySelector(':scope > .smart-list-prefix').firstChild;
            const lastBody = secondChild.lastChild;
            const range = document.createRange();
            range.setStart(firstPrefix, 0);
            range.setEnd(lastBody, lastBody.textContent.length);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const clipboard = new DataTransfer();
            const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard });
            document.dispatchEvent(copyEvent);
            verify('integrated full-list copy uses exact source Markdown', copyEvent.defaultPrevented &&
                clipboard.getData('text/plain') === '1. a\n    1.1 b\n2. c\n    2.1 d');
        } catch (error) {
            outcomes.push({ name: 'ordered fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const frame = document.createElement('iframe');
            document.body.appendChild(frame);
            installObsidianDomHelpers(frame.contentWindow);
            const frameDoc = frame.contentDocument;
            const container = frameDoc.createElement('div');
            container.className = 'markdown-rendered';
            container.innerHTML = '<ol><li data-line="0">a<br>1.1 b</li></ol>';
            frameDoc.body.appendChild(container);
            window.readingProcessor(container, {
                getSectionInfo: () => ({ text: '1. a\n\t1.1 b', lineStart: 0, lineEnd: 1 }),
                addChild: child => child.onload()
            });
            const root = container.querySelector('li[data-line="0"]');
            const child = root?.querySelector(':scope > ol > li[data-line="1"]');
            verify('a different-window native root receives its prefix', root?.textContent.startsWith('1. a'));
            verify('a different-window child stays under its parent', child?.textContent === '1.1 b');
            verify('created list nodes belong to the target window', child?.ownerDocument === frameDoc);
            const collapseIcon = root?.querySelector(':scope > .list-collapse-indicator svg path');
            verify('the different-window collapse icon remains SVG',
                collapseIcon?.ownerDocument === frameDoc && collapseIcon?.namespaceURI === 'http://www.w3.org/2000/svg');
        } catch (error) {
            outcomes.push({ name: 'different-window fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const zero = processFixture(
                '0. root\n\t0.1 child\n1. next', 0, 2,
                '<ol start="0"><li data-line="0">root<br>0.1 child</li><li data-line="2">next</li></ol>'
            );
            const root = zero.querySelector('li[data-line="0"]');
            verify('Reading mode retains and aligns a native zero prefix', root?.querySelector(':scope > .smart-list-prefix')?.textContent === '0. ');
            verify('Reading mode retains the inherited zero on the child', root?.querySelector(':scope > ol > li[data-line="1"]')?.textContent === '0.1 child');
            const flat = processFixture('0. root\n\t0.1 child', 0, 1, '<p>0. root<br>0.1 child</p>');
            const rebuiltRoot = flat.querySelector('li[data-line="0"]');
            verify('a numeric marker not parsed natively is rebuilt as a list',
                Boolean(rebuiltRoot?.textContent.startsWith('0. root') && rebuiltRoot.querySelector(':scope > ol > li[data-line="1"]')));
        } catch (error) {
            outcomes.push({ name: 'zero reading fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const invalid = processFixture('一百零一、 body', 0, 0, '<p>一百零一、 body</p>');
            const item = invalid.querySelector('li[data-line="0"]');
            verify('Reading mode renders an out-of-range Chinese prefix as a bullet',
                Boolean(item?.querySelector(':scope > .smart-list-bullet-reading') && item.textContent.trim() === 'body'));
            const mixed = processFixture('A.0 body', 0, 0, '<p>A.0 body</p>');
            const mixedItem = mixed.querySelector('li[data-line="0"]');
            verify('Reading mode renders a mixed zero prefix as a bullet',
                Boolean(mixedItem?.querySelector(':scope > .smart-list-bullet-reading') && mixedItem.textContent.trim() === 'body'));
            const native = processFixture('9007199254740992. body', 0, 0, '<ol><li data-line="0">body</li></ol>');
            const nativeItem = native.querySelector('li[data-line="0"]');
            verify('Reading mode replaces an invalid native numeric marker with a bullet',
                Boolean(nativeItem?.querySelector(':scope > .smart-list-bullet-reading') && nativeItem.textContent.trim() === 'body'));
            const task = processFixture('- [x] A.0 body', 0, 0, '<p>- [x] A.0 body</p>');
            const taskItem = task.querySelector('li[data-line="0"]');
            verify('Reading fallback removes an invalid checkbox-headed prefix and keeps the body',
                Boolean(taskItem?.querySelector(':scope > .smart-list-bullet-reading') && !taskItem.querySelector('input') && taskItem.textContent.trim() === 'body'));
            const tailTask = processFixture('A.0 [x] body', 0, 0, '<p>A.0 [x] body</p>');
            const tailItem = tailTask.querySelector('li[data-line="0"]');
            verify('Reading fallback preserves a checkbox that is part of the line body',
                Boolean(tailItem?.querySelector(':scope > input.task-list-item-checkbox')?.checked && tailItem.textContent.trim() === 'body'));
            const alpha = [...'abcdefghijklmnopqrstuvwxyz'].map((value, index) => value + '. ' + (index + 1)).concat('a. 27');
            const overflow = processFixture(alpha.join('\n'), 0, 26, '<p>' + alpha.join('<br>') + '</p>');
            const overflowItem = overflow.querySelector('li[data-line="26"]');
            verify('Reading mode falls back after a full alphabetic sequence',
                Boolean(overflowItem?.querySelector(':scope > .smart-list-bullet-reading') && overflowItem.textContent.trim() === '27'));
        } catch (error) {
            outcomes.push({ name: 'reading fallback fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const tasks = processFixture(
                '# Heading\n\n1. a\n    1.1 b\n        - [ ] 1.1.1 c\n            - [x] 1.1.1.1 d', 2, 5,
                '<ol><li data-line="0">a<br>1.1 b<br>- [ ] 1.1.1 c<br>- [x] 1.1.1.1 d</li></ol>'
            );
            const inputs = tasks.querySelectorAll('input.task-list-item-checkbox');
            verify('flattened tasks render at both nested depths', inputs.length === 2);
            verify('unchecked and checked task states are retained', inputs.length === 2 && !inputs[0].checked && inputs[1].checked);
            verify('nested task line offsets match the source section', inputs.length === 2 && inputs[0].dataset.line === '2' && inputs[1].dataset.line === '3');
            verify('task prefixes remain separated from the body', tasks.textContent.includes('1.1.1 c') && tasks.textContent.includes('1.1.1.1 d'));
        } catch (error) {
            outcomes.push({ name: 'flattened task fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const native = document.createElement('div');
            native.className = 'markdown-rendered';
            native.innerHTML = '<ol><li data-line="0">a<ul><li data-line="1" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked>1.1 b</li></ul></li></ol>';
            document.body.appendChild(native);
            const existingCheckbox = native.querySelector('input');
            window.readingProcessor(native, {
                getSectionInfo: () => ({ text: '1. a\n    - [x] 1.1 b', lineStart: 0, lineEnd: 1 }),
                addChild: child => child.onload()
            });
            verify('an existing native task input is preserved', native.querySelector('input') === existingCheckbox && existingCheckbox.checked);
            const nativeTask = native.querySelector('li[data-line="1"]');
            const nativeRect = existingCheckbox.getBoundingClientRect();
            const nativeGuide = nativeTask.getBoundingClientRect().left + parseFloat(getComputedStyle(nativeTask).getPropertyValue('--indentation-guide-reading-indent'));
            verify('a native checkbox header is centered on its guide', nativeTask.classList.contains('smart-list-checkbox-head') && Math.abs(nativeRect.left + nativeRect.width / 2 - nativeGuide) < 1);
        } catch (error) {
            outcomes.push({ name: 'native task fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const callout = processFixture(
                '> [!failure]\n> 1. a\n> 2. [ ] b\n> \t2.1 [ ] c\n> \t\t2.1.1 [x] d\n> 3. [ ] e', 0, 5,
                '<div class="callout-content"><ol><li data-line="1">a</li>' +
                '<li data-line="2" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-line="2">b<br>2.1 [ ] c<br>2.1.1 [x] d</li>' +
                '<li data-line="5" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-line="5">e</li></ol></div>'
            );
            const parent = callout.querySelector('li[data-line="2"]');
            const child = parent?.querySelector(':scope > ol > li[data-line="3"]');
            const grandchild = child?.querySelector(':scope > ol > li[data-line="4"]');
            verify('callout child and grandchild keep their nesting', Boolean(child && grandchild));
            verify('callout nested task controls retain their states', Boolean(child?.querySelector(':scope > input') && !child.querySelector(':scope > input').checked && grandchild?.querySelector(':scope > input')?.checked));
            verify('callout nested task text does not repeat its marker', Boolean(child?.textContent.includes('2.1 c') && grandchild?.textContent.includes('2.1.1 d') && !child.textContent.includes('[ ]')));
        } catch (error) {
            outcomes.push({ name: 'callout fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const example = processFixture(
                '1. 1\n\t- 2\n\t\t1. 3\n\t\t\t1.1 4\n\t1.1 5\n\t\t1.1.1 6\n\t\t\t1.1.1.1 7', 0, 6,
                '<ol><li data-line="0">1<ul><li data-line="1"><span class="list-bullet"></span>2' +
                '<ol><li data-line="2">3<br>1.1 4</li></ol></li></ul><br>1.1 5<br>1.1.1 6<br>1.1.1.1 7</li></ol>'
            );
            const row = line => example.querySelector('li[data-line="' + line + '"]');
            const marker = li => li?.querySelector(':scope > .smart-list-prefix, :scope > .smart-list-bullet-reading');
            const guide = li => {
                const child = Array.from(li?.children || []).find(el => el.matches('ol, ul'));
                return child ? child.getBoundingClientRect().left + parseFloat(getComputedStyle(child, '::before').left) : NaN;
            };
            const close = (a, b) => Math.abs(a - b) < 1;
            const x = line => {
                const head = marker(row(line));
                if (!head) return NaN;
                if (head.classList.contains('smart-list-bullet-reading')) {
                    const rect = head.getBoundingClientRect();
                    return rect.left + rect.width / 2;
                }
                const range = document.createRange();
                const index = ReadingAlignmentFixture.leadingHeaderCharacterIndex(head.textContent);
                range.setStart(head.firstChild, index);
                range.setEnd(head.firstChild, index + 1);
                const rect = range.getBoundingClientRect();
                return rect.left + rect.width / 2;
            };
            verify('the original native bullet is reused once', row(1)?.querySelectorAll(':scope > .list-bullet').length === 1);
            verify('the two branches keep their source parents', row(1)?.contains(row(2)) && row(2)?.contains(row(3)) && row(4)?.contains(row(5)) && row(5)?.contains(row(6)));
            verify('fixed-profile leading characters center on their own guides ' + JSON.stringify([0, 1, 2, 4, 5].map(line => [line, x(line), guide(row(line))])), [0, 1, 2, 4, 5].every(line => close(x(line), guide(row(line)))));
            verify('fixed-profile parallel prefixes share a column ' + JSON.stringify([1, 2, 3, 4, 5, 6].map(line => [line, x(line)])), [[1, 4], [2, 5], [3, 6]].every(([a, b]) => close(x(a), x(b))));
            const textNode = Array.from(row(4).childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            const bodyRange = document.createRange();
            bodyRange.selectNodeContents(textNode);
            verify('prefix and body remain adjacent', close(marker(row(4)).getBoundingClientRect().right, bodyRange.getBoundingClientRect().left));

            const fixedPadding = parseFloat(getComputedStyle(row(2).parentElement).paddingInlineStart);
            document.body.classList.replace('smart-list-indent-profile1', 'smart-list-indent-profile2');
            verify('dynamic profile shares the widest parallel parent distance',
                row(2).parentElement.style.getPropertyValue('--sol-reading-dynamic-distance') === '4.3ch' &&
                row(5).parentElement.style.getPropertyValue('--sol-reading-dynamic-distance') === '4.3ch' &&
                row(3).parentElement.style.getPropertyValue('--sol-reading-dynamic-distance') === '5.6ch' &&
                row(6).parentElement.style.getPropertyValue('--sol-reading-dynamic-distance') === '5.6ch');
            verify('selecting the dynamic profile changes the rendered spacing',
                parseFloat(getComputedStyle(row(2).parentElement).paddingInlineStart) > fixedPadding);
            verify('dynamic-profile parallel prefixes share a column ' + JSON.stringify([1, 2, 3, 4, 5, 6].map(line => [line, x(line)])), [[1, 4], [2, 5], [3, 6]].every(([a, b]) => close(x(a), x(b))));
            verify('dynamic-profile leading characters remain centered on their guides ' + JSON.stringify([0, 1, 2, 4, 5].map(line => [line, x(line), guide(row(line))])), [0, 1, 2, 4, 5].every(line => close(x(line), guide(row(line)))));
            verify('dynamic-profile prefix and body remain adjacent', close(marker(row(4)).getBoundingClientRect().right, bodyRange.getBoundingClientRect().left));
            document.body.classList.replace('smart-list-indent-profile2', 'smart-list-indent-profile1');
        } catch (error) {
            outcomes.push({ name: 'alignment fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const checkbox = processFixture(
                '1. a\n\t1.1 b\n\t\t- [ ] 1.1.1 c\n\t\t\t- [x] 1.1.1.1 d', 0, 3,
                '<ol><li data-line="0">a<br>1.1 b<br>- [ ] 1.1.1 c<br>- [x] 1.1.1.1 d</li></ol>'
            );
            const item = checkbox.querySelector('li[data-line="2"]');
            const box = item?.querySelector(':scope > input.task-list-item-checkbox');
            const child = item?.querySelector(':scope > ol');
            const guide = child ? child.getBoundingClientRect().left + parseFloat(getComputedStyle(child, '::before').left) : NaN;
            const rect = box?.getBoundingClientRect();
            const prefix = item?.querySelector(':scope > .smart-list-prefix');
            verify('checkbox header is centered on its guide ' + JSON.stringify([rect?.left, rect?.width, guide]), Boolean(rect && Math.abs(rect.left + rect.width / 2 - guide) < 1));
            verify('checkbox prefix remains after its control', Boolean(rect && prefix && prefix.getBoundingClientRect().left >= rect.right));
        } catch (error) {
            outcomes.push({ name: 'checkbox alignment fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            for (const prefixText of ['12.3', '(12)', 'a.A', '一、']) {
                const host = document.createElement('div');
                host.className = 'markdown-rendered';
                host.innerHTML = '<ol><li class="smart-list-custom-reading"><span class="smart-list-prefix smart-list-prefix-span-reading"></span>body<ol class="smart-list-reading-child"><li>child</li></ol></li></ol>';
                document.body.appendChild(host);
                const item = host.querySelector('li');
                const prefix = item.querySelector(':scope > .smart-list-prefix');
                prefix.textContent = prefixText + ' ';
                ReadingAlignmentFixture.applyReadingHeaderOffsets(host);
                const index = ReadingAlignmentFixture.leadingHeaderCharacterIndex(prefixText);
                const range = document.createRange();
                range.setStart(prefix.firstChild, index);
                range.setEnd(prefix.firstChild, index + 1);
                const rect = range.getBoundingClientRect();
                const child = item.querySelector(':scope > ol');
                const guide = child.getBoundingClientRect().left + parseFloat(getComputedStyle(child, '::before').left);
                const body = Array.from(item.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
                const bodyRange = document.createRange();
                bodyRange.selectNodeContents(body);
                verify('first character or digit centers for ' + prefixText, Math.abs(rect.left + rect.width / 2 - guide) < 1);
                verify('body remains adjacent for ' + prefixText, Math.abs(prefix.getBoundingClientRect().right - bodyRange.getBoundingClientRect().left) < 1);
                host.remove();
            }
        } catch (error) {
            outcomes.push({ name: 'leading-character fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const chinese = processFixture(
                '1. c\n\t- 3\n2. d\n\t- 4\n一、 e\n\t- 5\n二、 f\n\t- 6', 0, 7,
                '<ol><li data-line="0">c<ul><li data-line="1">3</li></ul></li>' +
                '<li data-line="2">d<ul><li data-line="3">4</li><li data-line="5">5</li><li data-line="7">6</li></ul></li></ol>' +
                '<p>一、 e<br>二、 f</p>'
            );
            const row = line => chinese.querySelector('li[data-line="' + line + '"]');
            verify('native bullet 4 stays under its numbered parent', row(3)?.parentElement?.parentElement === row(2));
            verify('native bullet 5 moves under its Chinese parent', row(5)?.parentElement?.parentElement === row(4));
            verify('native bullet 6 moves under its Chinese parent', row(7)?.parentElement?.parentElement === row(6));
            verify('Chinese parents and their bullets keep source order',
                [...chinese.querySelectorAll('li[data-line]')].map(item => item.dataset.line).join(',') === '0,1,2,3,4,5,6,7');

            const mixed = processFixture(
                '一、 parent\n\t1. numbered\n二、 next\n\t- [x] task', 0, 3,
                '<p>一、 parent</p><ol><li data-line="1">numbered</li></ol>' +
                '<p>二、 next</p><ul><li data-line="3" class="task-list-item"><input class="task-list-item-checkbox" type="checkbox" checked>task</li></ul>'
            );
            const mixedRow = line => mixed.querySelector('li[data-line="' + line + '"]');
            verify('native numbered child moves under its Chinese parent', mixedRow(1)?.parentElement?.parentElement === mixedRow(0));
            verify('native task child moves under its Chinese parent with state intact',
                mixedRow(3)?.parentElement?.parentElement === mixedRow(2) && mixedRow(3)?.querySelector('input')?.checked);
        } catch (error) {
            outcomes.push({ name: 'Chinese native-child fixture: ' + String(error.stack || error), ok: false });
        }
        try {
            const detached = document.createElement('div');
            detached.className = 'markdown-rendered';
            detached.innerHTML = '<ol><li data-line="0">a<br>1.1 b</li></ol>';
            let alignmentChild;
            window.readingProcessor(detached, {
                getSectionInfo: () => ({ text: '1. a\n\t1.1 b', lineStart: 0, lineEnd: 1 }),
                addChild: child => { alignmentChild = child; child.onload(); }
            });
            document.body.appendChild(detached);
            const observer = sectionObservers.find(entry => entry.target === detached);
            observer?.callback([], observer);
            const item = detached.querySelector('li[data-line="0"]');
            verify('a detached section measures its leading character after attachment',
                Boolean(observer && item?.style.getPropertyValue('--sol-reading-head-offset')));
            alignmentChild?.onunload();
            verify('the section observer disconnects on unload', Boolean(observer && observer.target === null));
        } catch (error) {
            outcomes.push({ name: 'detached section fixture: ' + String(error.stack || error), ok: false });
        }
        document.body.dataset.fixtureResult = btoa(unescape(encodeURIComponent(JSON.stringify(outcomes))));
        })();
    `;

    const tempRoot = realpathSync(os.tmpdir());
    const tempDir = realpathSync(mkdtempSync(path.join(tempRoot, 'smart-order-reading-')));
    try {
        const htmlPath = path.join(tempDir, 'fixture.html');
        const theme = `.markdown-rendered { --list-indent: 36px; --indentation-guide-reading-indent: -13.6px; font: 16px monospace; }
            .markdown-rendered ol, .markdown-rendered ul { position: relative; margin: 0; padding: 0; list-style: none; }
            .markdown-rendered li { margin-left: var(--list-indent); }
            .markdown-rendered ul > li { margin-left: 29.904px; }
            .markdown-rendered li > ol::before, .markdown-rendered li > ul::before { content: ' '; position: absolute; left: var(--indentation-guide-reading-indent); }
            .markdown-rendered .list-collapse-indicator { position: absolute; }
            .markdown-rendered .list-bullet { float: left; }
            .markdown-rendered .task-list-item-checkbox { width: 14px; height: 14px; margin: 0 2px 0 0; vertical-align: middle; }`;
        const styles = readFileSync('styles.css', 'utf8');
        const html = `<!doctype html><html><head><style>${theme}\n${styles}</style></head><body><script>${obsidianDomFixture}</script><script>${bundle.outputFiles[0].text}</script><script>${alignmentBundle.outputFiles[0].text}</script><script>${fixture}</script></body></html>`;
        writeFileSync(htmlPath, html);
        const output = execFileSync(browser, [
            '--headless=new', '--disable-gpu', '--no-sandbox',
            '--virtual-time-budget=1000',
            `--user-data-dir=${path.join(tempDir, 'profile')}`,
            '--dump-dom', pathToFileURL(htmlPath).href
        ], { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const encoded = output.match(/data-fixture-result="([^"]+)"/)?.[1];
        assert.ok(encoded, `Fixture did not return results: ${output.slice(0, 500)}`);
        const outcomes = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        assert.deepEqual(outcomes.filter(result => !result.ok), [], JSON.stringify(outcomes, null, 2));
    } finally {
        if (path.dirname(tempDir) === tempRoot && path.basename(tempDir).startsWith('smart-order-reading-')) {
            rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    }
});
