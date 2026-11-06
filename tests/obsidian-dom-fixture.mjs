// The browser fixtures run outside Obsidian, so provide its append-on-create
// DOM helpers for each window participating in the test.
export const obsidianDomFixture = String.raw`
    function installObsidianDomHelpers(win) {
        win.Node.prototype.createEl = function(tag) {
            const child = this.ownerDocument.createElement(tag);
            this.appendChild(child);
            return child;
        };
        win.Node.prototype.createDiv = function() { return this.createEl('div'); };
    }
    installObsidianDomHelpers(window);
`;
