import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { obsidianDomFixture } from './obsidian-dom-fixture.mjs';

const browser = [process.env.SMART_ORDER_TEST_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(existsSync);

test('Live Preview decorations render and safely toggle unsupported task markers', { skip: !browser }, async () => {
    const bundle = await build({
        stdin: { contents: readFileSync('src/main.ts', 'utf8') + '\nexport { EditorState, EditorView, listMarkerDecorator, liveHeaderAlignment }; export { enhanceLiveCallout } from "./live-callout";',
            sourcefile: 'main.ts', resolveDir: path.resolve('src'), loader: 'ts' },
        bundle: true, format: 'iife', globalName: 'Fixture', platform: 'browser', write: false, logLevel: 'silent',
        plugins: [{ name: 'obsidian-stub', setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
            builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class Plugin {} export class PluginSettingTab {} export class Setting {} export class MarkdownRenderChild {} export class Notice {}', loader: 'js' }));
        } }]
    });
    const fixture = String.raw`
        (async () => {
        const results = [];
        const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
        try {
            const input = 'a. 1\n\t1. 2\n\n1. a\n\t1.1 b\n\t\t- [ ] 1.1.1 c\n\t\t\t- [x] 1.1.1.1 d';
            const view = new Fixture.EditorView({
                state: Fixture.EditorState.create({ doc: input, selection: { anchor: 0 }, extensions: [Fixture.listMarkerDecorator] }),
                parent: document.body
            });
            const controls = document.querySelectorAll('input.smart-list-task-checkbox');
            check('deep tasks have interactive controls', controls.length === 2);
            check('task states are preserved', controls.length === 2 && !controls[0].checked && controls[1].checked);
            const prefix = [...document.querySelectorAll('.smart-list-prefix')].find(element => element.textContent === '1.');
            check('numeric child gets prefix styling', Boolean(prefix));
            controls[0]?.click();
            check('click changes only its own source status', view.state.doc.toString() === input.replace('- [ ] 1.1.1 c', '- [x] 1.1.1 c'));
            const markerPosition = view.state.doc.toString().indexOf('- [x] 1.1.1 c');
            view.focus();
            view.dispatch({ selection: { anchor: markerPosition + 1 } });
            check('editing a task marker exposes its source', document.querySelectorAll('input.smart-list-task-checkbox').length === 1);
            view.dispatch({ selection: { anchor: 0 } });
            check('task control returns when editing another line', document.querySelectorAll('input.smart-list-task-checkbox').length === 2);
        } catch (error) { results.push({ name: String(error.stack || error), ok: false }); }
        try {
            const source = '1. a\n\t1.0 b\n\t\t- [ ] 1.0.1 c';
            const host = document.createElement('div');
            document.body.appendChild(host);
            const view = new Fixture.EditorView({
                state: Fixture.EditorState.create({ doc: source, extensions: [Fixture.listMarkerDecorator] }),
                parent: host
            });
            const checkbox = host.querySelector('input.smart-list-task-checkbox');
            check('a multi-slot checkbox with inherited zero renders', Boolean(checkbox));
            checkbox?.click();
            check('the zero-prefix checkbox updates only its source marker', view.state.doc.toString() === source.replace('[ ]', '[x]'));
            view.destroy();
        } catch (error) { results.push({ name: 'zero task: ' + String(error.stack || error), ok: false }); }
        try {
            const source = '> 1. [ ] a\n> 2. [x] b\n> \t2.1 [ ] c $\\text{test}$\n> \t\t2.1.1 [-] d\n> 3. [ ] e';
            const host = document.createElement('div');
            document.body.appendChild(host);
            const view = new Fixture.EditorView({
                state: Fixture.EditorState.create({ doc: source, extensions: [Fixture.listMarkerDecorator] }),
                parent: host
            });
            let controls = host.querySelectorAll('input.smart-list-task-tail');
            check('plain quoted ordered-task tails render interactive checkboxes', controls.length === 5);
            check('quoted task states are retained', controls.length === 5 && !controls[0].checked && controls[1].checked && controls[3].checked);
            controls[2]?.click();
            check('quoted task click changes only its own source marker', view.state.doc.toString() === source.replace('2.1 [ ] c', '2.1 [x] c'));
            const marker = view.state.doc.toString().indexOf('[x] c');
            view.focus();
            view.dispatch({ selection: { anchor: marker + 1 } });
            controls = host.querySelectorAll('input.smart-list-task-tail');
            check('editing a quoted task marker reveals its source', controls.length === 4);
            view.dispatch({ selection: { anchor: 0 } });
            check('quoted task control returns outside the marker', host.querySelectorAll('input.smart-list-task-tail').length === 5);
            view.destroy();

            const calloutHost = document.createElement('div');
            document.body.appendChild(calloutHost);
            const calloutView = new Fixture.EditorView({
                state: Fixture.EditorState.create({ doc: '> [!note]\n> 1. [ ] a', extensions: [Fixture.listMarkerDecorator] }),
                parent: calloutHost
            });
            check('plain quote widget does not replace markers inside callouts', !calloutHost.querySelector('input.smart-list-task-tail'));
            calloutView.destroy();

            const codeHost = document.createElement('div');
            document.body.appendChild(codeHost);
            const fence = String.fromCharCode(96).repeat(3);
            const codeView = new Fixture.EditorView({
                state: Fixture.EditorState.create({ doc: '> ' + fence + '\n> 1. [ ] code\n> ' + fence + '\n1. [ ] outside', extensions: [Fixture.listMarkerDecorator] }),
                parent: codeHost
            });
            check('quoted code and unquoted content do not gain plain-quote widgets', !codeHost.querySelector('input.smart-list-task-tail'));
            codeView.destroy();
        } catch (error) { results.push({ name: 'quoted task: ' + String(error.stack || error), ok: false }); }
        try {
            const host = document.createElement('div');
            host.className = 'markdown-source-view mod-cm6';
            host.style.font = '16px sans-serif';
            document.body.appendChild(host);
            const input = '1. native\n(12) paren\n一、 chinese\nA. upper\na. lower';
            const view = new Fixture.EditorView({
                state: Fixture.EditorState.create({ doc: input, extensions: [Fixture.listMarkerDecorator, Fixture.liveHeaderAlignment] }),
                parent: host
            });
            await new Promise(resolve => setTimeout(resolve, 150));
            const rows = [...view.contentDOM.querySelectorAll('.cm-line')];
            function center(element, index) {
                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                const node = walker.nextNode();
                if (!node) return NaN;
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + 1);
                const box = range.getBoundingClientRect();
                return box.left + box.width / 2;
            }
            const anchor = center(rows[0], 0);
            const centers = rows.slice(1).map((row, i) => center(row.querySelector('.smart-list-align-header'), i === 0 ? 1 : 0));
            check('custom first characters align with the native digit ' + JSON.stringify([anchor, ...centers]),
                centers.every(value => Math.abs(value - anchor) < 1));
            check('centering leaves the source text unchanged', view.state.doc.toString() === input);
            const inside = input.indexOf('(12)') + 2;
            view.focus();
            view.dispatch({ changes: { from: inside, insert: '3' }, selection: { anchor: inside + 1 } });
            await new Promise(resolve => setTimeout(resolve, 100));
            check('the prefix remains editable while aligned', view.state.doc.toString() === input.replace('(12)', '(132)'));
            const edited = [...view.contentDOM.querySelectorAll('.cm-line')][1]?.querySelector('.smart-list-align-header');
            check('the edited first digit remains centered', Boolean(edited && Math.abs(center(edited, 1) - anchor) < 1));
            view.destroy();
        } catch (error) { results.push({ name: 'live header alignment: ' + String(error.stack || error), ok: false }); }
        try {
            const source = '> [!failure]\n> 1. a\n> 2. [ ] b\n> \t2.1 [ ] c **bold**\n> \t\t2.1.1 [x] d\n> 3. [ ] e';
            const callout = document.createElement('div');
            callout.className = 'callout';
            callout.innerHTML = '<div class="callout-content"><ol><li>a</li>' +
                '<li><input type="checkbox">b<br>\n2.1 [ ] c <strong>bold</strong><br>\n2.1.1 [x] d</li>' +
                '<li><input type="checkbox">e</li></ol></div>';
            document.body.appendChild(callout);
            const fake = { state: Fixture.EditorState.create({ doc: source }), posAtDOM: () => 0,
                dispatch(spec) { this.state = this.state.update(spec).state; } };
            check('flattened callout is recognized', Fixture.enhanceLiveCallout(fake, callout));
            const root = callout.querySelector('.callout-content > ol > li:nth-child(2)');
            const child = root?.querySelector(':scope > ol > li');
            const grandchild = child?.querySelector(':scope > ol > li');
            check('callout tasks keep parent-child nesting', Boolean(child && grandchild));
            check('inline formatting remains in the moved task body', child?.querySelector('strong')?.textContent === 'bold');
            const controls = callout.querySelectorAll('input.smart-list-callout-task');
            check('callout task states are retained', controls.length === 2 && !controls[0].checked && controls[1].checked);
            controls[0]?.click();
            check('callout click changes only the correct source marker', fake.state.doc.toString() === source.replace('2.1 [ ] c', '2.1 [x] c'));
            controls[0]?.click();
            check('callout task can be toggled back', fake.state.doc.toString() === source);
            fake.state = fake.state.update({ changes: { from: 0, insert: '# Before\n' } }).state;
            fake.posAtDOM = () => '# Before\n'.length;
            controls[1]?.click();
            check('callout source mapping follows text inserted above it', fake.state.doc.toString() === '# Before\n' + source.replace('2.1.1 [x] d', '2.1.1 [ ] d'));
            const updated = fake.state.doc.toString();
            fake.state = fake.state.update({ changes: { from: updated.indexOf('2.1 [ ] c'), to: updated.indexOf('2.1 [ ] c') + 9, insert: '2.1 [ ] changed' } }).state;
            const changed = fake.state.doc.toString();
            controls[0]?.click();
            check('a stale callout control cannot change edited source', fake.state.doc.toString() === changed && !controls[0].checked);
            const untouched = document.createElement('div');
            untouched.innerHTML = '<div class="callout-content"><ol><li>a<br>unrelated</li></ol></div>';
            const before = untouched.innerHTML;
            check('unmatched callouts are left untouched', !Fixture.enhanceLiveCallout(fake, untouched) && untouched.innerHTML === before);
        } catch (error) { results.push({ name: 'callout: ' + String(error.stack || error), ok: false }); }
        try {
            const frame = document.createElement('iframe');
            document.body.appendChild(frame);
            installObsidianDomHelpers(frame.contentWindow);
            const frameDoc = frame.contentDocument;
            const callout = frameDoc.createElement('div');
            callout.className = 'callout';
            callout.innerHTML = '<div class="callout-content"><ol><li>parent<br>1.1 [ ] child</li></ol></div>';
            frameDoc.body.appendChild(callout);
            const source = '> [!note]\n> 1. parent\n> \t1.1 [ ] child';
            const fake = { state: Fixture.EditorState.create({ doc: source }), posAtDOM: () => 0,
                dispatch(spec) { this.state = this.state.update(spec).state; } };
            check('a different-window callout is recognized', Fixture.enhanceLiveCallout(fake, callout));
            const checkbox = callout.querySelector('input.smart-list-callout-task');
            check('a different-window callout creates its checkbox in that window', checkbox?.ownerDocument === frameDoc);
            checkbox?.click();
            check('a different-window checkbox updates its own source', fake.state.doc.toString() === source.replace('[ ]', '[x]'));
        } catch (error) { results.push({ name: 'different-window callout: ' + String(error.stack || error), ok: false }); }
        document.body.dataset.result = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
        })();
    `;
    const root = realpathSync(os.tmpdir());
    const dir = realpathSync(mkdtempSync(path.join(root, 'smart-order-live-')));
    try {
        const file = path.join(dir, 'fixture.html');
        const styles = readFileSync('styles.css', 'utf8');
        writeFileSync(file, `<!doctype html><html><head><style>${styles}</style></head><body><script>${obsidianDomFixture}</script><script>${bundle.outputFiles[0].text}</script><script>${fixture}</script></body></html>`);
        const output = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
            '--virtual-time-budget=1000',
            `--user-data-dir=${path.join(dir, 'profile')}`, '--dump-dom', pathToFileURL(file).href],
        { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const encoded = output.match(/data-result="([^"]+)"/)?.[1];
        assert.ok(encoded, `Fixture did not return results: ${output.slice(0, 500)}`);
        const results = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        assert.deepEqual(results.filter(result => !result.ok), [], JSON.stringify(results, null, 2));
    } finally {
        if (path.dirname(dir) === root && path.basename(dir).startsWith('smart-order-live-')) {
            rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    }
});
