import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { PREFIX_REGEX } from './list-patterns';
import { isCalloutHeader, parseQuoteLine } from './quote-context';

interface NestedTask {
    lineNumber: number;
    source: string;
    prefix: string;
    depth: number;
    status: string;
}

interface Segment {
    separator: Node;
    nodes: Node[];
    text: Text;
    prefixLength: number;
    task: NestedTask;
}

/** Repair the specific flattened ordered-task form inside a rendered callout. */
export function enhanceLiveCallout(view: EditorView, callout: Element): boolean {
    let headerNumber: number;
    try { headerNumber = view.state.doc.lineAt(view.posAtDOM(callout)).number; }
    catch { return false; }
    const header = view.state.doc.line(headerNumber).text;
    if (!isCalloutHeader(header)) return false;
    const quoteDepth = parseQuoteLine(header).depth;
    const roots: NestedTask[][] = [];
    let current: NestedTask[] | undefined;

    for (let number = headerNumber + 1; number <= view.state.doc.lines; number++) {
        const source = view.state.doc.line(number).text;
        const quote = parseQuoteLine(source);
        if (quote.depth < quoteDepth) break;
        if (quote.depth !== quoteDepth || !quote.content.trim()) return false;
        const match = quote.content.match(PREFIX_REGEX);
        if (!match || match[2]) return false;
        const indent = (match[1] || '').replace(/\t/g, '    ');
        if (indent.length % 4) return false;
        const depth = indent.length / 4;
        const prefix = match[3] || '';
        if (depth === 0) {
            if (!/^(?:0|[1-9][0-9]*)\.$/.test(prefix)) return false;
            current = [];
            roots.push(current);
            continue;
        }
        const task = (match[5] || '').match(/^\[([ xX-])\](?:[ \t]+|$)/);
        if (!current || !task || !prefix.includes('.')) return false;
        current.push({ lineNumber: number, source, prefix, depth, status: task[1] || ' ' });
    }
    if (!roots.some(root => root.length)) return false;

    const content = callout.querySelector(':scope > .callout-content');
    if (!content || content.children.length !== 1 || content.children[0]?.tagName !== 'OL') return false;
    const nativeItems = Array.from(content.children[0].children);
    if (nativeItems.length !== roots.length || nativeItems.some(item => item.tagName !== 'LI')) return false;

    // Validate every segment before moving any DOM nodes. This leaves complex
    // or unsupported callouts in Obsidian's own rendering untouched.
    const plans: Segment[][] = [];
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
        const items = roots[rootIndex]!;
        const li = nativeItems[rootIndex]!;
        const groups: { separator: Node; nodes: Node[] }[] = [];
        let group: { separator: Node; nodes: Node[] } | undefined;
        for (const child of Array.from(li.childNodes)) {
            if (child.nodeName === 'BR') { group = { separator: child, nodes: [] }; groups.push(group); }
            else if (group) group.nodes.push(child);
        }
        if (groups.length !== items.length) return false;
        const rootPlan: Segment[] = [];
        let previousDepth = 0;
        for (let index = 0; index < items.length; index++) {
            const task = items[index]!;
            const segment = groups[index]!;
            if (task.depth > previousDepth + 1) return false;
            const text = segment.nodes[0];
            if (!text || text.nodeType !== Node.TEXT_NODE) return false;
            const escaped = task.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = text.nodeValue?.match(new RegExp(`^\\s*${escaped}[ \\t]+\\[([ xX-])\\](?:[ \\t]+|$)`));
            if (!match || match[1] !== task.status) return false;
            rootPlan.push({ ...segment, text: text as Text, prefixLength: match[0].length, task });
            previousDepth = task.depth;
        }
        plans.push(rootPlan);
    }

    const doc = callout.ownerDocument;
    plans.forEach((segments, rootIndex) => {
        const stack: Element[] = [nativeItems[rootIndex]!];
        for (const segment of segments) {
            const { task } = segment;
            const parent = stack[task.depth - 1]!;
            let list = Array.from(parent.children).find(child => child.classList.contains('smart-list-callout-list'));
            if (!list) {
                list = doc.createElement('ol');
                list.className = 'smart-list-callout-list';
                parent.appendChild(list);
            }
            const item = doc.createElement('li');
            item.className = 'smart-list-callout-item';
            const prefix = doc.createElement('span');
            prefix.className = 'smart-list-prefix';
            prefix.textContent = `${task.prefix} `;
            const checkbox = doc.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'task-list-item-checkbox smart-list-callout-task';
            checkbox.setAttribute('aria-label', 'Toggle task');
            checkbox.checked = task.status !== ' ';
            let expectedSource = task.source;
            for (const eventName of ['mousedown', 'click']) checkbox.addEventListener(eventName, event => event.stopPropagation());
            checkbox.addEventListener('change', event => {
                event.stopPropagation();
                const reject = () => { checkbox.checked = task.status !== ' '; };
                let currentHeader: number;
                try { currentHeader = view.state.doc.lineAt(view.posAtDOM(callout)).number; }
                catch { reject(); return; }
                const currentNumber = currentHeader + task.lineNumber - headerNumber;
                if (currentNumber > view.state.doc.lines || view.state.doc.line(currentHeader).text !== header) { reject(); return; }
                const line = view.state.doc.line(currentNumber);
                if (line.text !== expectedSource) { reject(); return; }
                const marker = line.text.indexOf(`[${task.status}]`);
                if (marker < 0) { reject(); return; }
                const next = checkbox.checked ? 'x' : ' ';
                view.dispatch({ changes: { from: line.from + marker + 1, to: line.from + marker + 2, insert: next },
                    userEvent: 'input.smart-list-task' });
                task.status = next;
                expectedSource = line.text.slice(0, marker + 1) + next + line.text.slice(marker + 2);
            });
            item.append(prefix, checkbox, doc.createTextNode(' '));
            segment.text.nodeValue = (segment.text.nodeValue || '').slice(segment.prefixLength);
            segment.separator.parentNode?.removeChild(segment.separator);
            for (const node of segment.nodes) item.appendChild(node);
            list.appendChild(item);
            stack[task.depth] = item;
            stack.length = task.depth + 1;
        }
    });
    return true;
}

/** Revisit rendered callout widgets after CodeMirror or Obsidian updates them. */
export const liveCalloutPlugin = ViewPlugin.fromClass(class {
    private readonly observer: MutationObserver;
    private readonly handled = new WeakSet<Element>();
    private frame: number | null = null;
    private readonly win: Window;

    constructor(private readonly view: EditorView) {
        this.win = view.dom.ownerDocument.defaultView!;
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
        this.schedule();
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) this.schedule();
    }

    private schedule() {
        if (this.frame !== null) return;
        this.frame = this.win.requestAnimationFrame(() => {
            this.frame = null;
            for (const callout of Array.from(this.view.contentDOM.querySelectorAll('.callout'))) {
                if (!this.handled.has(callout) && enhanceLiveCallout(this.view, callout)) this.handled.add(callout);
            }
        });
    }

    destroy() {
        this.observer.disconnect();
        if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    }
});
