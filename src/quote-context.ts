/** The quote markers are kept separately from the list indentation that follows. */
export interface QuoteLine {
    quotePrefix: string;
    content: string;
    depth: number;
}

/** Split explicit Markdown blockquote markers without consuming list indentation. */
export function parseQuoteLine(line: string): QuoteLine {
    // Four leading spaces or a tab can start an indented code block. Do not
    // interpret its contents as a top-level quote and rewrite the source.
    const first = line.match(/^ {0,3}>/);
    if (!first) return { quotePrefix: '', content: line, depth: 0 };

    let end = first[0].length;
    let depth = 1;
    if (line[end] === ' ' || line[end] === '\t') end++;

    // A nested marker may have up to three spaces before it. Only consume
    // those spaces when another marker actually follows them.
    while (end < line.length) {
        const nested = line.slice(end).match(/^ {0,3}>/);
        if (!nested) break;
        end += nested[0].length;
        depth++;
        if (line[end] === ' ' || line[end] === '\t') end++;
    }

    return { quotePrefix: line.slice(0, end), content: line.slice(end), depth };
}

export function isCalloutHeader(line: string): boolean {
    const quote = parseQuoteLine(line);
    return quote.depth > 0 && /^[ \t]*\[![^\]\r\n]+\]/.test(quote.content);
}

/** An independent callout is preceded by a blank physical line, or starts the document. */
export function isIndependentCallout(line: string, previousLine?: string): boolean {
    return isCalloutHeader(line) && (previousLine === undefined || previousLine.trim() === '');
}

/** Maintain independent state for the outer document and each active quote level. */
export class QuoteContextStacks<T> {
    private contexts: T[];

    constructor(private readonly create: () => T) {
        this.contexts = [create()];
    }

    select(depth: number): T {
        if (!Number.isInteger(depth) || depth < 0) throw new RangeError('Invalid quote depth');
        // Closing a quote discards its state, so a later quote starts fresh.
        this.contexts.length = Math.min(this.contexts.length, depth + 1);
        while (this.contexts.length <= depth) this.contexts.push(this.create());
        return this.contexts[depth]!;
    }

    peek(depth: number): T | undefined {
        return this.contexts[depth];
    }

    /** Start a new context at this depth without affecting its parent. */
    reset(depth: number): T {
        this.select(depth);
        const value = this.create();
        this.contexts[depth] = value;
        return value;
    }
}

export interface FenceState {
    marker: '`' | '~';
    length: number;
}

/** Feed quote-stripped content from one context, including opening/closing fences. */
export function consumeFence(content: string, fence: FenceState | null): { fence: FenceState | null; inCode: boolean } {
    const match = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence) {
        if (!match) return { fence: null, inCode: false };
        const marker = match[1]!;
        // Backtick info strings may not themselves contain backticks.
        if (marker[0] === '`' && (match[2] || '').includes('`')) return { fence: null, inCode: false };
        return { fence: { marker: marker[0] as '`' | '~', length: marker.length }, inCode: true };
    }

    if (match && match[1]![0] === fence.marker && match[1]!.length >= fence.length && /^[ \t]*$/.test(match[2] || '')) {
        return { fence: null, inCode: true };
    }
    return { fence, inCode: true };
}
