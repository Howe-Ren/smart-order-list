/** Source information returned by Obsidian for the rendered section. */
export interface ReadingSectionInfo {
    text: string;
    lineStart: number;
    lineEnd: number;
}

interface TrackedSection {
    snapshot: ReadingSectionInfo;
    eligibleLines: ReadonlySet<number>;
    getCurrentInfo: () => ReadingSectionInfo | null;
}

/**
 * Return source Markdown only for complete, contiguous, plain list items.
 * A null result lets the browser/Obsidian handle the original copy normally.
 */
export function getReadingSelectionMarkdown(
    section: HTMLElement,
    selection: Selection,
    info: ReadingSectionInfo,
    eligibleLines: ReadonlySet<number>
): string | null {
    if (selection.rangeCount !== 1 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!section.contains(range.startContainer) || !section.contains(range.endContainer)) return null;
    const fullySelected = (text: Node): boolean =>
        range.comparePoint(text, 0) === 0 && range.comparePoint(text, text.textContent?.length || 0) === 0;
    const richSelector = 'a, b, strong, em, i, u, s, del, code, pre, img, svg, video, audio, iframe, table, span[style], span[class]';
    for (const rich of Array.from(section.querySelectorAll(richSelector))) {
        if (rich.closest('.list-collapse-indicator') || rich.classList.contains('smart-list-prefix')) continue;
        if (range.intersectsNode(rich)) return null;
    }

    const selectedItems = new Set<HTMLElement>();
    const textWalker = section.ownerDocument.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) {
        const text = textWalker.currentNode;
        if (!text.textContent?.trim() || !range.intersectsNode(text)) continue;
        const parent = text.parentElement;
        if (parent?.closest('.list-collapse-indicator')) continue;
        if (!fullySelected(text)) return null;
        const item = parent?.closest('li');
        if (!item || !section.contains(item) || !item.hasAttribute('data-line')) return null;
        selectedItems.add(item);
    }
    if (selectedItems.size === 0) return null;

    let includesPluginItem = false;
    const lineOffsets: number[] = [];
    const lines = info.text.split('\n');
    for (const item of selectedItems) {
        if (item.classList.contains('smart-list-custom-reading') ||
            item.classList.contains('smart-list-native-override-reading')) includesPluginItem = true;

        // A partially selected item must never turn into a whole source line.
        const itemWalker = section.ownerDocument.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        while (itemWalker.nextNode()) {
            const text = itemWalker.currentNode;
            if (!text.textContent?.trim()) continue;
            const parent = text.parentElement;
            if (parent?.closest('.list-collapse-indicator') || parent?.closest('li') !== item) continue;
            if (!fullySelected(text)) return null;
        }

        const rawOffset = item.getAttribute('data-line');
        if (!rawOffset || !/^\d+$/.test(rawOffset)) return null;
        const offset = Number(rawOffset);
        const line = info.lineStart + offset;
        if (!Number.isSafeInteger(line) || line > info.lineEnd || line >= lines.length || !eligibleLines.has(line)) return null;
        lineOffsets.push(line);
    }
    if (!includesPluginItem) return null;

    // The selected DOM order must match a gap-free sequence of source lines.
    for (let i = 1; i < lineOffsets.length; i++) {
        if (lineOffsets[i] !== lineOffsets[i - 1]! + 1) return null;
    }
    return lines.slice(lineOffsets[0], lineOffsets[lineOffsets.length - 1]! + 1).join('\n');
}

/**
 * Keep a single document copy listener and weak references to rendered sections.
 * The caller registers the listener with the plugin lifecycle.
 */
export function createReadingCopyTracker(
    registerCopyListener: (doc: Document, callback: (event: ClipboardEvent) => void) => void
): {
    track: (section: HTMLElement, snapshot: ReadingSectionInfo, eligibleLines: ReadonlySet<number>,
            getCurrentInfo: () => ReadingSectionInfo | null) => void;
} {
    const sections = new WeakMap<HTMLElement, TrackedSection>();
    const documents = new WeakSet<Document>();

    const onCopy = (event: ClipboardEvent) => {
        const doc = event.currentTarget as Document;
        const selection = doc.getSelection();
        if (!selection?.anchorNode || !event.clipboardData) return;
        let element = selection.anchorNode.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode as HTMLElement : selection.anchorNode.parentElement;
        while (element) {
            const tracked = sections.get(element);
            if (tracked) {
                const current = tracked.getCurrentInfo();
                // DOM data-line offsets belong to the exact source snapshot used
                // when the section was rendered. Fall back if it has changed.
                if (!current || current.text !== tracked.snapshot.text ||
                    current.lineStart !== tracked.snapshot.lineStart || current.lineEnd !== tracked.snapshot.lineEnd) return;
                const markdown = getReadingSelectionMarkdown(element, selection, current, tracked.eligibleLines);
                if (markdown === null) return;
                event.clipboardData.clearData('text/html');
                event.clipboardData.setData('text/plain', markdown);
                event.preventDefault();
                return;
            }
            element = element.parentElement;
        }
    };

    return {
        track(section, snapshot, eligibleLines, getCurrentInfo) {
            sections.set(section, { snapshot, eligibleLines, getCurrentInfo });
            const doc = section.ownerDocument;
            if (!documents.has(doc)) {
                registerCopyListener(doc, onCopy);
                documents.add(doc);
            }
        }
    };
}
