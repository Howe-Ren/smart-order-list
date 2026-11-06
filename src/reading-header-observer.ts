import { MarkdownRenderChild } from 'obsidian';
import { applyReadingHeaderOffsets } from './reading-alignment';

/** Recalculate when Obsidian attaches or resizes a rendered section. */
export class ReadingHeaderObserver extends MarkdownRenderChild {
    private observer: ResizeObserver | null = null;

    onload(): void {
        applyReadingHeaderOffsets(this.containerEl);
        const view = this.containerEl.ownerDocument.defaultView;
        if (!view?.ResizeObserver) return;
        this.observer = new view.ResizeObserver(() => applyReadingHeaderOffsets(this.containerEl));
        this.observer.observe(this.containerEl);
    }

    onunload(): void {
        this.observer?.disconnect();
        this.observer = null;
    }
}
