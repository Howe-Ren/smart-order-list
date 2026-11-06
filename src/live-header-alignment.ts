import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { leadingHeaderCharacterIndex } from './reading-alignment';

interface HeaderOffset {
    element: HTMLElement;
    value: string;
}

/** Measure a prefix's first meaningful character, even when syntax marks split it. */
function characterRange(element: HTMLElement, index: number): Range | null {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = index;
    let node = walker.nextNode();
    while (node) {
        const text = node.textContent ?? '';
        if (offset < text.length) {
            const character = Array.from(text.slice(offset))[0];
            if (!character) return null;
            const range = element.ownerDocument.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + character.length);
            return range;
        }
        offset -= text.length;
        node = walker.nextNode();
    }
    return null;
}

/** Align custom ordered headers to the same anchor as native numeric markers. */
export const liveHeaderAlignment = ViewPlugin.fromClass(class {
    private readonly canvas: CanvasRenderingContext2D | null;
    private readonly resizeObserver: ResizeObserver | null;
    private readonly fonts: FontFaceSet | undefined;
    private readonly onFontChange = () => this.schedule();
    private destroyed = false;

    constructor(private readonly view: EditorView) {
        const doc = view.dom.ownerDocument;
        this.canvas = doc.createElement('canvas').getContext('2d');
        this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.schedule());
        this.resizeObserver?.observe(view.dom);
        this.fonts = doc.fonts;
        this.fonts?.addEventListener('loadingdone', this.onFontChange);
        this.schedule();
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) this.schedule();
    }

    private schedule(): void {
        if (this.destroyed || !this.canvas) return;
        this.view.requestMeasure({
            key: this,
            read: () => this.measure(),
            write: offsets => {
                if (this.destroyed) return;
                for (const { element, value } of offsets) {
                    if (element.isConnected && element.style.getPropertyValue('--sol-live-header-shift') !== value) {
                        element.style.setProperty('--sol-live-header-shift', value);
                    }
                }
            }
        });
    }

    private measure(): HeaderOffset[] {
        const canvas = this.canvas;
        const win = this.view.dom.ownerDocument.defaultView;
        if (!canvas || !win) return [];
        const offsets: HeaderOffset[] = [];
        for (const element of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.smart-list-align-header'))) {
            // Overlapping decorations can nest identical marks; adjust the outer one only.
            if (element.parentElement?.closest('.smart-list-align-header')) continue;
            const text = element.textContent ?? '';
            const range = characterRange(element, leadingHeaderCharacterIndex(text));
            if (!range) continue;
            const character = range.getBoundingClientRect();
            const prefix = element.getBoundingClientRect();
            if (character.width <= 0 || prefix.width <= 0) continue;
            const style = win.getComputedStyle(element);
            canvas.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
            const letterSpacing = parseFloat(style.letterSpacing);
            const digitWidth = canvas.measureText('1').width + (Number.isFinite(letterSpacing) ? letterSpacing : 0);
            const center = character.left + character.width / 2;
            const leadingWidth = style.direction === 'rtl' ? prefix.right - center : center - prefix.left;
            const shift = Math.round((digitWidth / 2 - leadingWidth) * 100) / 100;
            offsets.push({ element, value: `${shift}px` });
        }
        return offsets;
    }

    destroy(): void {
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        this.fonts?.removeEventListener('loadingdone', this.onFontChange);
    }
});
