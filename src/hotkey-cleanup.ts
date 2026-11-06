import { EditorState, Transaction, type ChangeSpec, type Extension } from '@codemirror/state';
import { PREFIX_REGEX } from './list-patterns';
import { parseQuoteLine } from './quote-context';

/**
 * Fix the custom prefix left behind by Obsidian's native list commands.
 * The filter recognizes their exact line-prefix replacements, including the
 * `input.renumber` transaction used by Obsidian's numbered-list command.
 * Typing, paste, undo, and the plugin's own transactions remain untouched.
 */
export function createHotkeyCleanup(isInCode: (state: EditorState, line: number) => boolean): Extension {
    return EditorState.transactionFilter.of(transaction => {
        const event = transaction.annotation(Transaction.userEvent);
        if (!transaction.docChanged || (event !== undefined && event !== 'input.renumber')) return transaction;

        const corrections: ChangeSpec[] = [];
        const state = transaction.startState;
        transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            const line = state.doc.lineAt(fromA);
            if (fromA !== line.from || toA > line.to || inserted.lines !== 1) return;
            if (!state.selection.ranges.some(range => range.from <= line.to && range.to >= line.from)) return;

            const quoted = parseQuoteLine(line.text);
            const match = quoted.content.match(PREFIX_REGEX);
            if (!match) return;
            const indent = match[1] || '';
            const taskMarker = match[2] || '';
            const prefix = match[3] || '';
            const spaces = match[4] || '';
            const head = quoted.quotePrefix + indent;
            const oldHead = head + taskMarker;
            if (toA !== line.from + oldHead.length || state.sliceDoc(fromA, toA) !== oldHead) return;

            const newHead = inserted.toString();
            if (!newHead.startsWith(head)) return;
            const newMarker = newHead.slice(head.length);
            const number = newMarker.match(/^([1-9][0-9]*)\. $/)?.[1];
            const isBullet = newMarker === '- ' && event === undefined;
            if (!number && !isBullet) return;
            // Ordinary single-slot numbered items are already handled by Obsidian.
            if (!taskMarker && /^(?:0|[1-9][0-9]*)\.$/.test(prefix)) return;
            if (isInCode(state, line.number)) return;

            let replacement: string;
            if (isBullet) {
                replacement = head + '- ';
            } else if (taskMarker) {
                replacement = head + number + '.' + spaces;
            } else {
                const parts = prefix.replace(/\.$/, '').split('.');
                const last = parts[parts.length - 1] || '';
                if (/^(?:0|[1-9][0-9]*)$/.test(last)) {
                    replacement = head;
                } else {
                    parts[parts.length - 1] = number!;
                    replacement = head + parts.join('.') + (parts.length === 1 ? '.' : '') + spaces;
                }
            }

            // In the document produced by Obsidian's change, the old custom
            // prefix and its separator follow immediately after the new head.
            corrections.push({ from: fromB, to: toB + prefix.length + spaces.length, insert: replacement });
        });

        return corrections.length ? [transaction, { changes: corrections, sequential: true }] : transaction;
    });
}
