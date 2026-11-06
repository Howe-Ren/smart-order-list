import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

test('settings render and save through legacy and searchable paths', { skip: !browser }, async () => {
    const bundle = await build({
        entryPoints: ['src/settings-tab.ts'], bundle: true, format: 'iife',
        globalName: 'SettingsFixture', platform: 'browser', write: false, logLevel: 'silent',
        plugins: [{ name: 'obsidian-settings-stub', setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
            builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                contents: `
                    export class PluginSettingTab {
                        constructor(app) { this.containerEl = app.containerEl; }
                    }
                    export class Setting {
                        constructor(container) {
                            this.settingEl = document.createElement('div');
                            this.nameEl = this.settingEl.appendChild(document.createElement('div'));
                            this.descEl = this.settingEl.appendChild(document.createElement('div'));
                            container.appendChild(this.settingEl);
                        }
                        setName(name) { this.nameEl.textContent = name; return this; }
                        setDesc(desc) { this.descEl.replaceChildren(desc); return this; }
                        setClass(name) { this.settingEl.classList.add(name); return this; }
                        addDropdown(callback) {
                            const select = this.settingEl.appendChild(document.createElement('select'));
                            const dropdown = {
                                addOption(value, label) { select.add(new Option(label, value)); return this; },
                                setValue(value) { select.value = value; return this; },
                                onChange(fn) { select.addEventListener('change', () => fn(select.value)); return this; }
                            };
                            callback(dropdown);
                            return this;
                        }
                    }
                    window.FixtureSetting = Setting;
                `, loader: 'js'
            }));
        } }]
    });
    const fixture = String.raw`
        (async () => {
            const results = [];
            const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
            HTMLElement.prototype.empty = function() { this.replaceChildren(); };
            for (const mode of ['legacy', 'searchable']) {
                try {
                    const container = document.createElement('div');
                    document.body.appendChild(container);
                    const plugin = { settings: { indentationProfile: 'profile1' }, saves: 0,
                        async saveData() { this.saves++; } };
                    const tab = new SettingsFixture.SmartOrderListSettingTab({ containerEl: container }, plugin);
                    const definitions = tab.getSettingDefinitions();
                    check(mode + ': setting is indexed by name', definitions[0].name === 'Indentation Profile');
                    if (mode === 'legacy') tab.display();
                    else {
                        // Model the Setting row Obsidian prepares before invoking render.
                        const setting = new window.FixtureSetting(container);
                        setting.setName(definitions[0].name).setDesc(document.createTextNode(definitions[0].desc));
                        definitions[0].render(setting);
                    }
                    const row = container.querySelector('.smart-list-indentation-setting');
                    const select = row?.querySelector('select');
                    check(mode + ': same title and formatted description',
                        row?.textContent.includes('Indentation Profile') && row.querySelectorAll('strong').length === 3 &&
                        row.querySelectorAll('br').length === 1);
                    check(mode + ': dropdown reflects saved profile', select?.value === 'profile1' && select.options.length === 2);
                    select.value = 'profile2';
                    select.dispatchEvent(new Event('change'));
                    await Promise.resolve();
                    check(mode + ': changing profile applies and saves it', plugin.settings.indentationProfile === 'profile2' &&
                        document.body.classList.contains('smart-list-indent-profile2') && plugin.saves === 1);
                } catch (error) { results.push({ name: mode + ': ' + String(error.stack || error), ok: false }); }
            }
            document.body.dataset.fixtureResult = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
        })();
    `;

    const tempRoot = realpathSync(os.tmpdir());
    const tempDir = realpathSync(mkdtempSync(path.join(tempRoot, 'smart-order-settings-')));
    try {
        const htmlPath = path.join(tempDir, 'fixture.html');
        writeFileSync(htmlPath, `<!doctype html><html><body><script>${obsidianDomFixture}</script><script>${bundle.outputFiles[0].text}</script><script>${fixture}</script></body></html>`);
        const output = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
            '--virtual-time-budget=1000', `--user-data-dir=${path.join(tempDir, 'profile')}`,
            '--dump-dom', pathToFileURL(htmlPath).href],
        { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const encoded = output.match(/data-fixture-result="([^"]+)"/)?.[1];
        assert.ok(encoded, `Fixture did not return results: ${output.slice(0, 500)}`);
        const results = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        assert.deepEqual(results.filter(result => !result.ok), [], JSON.stringify(results, null, 2));
    } finally {
        if (path.dirname(tempDir) === tempRoot && path.basename(tempDir).startsWith('smart-order-settings-')) {
            rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    }
});
