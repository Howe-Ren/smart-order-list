import { EditorView, WidgetType } from '@codemirror/view';

/** An interactive checkbox for a task marker that Obsidian cannot parse. */
export class SmartTaskWidget extends WidgetType {
    constructor(
        private readonly markerFrom: number,
        private readonly marker: string,
        private readonly placement: 'header' | 'tail' = 'header'
    ) {
        super();
    }

    eq(other: SmartTaskWidget): boolean {
        return this.markerFrom === other.markerFrom && this.marker === other.marker && this.placement === other.placement;
    }

    toDOM(view: EditorView): HTMLElement {
        const input = view.dom.ownerDocument.createElement('input');
        const stateOffset = this.marker.indexOf('[') + 1;
        const status = this.marker[stateOffset] || ' ';
        input.type = 'checkbox';
        input.className = 'task-list-item-checkbox smart-list-task-checkbox';
        if (this.placement === 'tail') input.classList.add('smart-list-task-tail');
        input.setAttribute('data-task', status);
        input.setAttribute('aria-label', 'Toggle task');
        input.checked = status !== ' ';
        input.addEventListener('mousedown', event => event.preventDefault());
        input.addEventListener('change', () => {
            const from = this.markerFrom;
            // A stale widget must never modify a different source marker.
            if (view.state.sliceDoc(from, from + this.marker.length) !== this.marker) {
                input.checked = status !== ' ';
                return;
            }
            view.dispatch({
                changes: { from: from + stateOffset, to: from + stateOffset + 1, insert: status === ' ' ? 'x' : ' ' },
                userEvent: 'input.smart-list-task'
            });
        });
        return input;
    }
}
