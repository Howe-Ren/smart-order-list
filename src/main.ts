import { Plugin } from 'obsidian';
import { Prec, Range, Annotation, EditorState, ChangeSpec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { keymap, EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { parseQuoteLine, isCalloutHeader, isIndependentCallout, QuoteContextStacks, consumeFence, type FenceState } from './quote-context';
import { decideCrossNest } from './cross-nest';
import { createReadingCopyTracker } from './reading-copy';
import { SmartTaskWidget } from './live-preview-task';
import { LIST_PATTERN, PREFIX_REGEX, SPACE_REGEX } from './list-patterns';
import { createHotkeyCleanup } from './hotkey-cleanup';
import { liveCalloutPlugin } from './live-callout';
import { liveHeaderAlignment } from './live-header-alignment';
import { registerIndentationProfile } from './reading-indentation';
import { applyReadingNestDistances, type ReadingAlignmentLine } from './reading-alignment';
import { ReadingHeaderObserver } from './reading-header-observer';
import { DEFAULT_SETTINGS, normalizeSettings, type SmartOrderListSettings } from './settings';
import { SmartOrderListSettingTab } from './settings-tab';
import { isElement, isHtmlElement } from './dom-type-guards';

// --- CHINESE NUMERAL DICTIONARY ---
const ZH_DIGITS =['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function toChinese(num: number): string {
    if (num <= 10) return ZH_DIGITS[num] || '零';
    if (num < 20) return '十' + (num % 10 === 0 ? '' : (ZH_DIGITS[num % 10] || ''));
    if (num < 100) return (ZH_DIGITS[Math.floor(num / 10)] || '') + '十' + (num % 10 === 0 ? '' : (ZH_DIGITS[num % 10] || ''));
    if (num === 100) return '一百';
    return num.toString();
}

function fromChinese(str: string): number {
    // Any numeral containing these units is outside the supported 1–100 range.
    if (/[万亿]/.test(str)) return Number.POSITIVE_INFINITY;
    let total = 0;
    let digit: number | null = null;
    let previousUnit = 10000;
    for (const char of str) {
        const index = ZH_DIGITS.indexOf(char);
        if (index >= 0 && index < 10) {
            if (index === 0) {
                if (digit !== null) return Number.NaN;
                continue;
            }
            if (digit !== null) return Number.NaN;
            digit = index;
            continue;
        }
        const unit = char === '十' ? 10 : char === '百' ? 100 : char === '千' ? 1000 : 0;
        if (!unit || unit >= previousUnit) return Number.NaN;
        if (digit === null && (unit !== 10 || total !== 0)) return Number.NaN;
        total += (digit ?? 1) * unit;
        digit = null;
        previousUnit = unit;
    }
    return total + (digit ?? 0);
}

// --- CORE LOGIC: Parsing and Formatting Tokens ---
type TokenType = 'number' | 'upper' | 'lower' | 'chinese' | 'paren';

interface Token {
    type: TokenType;
    value: number;
}

interface StackItem {
    tokens: Token[];
    markerType: string;
    isUnordered?: boolean;
}

interface ParsedLine {
    isOrphan: boolean;
    fallbackToBullet?: boolean;
    marker: string;
    spaces: string;
    depth: number;
    text?: string;
    expectedPrefix?: string;
    prefix?: string;
    isNativeOrdered?: boolean;
    isNativeUnordered?: boolean;
    taskTail?: string;
    quoteScope: ListScope;
}

const SmartListSync = Annotation.define<boolean>();

function parseTokens(prefix: string): Token[] {
    if (!prefix) return[];
    if (prefix.startsWith('(') && prefix.endsWith(')')) return[{ type: 'paren', value: parseInt(prefix.slice(1, -1)) || 1 }];
    if (prefix.endsWith('、')) return[{ type: 'chinese', value: fromChinese(prefix.slice(0, -1)) }];

    const cleanPrefix = prefix.replace(/\.$/, '');

    return cleanPrefix.split('.').filter(t => t.length > 0).map(t => {
        if (/^[0-9]+$/.test(t)) return { type: 'number', value: parseInt(t) };
        if (/^[A-Z]$/.test(t)) return { type: 'upper', value: t.charCodeAt(0) - 64 };
        if (/^[a-z]$/.test(t)) return { type: 'lower', value: t.charCodeAt(0) - 96 };
        return { type: 'number', value: 1 };
    });
}

function ensureReadingCollapseIndicator(item: HTMLElement): void {
    item.classList.add('has-list-children');
    if (item.querySelector('.list-collapse-indicator')) return;

    const collapseDiv = item.createDiv();
    collapseDiv.className = 'list-collapse-indicator collapse-indicator collapse-icon';
    const svg = item.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'right-triangle');
    svg.setAttribute('width', '8');
    svg.setAttribute('height', '8');
    const path = item.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M82.32,49.61L25.33,16.72c-1.39-0.8-3.1-0.8-4.49,0c-1.39,0.8-2.25,2.28-2.25,3.89v65.78c0,1.61,0.86,3.09,2.25,3.89 c0.69,0.4,1.47,0.6,2.25,0.6c0.77,0,1.55-0.2,2.24-0.6l56.99-32.89c1.39-0.8,2.25-2.28,2.25-3.89 C84.57,51.89,83.71,50.41,82.32,49.61z');
    svg.appendChild(path);
    collapseDiv.appendChild(svg);
    item.insertBefore(collapseDiv, item.firstChild);
}

function getReadingParentLines(
    parsedLines: Record<number, ParsedLine>,
    startLine: number,
    endLine: number
): Map<number, number> {
    const ancestorsByScope = new Map<ListScope, Map<number, number>>();
    const parentByLine = new Map<number, number>();

    for (let line = startLine; line <= endLine; line++) {
        const lineData = parsedLines[line];
        if (!lineData) continue;

        let ancestors = ancestorsByScope.get(lineData.quoteScope);
        if (!ancestors) {
            ancestors = new Map<number, number>();
            ancestorsByScope.set(lineData.quoteScope, ancestors);
        }

        if (lineData.depth === 1) {
            ancestors.clear();
            ancestors.set(1, line);
            continue;
        }

        for (const depth of ancestors.keys()) {
            if (depth >= lineData.depth) ancestors.delete(depth);
        }
        const parentLine = ancestors.get(lineData.depth - 1);
        if (parentLine !== undefined) parentByLine.set(line, parentLine);
        ancestors.set(lineData.depth, line);
    }

    return parentByLine;
}

/** Reconcile mixed native/generated rows to the parent implied by their source depth. */
function repairReadingCustomHierarchy(
    element: HTMLElement,
    parsedLines: Record<number, ParsedLine>,
    readingItems: Map<number, HTMLElement>,
    nativeItems: Map<number, HTMLElement>,
    parentByLine: Map<number, number>,
    startLine: number,
    endLine: number
): void {
    const lineByItem = new Map<HTMLElement, number>();
    for (const [line, item] of nativeItems) lineByItem.set(item, line);
    for (const [line, item] of readingItems) lineByItem.set(item, line);

    for (let line = startLine; line <= endLine; line++) {
        const lineData = parsedLines[line];
        const item = readingItems.get(line) ?? nativeItems.get(line);
        const parentLine = parentByLine.get(line);
        if (!lineData || !item || parentLine === undefined) continue;

        const parentItem = readingItems.get(parentLine) ?? nativeItems.get(parentLine);
        if (!parentItem || parentItem === item || item.contains(parentItem)) continue;
        if (!item.classList.contains('smart-list-custom-reading') &&
            !parentItem.classList.contains('smart-list-custom-reading')) continue;

        const nativeTaskHeader = item === nativeItems.get(line) && /^[-*+]\s+\[/.test(lineData.marker);
        const listTag = lineData.isOrphan || lineData.fallbackToBullet || nativeTaskHeader ? 'UL' : 'OL';
        const existingLists = Array.from(parentItem.children).filter((child): child is HTMLElement =>
            isHtmlElement(child) && child.tagName === listTag
        );
        let childList = existingLists.find(list => list.classList.contains('smart-list-reading-child')) ?? existingLists[0];
        if (!childList) {
            childList = parentItem.createEl(listTag === 'UL' ? 'ul' : 'ol');
            if (listTag === 'UL') childList.classList.add('has-list-bullet', 'el-ul');
            else childList.classList.add('el-ol');
        }
        childList.classList.add('smart-list-reading', 'smart-list-reading-child');

        const oldList = item.parentElement;
        if (oldList !== childList) {
            childList.appendChild(item);
            if (isHtmlElement(oldList) &&
                (oldList.tagName === 'OL' || oldList.tagName === 'UL') &&
                oldList.classList.contains('smart-list-reading-child') &&
                oldList.children.length === 0) {
                const oldParent = oldList.parentElement;
                oldList.remove();
                if (isHtmlElement(oldParent) && oldParent.tagName === 'LI' &&
                    !Array.from(oldParent.children).some(child => child.tagName === 'OL' || child.tagName === 'UL')) {
                    oldParent.classList.remove('has-list-children');
                    oldParent.querySelector('.list-collapse-indicator')?.remove();
                }
            }
        }

        ensureReadingCollapseIndicator(parentItem);
    }

    const getLine = (item: HTMLElement): number => {
        const mappedLine = lineByItem.get(item);
        if (mappedLine !== undefined) return mappedLine;
        const offset = Number(item.getAttribute('data-line'));
        return Number.isFinite(offset) ? startLine + offset : Number.MAX_SAFE_INTEGER;
    };
    for (const list of Array.from(element.querySelectorAll<HTMLElement>('ol.smart-list-reading-child, ul.smart-list-reading-child'))) {
        const items = Array.from(list.children).filter((child): child is HTMLElement =>
            isHtmlElement(child) && child.tagName === 'LI'
        );
        items.sort((a, b) => getLine(a) - getLine(b));
        for (const item of items) list.appendChild(item);
    }
}

function formatTokens(tokens: Token[]): string {
    return tokens.map(t => {
        if (t.type === 'number') return t.value.toString();
        if (t.type === 'upper') return String.fromCharCode(64 + t.value);
        if (t.type === 'lower') return String.fromCharCode(96 + t.value);
        if (t.type === 'paren') return `(${t.value})`;
        if (t.type === 'chinese') return toChinese(t.value);
        return '1';
    }).join('.');
}

function buildPrefixString(tokens: Token[], originalPrefix: string): string {
    if (tokens.length === 0) return originalPrefix;
    const base = formatTokens(tokens);
    const lastType = tokens[tokens.length - 1]?.type;
    if (lastType === 'chinese') return base + '、';
    if (lastType === 'paren') return base;  
    
    const forceDot = tokens.length === 1;
    return base + (forceDot ? '.' : '');
}

function getIndentLevel(line: string): number {
    const match = line.match(/^([ \t]*)/);
    if (!match) return 0;
    const spaces = (match[1] || '').replace(/\t/g, '    ');
    return Math.floor(spaces.length / 4);
}

function isLineInFencedCode(state: EditorState, lineNum: number): boolean {
    const scopes = createListScopes();
    for (let i = 1; i <= lineNum; i++) {
        const raw = state.doc.line(i).text;
        const previous = i > 1 ? state.doc.line(i - 1).text : undefined;
        const line = advanceListScope(scopes, raw, previous);
        if (i === lineNum) return line.inCode;
    }
    return false;
}

function isConsecutionBreaker(text: string, previousText?: string): boolean {
    if (text.trim() === '') return false;
    if (/^([ \t]*)(```|~~~)/.test(text)) return true; // RESTORED: Cuts off external consecution
    if (/^([ \t]*)#+\s/.test(text)) return true;
    if (/^([ \t]*)(---|___|\*\*\*)[ \t]*$/.test(text)) return true;
    if (isCalloutHeader(text)) return isIndependentCallout(text, previousText);

    return false;
}

interface ListScope {
    stack: (StackItem | null)[];
    fence: FenceState | null;
    crossedDependentCallout: boolean;
    isCallout: boolean;
}

function createListScopes(): QuoteContextStacks<ListScope> {
    return new QuoteContextStacks(() => ({ stack: [], fence: null, crossedDependentCallout: false, isCallout: false }));
}

function advanceListScope(scopes: QuoteContextStacks<ListScope>, raw: string, previous?: string) {
    const quote = parseQuoteLine(raw);
    // A fence in an enclosing context treats apparent deeper quote markers as code.
    for (let depth = 0; depth < quote.depth; depth++) {
        const enclosing = scopes.peek(depth);
        if (enclosing?.fence) return { ...quote, scope: enclosing, skip: true, inCode: true };
    }
    let scope = scopes.select(quote.depth);
    if (!scope.fence && isCalloutHeader(raw)) {
        if (quote.depth === 1) {
            const independent = isIndependentCallout(raw, previous);
            const outer = scopes.peek(0)!;
            if (independent) {
                outer.stack.length = 0;
                outer.crossedDependentCallout = false;
            } else {
                outer.crossedDependentCallout = true;
            }
        }
        scope = scopes.reset(quote.depth);
        scope.isCallout = true;
        return { ...quote, scope, skip: true, inCode: false };
    }
    const fence = consumeFence(quote.content, scope.fence);
    if (fence.inCode) {
        if (!scope.fence && fence.fence) scope.stack.length = 0;
        scope.fence = fence.fence;
        return { ...quote, scope, skip: true, inCode: true };
    }
    if (isConsecutionBreaker(quote.content, previous)) {
        scope.stack.length = 0;
        scope.crossedDependentCallout = false;
        return { ...quote, scope, skip: true, inCode: false };
    }
    return { ...quote, scope, skip: quote.content.trim() === '', inCode: false };
}

// --- PREFIX REWRITE MECHANISM ---
function rewritePrefix(indent: string, marker: string, prefix: string, content: string): { changed: boolean, newText: string } {
    const isPureBullet = /^[-*+]\s+$/.test(marker);
    const isNumeralMarker = /^[0-9]+\.\s+$/.test(marker);

    if (isPureBullet) {
        return { changed: true, newText: `${indent}${marker}${content}` };
    }

    if (isNumeralMarker) {
        const tokens = parseTokens(prefix);
        const lastType = tokens.length > 0 ? tokens[tokens.length - 1]?.type : null;
        const isNumeralType = lastType === 'number' || lastType === 'paren';

        if (isNumeralType) {
            return { changed: true, newText: `${indent}${content}` }; 
        } else {
            return { changed: true, newText: `${indent}${marker}${content}` }; 
        }
    }

    return { changed: false, newText: "" };
}

function hasOutOfRangeElement(tokens: Token[]): boolean {
    return tokens.some(token => {
        if (!Number.isSafeInteger(token.value)) return true;
        if (token.type === 'number') return token.value < 0;
        if (token.type === 'paren') return token.value < 1;
        if (token.type === 'upper' || token.type === 'lower') return token.value < 1 || token.value > 26;
        return token.value < 1 || token.value > 100;
    });
}

function hasMixedZero(tokens: Token[]): boolean {
    return tokens.some(token => token.type === 'number' && token.value === 0) &&
        tokens.some(token => token.type !== 'number');
}

function isRollbackNeeded(tokens: Token[]): boolean {
    if (tokens.length > 4) return true;
    if (tokens.length > 1 && tokens.some(token => token.type === 'paren' || token.type === 'chinese')) {
        return true;
    }
    return hasOutOfRangeElement(tokens) || hasMixedZero(tokens);
}

// --- HIERARCHY STACK ---
function buildTokenScopes(state: EditorState, upToLine: number): QuoteContextStacks<ListScope> {
    const scopes = createListScopes();

    for (let i = 1; i < upToLine; i++) {
        const raw = state.doc.line(i).text;
        const previous = i > 1 ? state.doc.line(i - 1).text : undefined;
        const line = advanceListScope(scopes, raw, previous);
        if (line.skip) continue;
        const text = line.content;
        const stack = line.scope.stack;

        const isPureBullet = /^([ \t]*)([-*+])\s+/.test(text) && !PREFIX_REGEX.test(text);
        const isSmartList = PREFIX_REGEX.test(text);
        if (!isPureBullet && !isSmartList) continue;

        if (isPureBullet) {
            const lvl = getIndentLevel(text);
            stack[lvl] = { tokens:[], markerType: 'bullet', isUnordered: true };
            stack.splice(lvl + 1);
            continue;
        }

        const match = text.match(PREFIX_REGEX);
        if (match) {
            const lvl = getIndentLevel(text);
            const marker = match[2] || '';
            const prefix = match[3] || '';
            const currentMarkerType = /^[-*+]\s+\[[ xX-]\]\s+$/.test(marker) ? 'checkbox' : 'none';
            const tokens = parseTokens(prefix);

            const prevSameLevel = stack[lvl];
            if (prevSameLevel) {
                const prevLast = prevSameLevel.tokens[prevSameLevel.tokens.length - 1];
                const currLast = tokens[tokens.length - 1];
                const isInconsistent =
                    currentMarkerType !== prevSameLevel.markerType ||
                    tokens.length !== prevSameLevel.tokens.length ||
                    (prevLast && currLast && currLast.type !== prevLast.type);

                if (isInconsistent) {
                    stack[lvl] = null;
                    stack.splice(lvl + 1); 
                }
            }

            stack[lvl] = { tokens, markerType: currentMarkerType };
            stack.splice(lvl + 1);
        }
    }
    return scopes;
}

function buildTokenStack(state: EditorState, upToLine: number): (StackItem | null)[] {
    const scopes = buildTokenScopes(state, upToLine);
    const depth = parseQuoteLine(state.doc.line(upToLine).text).depth;
    return scopes.select(depth).stack;
}

// --- ERROR CORRECTION ENGINE ---
function getNextTokens(userTokens: Token[], tokenStack: (StackItem | null)[], indentLevel: number, marker: string, nesting = false): Token[] {
    const prevSameLevel = tokenStack[indentLevel];
    // A stored same-element zero represents the user's manual introduction.
    const manualZero = !nesting && userTokens.length > 0 && userTokens.every(token => token.type === 'number') &&
        userTokens[userTokens.length - 1]?.value === 0;
    let expectedTokens: Token[];

    if (prevSameLevel && prevSameLevel.tokens.length > 0) {
        const lastUser = userTokens[userTokens.length - 1];
        const prevLast = prevSameLevel.tokens[prevSameLevel.tokens.length - 1];

        const isDifferentStyle =
            userTokens.length !== prevSameLevel.tokens.length ||
            lastUser?.type !== prevLast?.type;

        if (isDifferentStyle) {
            const resetTokens = userTokens.map(t => ({ ...t }));
            const lastReset = resetTokens[resetTokens.length - 1];
            if (lastReset) lastReset.value = manualZero ? 0 : 1;
            return resetTokens;
        }

        expectedTokens = prevSameLevel.tokens.map(t => ({ ...t }));
        const lastIdx = expectedTokens.length - 1;
        const lastExpected = expectedTokens[lastIdx];
        if (lastExpected) {
            expectedTokens[lastIdx] = { ...lastExpected, value: lastExpected.value + 1 };
        }
        return expectedTokens;
    }

    let parentItem: StackItem | null = null;
    for (let i = indentLevel - 1; i >= 0; i--) {
        const stackItem = tokenStack[i];
        if (stackItem) {
            parentItem = stackItem;
            break;
        }
    }

    if (parentItem && !parentItem.isUnordered && parentItem.tokens.length > 0) {
        if (decideCrossNest(parentItem.tokens, userTokens, nesting) === 'overwrite') {
            const requested = userTokens[userTokens.length - 1];
            if (requested) return [{ ...requested, value: manualZero ? 0 : 1 }];
        }
        let newType: Token['type'] = 'number';
        if (userTokens.length > parentItem.tokens.length) {
            newType = userTokens[parentItem.tokens.length]?.type || 'number';
        } else if (userTokens.length > 0) {
            newType = userTokens[userTokens.length - 1]?.type || 'number';
        }
        const keepZero = manualZero && newType === 'number' && parentItem.tokens.every(token => token.type === 'number');
        expectedTokens =[...parentItem.tokens.map(t => ({ ...t })), { type: newType, value: keepZero ? 0 : 1 }];
    } else {
        const firstType = userTokens[0]?.type || 'number';
        expectedTokens = [{ type: firstType, value: manualZero && userTokens.length === 1 ? 0 : 1 }];
    }

    return expectedTokens;
}

// --- LIVE PREVIEW DECORATOR ---
function selectionIntersectsTaskMarker(state: EditorState, marker: { from: number; to: number }): boolean {
    return state.selection.ranges.some(range => {
        if (range.from === range.to) {
            // A caret on either boundary is outside the replaced marker characters.
            return range.from > marker.from && range.from < marker.to;
        }
        return range.from < marker.to && range.to > marker.from;
    });
}

// Match only the task marker and ordered prefix. The list body may contain
// inline math or other syntax that should not affect checkbox recognition.
const MULTI_SLOT_TASK_PREFIX_REGEX = /^([ \t]*)([-*+]\s+\[[ xX-]\]\s+)((?:[1-9][0-9]*|[a-zA-Z])(?:\.(?:[1-9][0-9]*|[a-zA-Z])){2,3})(?=[ \t]+)/;
const NUMERAL_TASK_PREFIX_WITH_ZERO_REGEX = /^([ \t]*)([-*+]\s+\[[ xX-]\]\s+)((?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2,3})(?=[ \t]+)/;

const listMarkerDecorator = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private taskMarkers: { from: number; to: number }[] = [];
    constructor(view: EditorView) { this.decorations = this.buildDecorations(view); }
    update(update: ViewUpdate) {
        const markerSelectionChanged = update.selectionSet && this.taskMarkers.some(marker =>
            selectionIntersectsTaskMarker(update.startState, marker) !== selectionIntersectsTaskMarker(update.state, marker));
        if (update.docChanged || update.viewportChanged || update.focusChanged || markerSelectionChanged) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    buildDecorations(view: EditorView) {
        const decorations: Range<Decoration>[] = [];
        const state = view.state;
        this.taskMarkers = [];
        // Inline widgets (such as rendered math) can split visibleRanges in
        // the middle of one logical line. Decoration work is line-based, so
        // emit each line's decorations only once even if several ranges cover it.
        const decoratedLines = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
            const startLineNum = state.doc.lineAt(from).number;
            const endLineNum = state.doc.lineAt(to).number;

            let blockStart = startLineNum;
            while (blockStart > 1) {
                const previous = blockStart > 2 ? state.doc.line(blockStart - 2).text : undefined;
                if (isConsecutionBreaker(state.doc.line(blockStart - 1).text, previous)) break;
                blockStart--;
            }

            const scopes = buildTokenScopes(state, blockStart);

            for (let i = blockStart; i <= endLineNum; i++) {
                const line = state.doc.line(i);
                const previous = i > 1 ? state.doc.line(i - 1).text : undefined;
                const scoped = advanceListScope(scopes, line.text, previous);
                if (scoped.skip) continue;
                const shouldDecorateLine = i >= startLineNum && !decoratedLines.has(i);
                if (shouldDecorateLine) decoratedLines.add(i);
                const text = scoped.content;
                const tokenStack = scoped.scope.stack;

                // Plain blockquotes do not render task markers following an ordered
                // prefix. Callouts have their own renderer and are left untouched.
                const inCallout = Array.from({ length: scoped.depth }, (_, depth) => scopes.peek(depth + 1))
                    .some(scope => scope?.isCallout);
                if (shouldDecorateLine && scoped.depth > 0 && !inCallout) {
                    const ordered = text.match(PREFIX_REGEX);
                    const task = ordered && !ordered[2] ? (ordered[5] || '').match(/^(\[[ xX-]\])(?=[ \t]|$)/) : null;
                    if (ordered && task) {
                        const markerFrom = line.from + scoped.quotePrefix.length + (ordered[1] || '').length +
                            (ordered[3] || '').length + (ordered[4] || '').length;
                        const markerText = task[1]!;
                        const markerTo = markerFrom + markerText.length;
                        const cursorInside = view.hasFocus && selectionIntersectsTaskMarker(state, { from: markerFrom, to: markerTo });
                        this.taskMarkers.push({ from: markerFrom, to: markerTo });
                        if (!cursorInside) {
                            decorations.push(Decoration.replace({ widget: new SmartTaskWidget(markerFrom, markerText, 'tail') })
                                .range(markerFrom, markerTo));
                        }
                    }
                }

                const taskHeaderMatch = text.match(/^([ \t]*)([-*+]\s+\[[ xX-]\])(?:[ \t]+|$)/);
                const multiSlotTaskMatch = text.match(MULTI_SLOT_TASK_PREFIX_REGEX) ?? text.match(NUMERAL_TASK_PREFIX_WITH_ZERO_REGEX);
                if (shouldDecorateLine && scoped.depth === 0 && taskHeaderMatch) {
                    const indent = taskHeaderMatch[1] || '';
                    const indentLevel = getIndentLevel(text);
                    const ancestorItems = tokenStack.slice(0, indentLevel).reverse().filter((item): item is StackItem => item !== null);
                    const twoSlotParent = ancestorItems.find(item => item.tokens.length === 2);
                    const anyMultiSlotParent = ancestorItems.find(item => item.tokens.length > 1);
                    const validOrderedChild = multiSlotTaskMatch && twoSlotParent && twoSlotParent.markerType !== 'checkbox';
                    const legacyPlainTask = !PREFIX_REGEX.test(text) && anyMultiSlotParent && anyMultiSlotParent.markerType !== 'checkbox';
                    if (validOrderedChild || legacyPlainTask) {
                        const markerFrom = line.from + scoped.quotePrefix.length + indent.length;
                        const markerText = taskHeaderMatch[2] || '';
                        const markerTo = markerFrom + markerText.length;
                        const cursorInside = view.hasFocus && selectionIntersectsTaskMarker(state, { from: markerFrom, to: markerTo });
                        this.taskMarkers.push({ from: markerFrom, to: markerTo });
                        if (!cursorInside) {
                            decorations.push(Decoration.replace({ widget: new SmartTaskWidget(markerFrom, markerText) }).range(markerFrom, markerTo));
                        }
                    }
                }

                const pbMatch = text.match(/^([ \t]*)([-*+])(\s+)/);
                if (pbMatch && !PREFIX_REGEX.test(text)) {
                    const lvl = getIndentLevel(text);
                    tokenStack[lvl] = { tokens:[], markerType: 'bullet', isUnordered: true };
                    tokenStack.splice(lvl + 1);

                    if (shouldDecorateLine) {
                        const indent = pbMatch[1] || '';
                        const markerChar = pbMatch[2] || '';
                        const spaces = pbMatch[3] || '';
                        const start = line.from + scoped.quotePrefix.length + indent.length;
                        const depth = getIndentLevel(text) + 1;
                        const visualDepth = ((depth - 1) % 3) + 1;

                        let hasNativeListMark = false;
                        let n: SyntaxNode | null = syntaxTree(state).resolveInner(start + 1, -1);
                        
                        while (n) {
                            if (n.name.includes("bullet") || n.name.includes("formatting-list") || n.name === "ListMark") {
                                hasNativeListMark = true;
                                break;
                            }
                            if (n.name.includes("line") || n.name.includes("paragraph") || n.name.match(/^list-\d+$/) || n.name === "ListItem" || n.name === "Document") {
                                break;
                            }
                            n = n.parent;
                        }

                        const taskMarkerReplaced = taskHeaderMatch !== null && this.taskMarkers.some(marker => marker.from === start);
                        if (!hasNativeListMark && !taskMarkerReplaced) {
                            decorations.push(Decoration.mark({ class: "list-bullet" }).range(start, start + 1));
                            decorations.push(Decoration.mark({
                                class: `cm-formatting cm-formatting-list cm-formatting-list-ul cm-list-${visualDepth}`
                            }).range(start, start + markerChar.length + spaces.length));
                        }
                    }
                    continue; 
                }

                const match = text.match(PREFIX_REGEX);
                if (match) {
                    const indent = match[1] || '';
                    const marker = match[2] || '';
                    const prefix = match[3] || '';
                    const spaces = match[4] || ''; 
                    const start = line.from + scoped.quotePrefix.length + indent.length + marker.length;
                    const depth = getIndentLevel(text) + 1;
                    const visualDepth = ((depth - 1) % 3) + 1;
                    const indentLevel = depth - 1;

                    const userTokens = parseTokens(prefix);
                    const currentMarkerType = /^[-*+]\s+\[[ xX-]\]\s+$/.test(marker) ? 'checkbox' : 'none';

                    const prevSameLevel = tokenStack[indentLevel];
                    if (prevSameLevel) {
                        const lastUser = userTokens[userTokens.length - 1];
                        const prevLast = prevSameLevel.tokens[prevSameLevel.tokens.length - 1];
                        const isDifferentStyle = (userTokens.length !== prevSameLevel.tokens.length) || 
                                                 (lastUser?.type !== prevLast?.type) || 
                                                 (currentMarkerType !== prevSameLevel.markerType);
                        if (isDifferentStyle) {
                            tokenStack[indentLevel] = null;
                            tokenStack.splice(indentLevel + 1);
                        }
                    }

                    const expectedTokens = getNextTokens(userTokens, tokenStack, indentLevel, marker);
                    const fallbackToBullet = isRollbackNeeded(userTokens) || isRollbackNeeded(expectedTokens);
                    const expectedPrefix = fallbackToBullet ? prefix : buildPrefixString(expectedTokens, prefix);

                    tokenStack[indentLevel] = fallbackToBullet
                        ? { tokens: [], markerType: 'bullet', isUnordered: true }
                        : { tokens: expectedTokens, markerType: currentMarkerType };
                    tokenStack.splice(indentLevel + 1);

                    if (shouldDecorateLine) {
                        const isNativeOrdered = /^(?:0|[1-9][0-9]*)\.$/.test(prefix) && marker === '';

                        if (isNativeOrdered && (expectedPrefix !== prefix || scoped.scope.crossedDependentCallout)) {
                            decorations.push(Decoration.mark({
                                class: `smart-list-prefix smart-list-override`,
                                attributes: { "data-expected": expectedPrefix + spaces }
                            }).range(start, start + prefix.length + spaces.length));
                        } 
                        else if (!isNativeOrdered || depth > 3) {
                            decorations.push(Decoration.mark({
                                class: `cm-formatting cm-formatting-list cm-formatting-list-ol cm-list-${visualDepth}`
                            }).range(start, start + prefix.length + spaces.length));
                            decorations.push(Decoration.mark({
                                class: `list-number smart-list-prefix${marker ? '' : ' smart-list-align-header'}`
                            }).range(start, start + prefix.length));
                        } else if (depth > 1) {
                            // A numeric child may not be recognized as a native
                            // list mark when its parent is a custom prefix.
                            decorations.push(Decoration.mark({ class: 'smart-list-prefix' }).range(start, start + prefix.length));
                        }
                    }
                } 
            }
        }
        // Visible ranges and same-position widget/mark decorations can be
        // discovered in a different order. CodeMirror requires sorted ranges.
        return Decoration.set(decorations, true);
    }
}, { decorations: v => v.decorations });


// --- AUTO-REFRESH ENGINE ---

// NEW: Define a type that includes the internal `isDestroyed` property.
// This is a safe, accepted way to access internal CodeMirror properties without using `any`.
interface EditorViewWithDestroyed extends EditorView {
    isDestroyed: boolean;
}

const autoRefreshPlugin = ViewPlugin.fromClass(class {
    timeout: number | null = null;
    update(update: ViewUpdate) {
        if (update.docChanged && update.view.hasFocus) {
            if (update.transactions.some(tr => tr.annotation(SmartListSync))) return;
            if (this.timeout) window.clearTimeout(this.timeout);
            this.timeout = window.setTimeout(() => {
                if (!((update.view as EditorViewWithDestroyed).isDestroyed)) {
                    autoFormatVisibleRanges(update.view);
                }
            }, 300);
        }
    }
});

function autoFormatVisibleRanges(view: EditorView) {
    const state = view.state;
    const changes: ChangeSpec[] =[];
    const processedLines = new Set<number>();
    let hasRewrites = false;

    for (const { from, to } of view.visibleRanges) {
        const startLine = state.doc.lineAt(from).number;
        const endLine = state.doc.lineAt(to).number;

        const visibleScopes = buildTokenScopes(state, startLine);

        for (let i = startLine; i <= endLine; i++) {
            const line = state.doc.line(i);
            const previous = i > 1 ? state.doc.line(i - 1).text : undefined;
            const visible = advanceListScope(visibleScopes, line.text, previous);
            if (processedLines.has(i)) continue;
            if (visible.skip) { processedLines.add(i); continue; }

            const isPureBullet = /^([ \t]*)([-*+])\s+/.test(visible.content) && !PREFIX_REGEX.test(visible.content);
            if (isPureBullet) { processedLines.add(i); continue; }

            if (!PREFIX_REGEX.test(visible.content)) { processedLines.add(i); continue; }

            let blockStart = i;
            while (blockStart > 1) {
                const blockLineText = state.doc.line(blockStart - 1).text;
                const previousBlockLine = blockStart > 2 ? state.doc.line(blockStart - 2).text : undefined;
                if (isConsecutionBreaker(blockLineText, previousBlockLine)) break;
                blockStart--;
            }

            let blockEnd = i;
            while (blockEnd < state.doc.lines) {
                const blockLineText = state.doc.line(blockEnd + 1).text;
                if (isConsecutionBreaker(blockLineText, state.doc.line(blockEnd).text)) break;
                blockEnd++;
            }

            const scopes = buildTokenScopes(state, blockStart);

            for (let j = blockStart; j <= blockEnd; j++) {
                processedLines.add(j);
                const blockLine = state.doc.line(j);
                const previousBlockLine = j > 1 ? state.doc.line(j - 1).text : undefined;
                const scoped = advanceListScope(scopes, blockLine.text, previousBlockLine);
                if (scoped.skip) continue;
                const text = scoped.content;
                const tokenStack = scoped.scope.stack;

                const pbMatch = text.match(/^([ \t]*)([-*+])\s+/);
                if (pbMatch && !PREFIX_REGEX.test(text)) {
                    const lvl = getIndentLevel(text);
                    tokenStack[lvl] = { tokens:[], markerType: 'bullet', isUnordered: true };
                    tokenStack.splice(lvl + 1);
                    continue;
                }

                const m = text.match(PREFIX_REGEX);
                if (!m) continue;

                const indentStr = m[1] || '';
                const marker = m[2] || '';
                const userPrefix = m[3] || '';
                const spaces = m[4] || '';
                const content = m[5] || '';
                const indentLevel = getIndentLevel(text);

                const rewrite = rewritePrefix(indentStr, marker, userPrefix, spaces + content);
                if (rewrite.changed) {
                    changes.push({ from: blockLine.from, to: blockLine.to, insert: scoped.quotePrefix + rewrite.newText });
                    hasRewrites = true;
                    tokenStack[indentLevel] = null;
                    tokenStack.splice(indentLevel + 1);
                    continue;
                }

                const userTokens = parseTokens(userPrefix);
                const currentMarkerType = /^[-*+]\s+\[[ xX-]\]\s+$/.test(marker) ? 'checkbox' : 'none';

                const prevSameLevel = tokenStack[indentLevel];
                if (prevSameLevel) {
                    const lastUser = userTokens[userTokens.length - 1];
                    const prevLast = prevSameLevel.tokens[prevSameLevel.tokens.length - 1];
                    const isDifferentStyle = (userTokens.length !== prevSameLevel.tokens.length) || 
                                             (lastUser?.type !== prevLast?.type) || 
                                             (currentMarkerType !== prevSameLevel.markerType);
                    if (isDifferentStyle) {
                        tokenStack[indentLevel] = null;
                        tokenStack.splice(indentLevel + 1);
                    }
                }

                const expectedTokens = getNextTokens(userTokens, tokenStack, indentLevel, marker);

                if (hasOutOfRangeElement(userTokens) || hasMixedZero(userTokens) || isRollbackNeeded(expectedTokens)) {
                    changes.push({ from: blockLine.from, to: blockLine.to, insert: `${scoped.quotePrefix}${indentStr}- ${content}` });
                    hasRewrites = true;
                    tokenStack[indentLevel] = null;
                    tokenStack.splice(indentLevel + 1);
                    continue;
                }

                tokenStack[indentLevel] = { tokens: expectedTokens, markerType: currentMarkerType };
                tokenStack.splice(indentLevel + 1);

                const newPrefix = buildPrefixString(expectedTokens, userPrefix);
                const finalText = scoped.quotePrefix + indentStr + marker + newPrefix + spaces + content;

                if (finalText !== blockLine.text) {
                    changes.push({ from: blockLine.from, to: blockLine.to, insert: finalText });
                    hasRewrites = true;
                }
            }
        }
    }

    if (changes.length > 0) {
        view.dispatch({ 
            changes, 
            annotations: hasRewrites ? undefined : SmartListSync.of(true),
            userEvent: "smartlist.update"
        });
    }
}

// --- SPACE KEY INTERCEPTOR ---
const smartSpacePlugin = Prec.highest(keymap.of([
    {
        key: 'Space',
        run: (view: EditorView) => {
            const state = view.state;
            const selection = state.selection.main;
            if (!selection.empty) return false;

            const line = state.doc.lineAt(selection.from);
            if (isLineInFencedCode(state, line.number)) return false;

            const textBeforeCursor = line.text.slice(0, selection.from - line.from);
            const quoted = parseQuoteLine(textBeforeCursor);
            const match = quoted.content.match(SPACE_REGEX);
            if (!match) return false;

            const indentStr = match[1] || '';
            const marker = match[2] || '';
            const typedPrefix = match[3] || '';

            let isValid = false;
            if (typedPrefix.startsWith('(') && typedPrefix.endsWith(')')) isValid = true;
            else if (typedPrefix.endsWith('、')) isValid = true;
            else {
                const parts = typedPrefix.replace(/\.$/, '').split('.');
                isValid = parts.every(p => /^[0-9]+$/.test(p) || /^[a-zA-Z]$/.test(p));
            }
            if (!isValid) return false;

            const rewrite = rewritePrefix(indentStr, marker, typedPrefix, "");
            if (rewrite.changed) {
                const insertText = quoted.quotePrefix + rewrite.newText.replace(/\s+$/, '') + " ";
                view.dispatch({
                    changes: { from: line.from, to: selection.from, insert: insertText },
                    selection: { anchor: line.from + insertText.length },
                    userEvent: "smartlist.update"
                });
                return true;
            }

            const targetIndentLevel = getIndentLevel(indentStr);
            const tokenStack = buildTokenStack(state, line.number);
            const userTokens = parseTokens(typedPrefix);
            const currentMarkerType = /^[-*+]\s+\[[ xX-]\]\s+$/.test(marker) ? 'checkbox' : 'none';

            const prevSameLevel = tokenStack[targetIndentLevel]; 
            if (prevSameLevel) {
                const lastUser = userTokens[userTokens.length - 1];
                const prevLast = prevSameLevel.tokens[prevSameLevel.tokens.length - 1];
                const isDifferentStyle = (userTokens.length !== prevSameLevel.tokens.length) || 
                                         (lastUser?.type !== prevLast?.type) || 
                                         (currentMarkerType !== prevSameLevel.markerType);
                if (isDifferentStyle) {
                    tokenStack[targetIndentLevel] = null;
                    tokenStack.splice(targetIndentLevel + 1);
                }
            }

            const expectedTokens = getNextTokens(userTokens, tokenStack, targetIndentLevel, marker);

            if (hasOutOfRangeElement(userTokens) || hasMixedZero(userTokens) || isRollbackNeeded(expectedTokens)) {
                const insertText = `${quoted.quotePrefix}${indentStr}- `;
                view.dispatch({
                    changes: { from: line.from, to: selection.from, insert: insertText },
                    selection: { anchor: line.from + insertText.length },
                    userEvent: "smartlist.update"
                });
                return true;
            }

            const nextPrefix = buildPrefixString(expectedTokens, typedPrefix);
            const insertText = `${quoted.quotePrefix}${indentStr}${marker}${nextPrefix} `;

            view.dispatch({
                changes: { from: line.from, to: selection.from, insert: insertText },
                selection: { anchor: line.from + insertText.length },
                userEvent: "smartlist.update"
            });
            return true;
        }
    }
]));

// --- ENTER KEY LOGIC ---
const smartEnterPlugin = Prec.highest(keymap.of([
    {
        key: 'Enter',
        run: (view: EditorView) => {
            const state = view.state;
            const selection = state.selection.main;
            if (!selection.empty) return false;

            const line = state.doc.lineAt(selection.from);

            if (isLineInFencedCode(state, line.number)) {
                if (PREFIX_REGEX.test(line.text) || /^[ \t]*([-*+]|[0-9]+\.)\s/.test(line.text)) {
                    const indentMatch = line.text.match(/^([ \t]*)/);
                    const baseIndent = (indentMatch && indentMatch[1]) || '';
                    view.dispatch({
                        changes: { from: selection.from, to: selection.from, insert: '\n' + baseIndent },
                        selection: { anchor: selection.from + 1 + baseIndent.length },
                        userEvent: "smartlist.update"
                    });
                    return true;
                }
                return false;
            }

            const textBeforeCursor = line.text.slice(0, selection.from - line.from);
            const textAfterCursor = line.text.slice(selection.from - line.from);

            const quoted = parseQuoteLine(textBeforeCursor);
            const match = quoted.content.match(PREFIX_REGEX);
            if (!match) return false;

            const indentStr = match[1] || '';
            const marker = match[2] || '';
            const prefix = match[3] || '';
            const spaces = match[4] || ' ';
            const content = match[5] || '';

            if (content.trim() === '' && textAfterCursor.trim() === '') {
                if (getIndentLevel(quoted.content) > 0) return handleIndent(view, -1);
                view.dispatch({ changes: { from: line.from + quoted.quotePrefix.length, to: line.to, insert: '' }, userEvent: "smartlist.update" });
                return true;
            }

            const tokens = parseTokens(prefix);
            if (tokens.length === 0) return false;

            const lastToken = tokens[tokens.length - 1];
            if (lastToken) lastToken.value++;

            if (isRollbackNeeded(tokens)) {
                const insertText = `\n${quoted.quotePrefix}${indentStr}- `;
                view.dispatch({
                    changes: { from: selection.from, to: selection.from, insert: insertText },
                    selection: { anchor: selection.from + insertText.length },
                    userEvent: "smartlist.update"
                });
                return true;
            }

            const nextPrefix = buildPrefixString(tokens, prefix);
            let nextMarker = marker.replace(/\[[xX-]\]/, '[ ]');
            let nextContentCb = '';

            if (!marker) {
                const cbMatch = content.match(/^((?:[-*+]\s+)?\[[ xX-]\]\s+)/);
                if (cbMatch) {
                    nextContentCb = (cbMatch[1] || '').replace(/\[[xX-]\]/, '[ ]');
                }
            }

            const insertText = `\n${quoted.quotePrefix}${indentStr}${nextMarker}${nextPrefix}${spaces}${nextContentCb}`;

            view.dispatch({
                changes: { from: selection.from, to: selection.from, insert: insertText },
                selection: { anchor: selection.from + insertText.length },
                userEvent: "smartlist.update"
            });
            return true;
        }
    }
]));

// --- TAB / SHIFT-TAB KEY LOGIC ---
const smartTabPlugin = Prec.highest(keymap.of([
    { key: 'Tab', run: (view: EditorView) => handleIndent(view, 1) },
    { key: 'Shift-Tab', run: (view: EditorView) => handleIndent(view, -1) }
]));

function handleIndent(view: EditorView, dir: 1 | -1): boolean {
    const state = view.state;
    const selection = state.selection.main;
    if (isLineInFencedCode(state, state.doc.lineAt(selection.from).number)) return false;

    const fromLine = state.doc.lineAt(selection.from);
    const toLine = state.doc.lineAt(selection.to);

    let isList = false;
    for (let i = fromLine.number; i <= toLine.number; i++) {
        if (PREFIX_REGEX.test(parseQuoteLine(state.doc.line(i).text).content)) { isList = true; break; }
    }
    if (!isList) return false;

    let startLineNum = fromLine.number;
    while (startLineNum > 1) {
        const previous = startLineNum > 2 ? state.doc.line(startLineNum - 2).text : undefined;
        if (isConsecutionBreaker(state.doc.line(startLineNum - 1).text, previous)) break;
        startLineNum--;
    }

    let endLineNum = toLine.number;
    while (endLineNum < state.doc.lines) {
        if (isConsecutionBreaker(state.doc.line(endLineNum + 1).text, state.doc.line(endLineNum).text)) break;
        endLineNum++;
    }

    const changes: ChangeSpec[] =[];
    let hasRewrites = false;
    const scopes = buildTokenScopes(state, startLineNum);

    for (let i = startLineNum; i <= endLineNum; i++) {
        const line = state.doc.line(i);
        const previous = i > 1 ? state.doc.line(i - 1).text : undefined;
        const scoped = advanceListScope(scopes, line.text, previous);
        if (scoped.skip) continue;
        const tokenStack = scoped.scope.stack;
        let text = scoped.content;
        let convertedToUnordered = false;

        if (i >= fromLine.number && i <= toLine.number) {
            const match = text.match(/^([ \t]*)(.*)$/);
            if (match) {
                let newIndent = match[1] || '';
                if (dir === 1) newIndent += '\t';
                else {
                    if (newIndent.endsWith('\t')) newIndent = newIndent.slice(0, -1);
                    else if (newIndent.endsWith('    ')) newIndent = newIndent.slice(0, -4);
                    else if (newIndent.length > 0) newIndent = newIndent.slice(0, Math.max(0, newIndent.length - 4));
                }

                let newText = newIndent + (match[2] || '');

                if (dir === -1) {
                    const targetIndentLevel = getIndentLevel(newIndent);
                    let prevListLine = '';
                    for (let k = i - 1; k >= 1; k--) {
                        const previousQuote = parseQuoteLine(state.doc.line(k).text);
                        if (previousQuote.depth !== scoped.depth) break;
                        const lineText = previousQuote.content;
                        if (lineText.trim() === '') continue;
                        const level = getIndentLevel(lineText);
                        if (level <= targetIndentLevel) { prevListLine = lineText; break; }
                    }

                    const isPureUnordered = /^([ \t]*)([-*+]\s+\[[ xX-]\]|[-*+])\s+/.test(prevListLine) && !PREFIX_REGEX.test(prevListLine);
                    if (isPureUnordered) {
                        const marker = prevListLine.match(/^([ \t]*)([-*+]\s+\[[ xX-]\]|[-*+])\s+/)?.[2];
                        const currMatch = (match[2] || '').match(new RegExp(`^([-*+]\\s+\\[[ xX-]\\]\\s+)?${LIST_PATTERN}(\\s+)(.*)$`));
                        if (marker && currMatch) {
                            newText = newIndent + marker + ' ' + (currMatch[3] || '') + (currMatch[4] || '');
                            convertedToUnordered = true;
                        }
                    }
                }
                text = newText;
            }
        }

        if (text.trim() === '') continue;

        if (convertedToUnordered) {
            tokenStack.length = 0;
            if (scoped.quotePrefix + text !== line.text) changes.push({ from: line.from, to: line.to, insert: scoped.quotePrefix + text });
            continue;
        }

        const pbMatch = text.match(/^([ \t]*)([-*+])\s+/);
        if (pbMatch && !PREFIX_REGEX.test(text)) {
            const lvl = getIndentLevel(text);
            tokenStack[lvl] = { tokens:[], markerType: 'bullet', isUnordered: true };
            tokenStack.splice(lvl + 1);
            if (scoped.quotePrefix + text !== line.text) changes.push({ from: line.from, to: line.to, insert: scoped.quotePrefix + text });
            continue;
        }

        const match = text.match(PREFIX_REGEX);
        if (!match) {
            if (scoped.quotePrefix + text !== line.text) changes.push({ from: line.from, to: line.to, insert: scoped.quotePrefix + text });
            continue;
        }

        const indentStr = match[1] || '';
        const marker = match[2] || '';
        const userPrefix = match[3] || '';
        const spaces = match[4] || '';
        const content = match[5] || '';
        const indentLevel = getIndentLevel(text);

        const rewrite = rewritePrefix(indentStr, marker, userPrefix, spaces + content);
        if (rewrite.changed) {
            changes.push({ from: line.from, to: line.to, insert: scoped.quotePrefix + rewrite.newText });
            hasRewrites = true;
            tokenStack[indentLevel] = null;
            tokenStack.splice(indentLevel + 1);
            continue;
        }

        const userTokens = parseTokens(userPrefix);
        const currentMarkerType = /^[-*+]\s+\[[ xX-]\]\s+$/.test(marker) ? 'checkbox' : 'none';

        const prevSameLevel = tokenStack[indentLevel];
        if (prevSameLevel) {
            const lastUser = userTokens[userTokens.length - 1];
            const prevLast = prevSameLevel.tokens[prevSameLevel.tokens.length - 1];
            const isDifferentStyle = (userTokens.length !== prevSameLevel.tokens.length) || 
                                     (lastUser?.type !== prevLast?.type) || 
                                     (currentMarkerType !== prevSameLevel.markerType);
            if (isDifferentStyle) {
                tokenStack[indentLevel] = null;
                tokenStack.splice(indentLevel + 1);
            }
        }

        const nesting = dir === 1 && i >= fromLine.number && i <= toLine.number;
        const expectedTokens = getNextTokens(userTokens, tokenStack, indentLevel, marker, nesting);

        if (hasOutOfRangeElement(userTokens) || hasMixedZero(userTokens) || isRollbackNeeded(expectedTokens)) {
            changes.push({ from: line.from, to: line.to, insert: `${scoped.quotePrefix}${indentStr}- ${content}` });
            hasRewrites = true;
            tokenStack[indentLevel] = null;
            tokenStack.splice(indentLevel + 1);
            continue;
        }

        tokenStack[indentLevel] = { tokens: expectedTokens, markerType: currentMarkerType };
        tokenStack.splice(indentLevel + 1);

        const newPrefix = buildPrefixString(expectedTokens, userPrefix);
        const finalText = scoped.quotePrefix + indentStr + marker + newPrefix + spaces + content;
        
        if (finalText !== line.text) {
            changes.push({ from: line.from, to: line.to, insert: finalText });
            hasRewrites = true;
        }
    }

    if (changes.length > 0) {
        view.dispatch({ 
            changes, 
            annotations: hasRewrites ? undefined : SmartListSync.of(true),
            userEvent: "smartlist.update"
        });
    }
    return true;
}

export default class SmartOrderListPlugin extends Plugin {
    settings: SmartOrderListSettings = DEFAULT_SETTINGS;

    async onload() {
        console.debug('Loading Smart Order List Plugin');
        const storedSettings: unknown = await this.loadData();
        this.settings = normalizeSettings(storedSettings);
        const storedProfile = storedSettings && typeof storedSettings === 'object'
            ? (storedSettings as Partial<SmartOrderListSettings>).indentationProfile
            : undefined;
        if (storedProfile !== this.settings.indentationProfile) {
            await this.saveData(this.settings);
        }
        this.addSettingTab(new SmartOrderListSettingTab(this.app, this));
        registerIndentationProfile(this, this.settings.indentationProfile);

        const readingCopy = createReadingCopyTracker((doc, callback) =>
            this.registerDomEvent(doc, 'copy', callback, true));

        this.registerEditorExtension([smartEnterPlugin, smartTabPlugin, smartSpacePlugin, autoRefreshPlugin, listMarkerDecorator, liveHeaderAlignment, liveCalloutPlugin, createHotkeyCleanup(isLineInFencedCode)]);

        // --- READING VIEW POST PROCESSOR ---
        this.registerMarkdownPostProcessor((element, context) => {
            const sectionInfo = context.getSectionInfo(element);
            if (!sectionInfo) return;

            const rawLines = sectionInfo.text.split('\n');
            const parsedLines: Record<number, ParsedLine> = {};
            const scopes = createListScopes();

            for (let i = 0; i < rawLines.length; i++) {
                const raw = rawLines[i];
                if (raw === undefined) continue;
                // sectionInfo.text contains the full source text, so i is already
                // the note-level line number used by parsedLines lookups below.
                const absLine = i;

                const scoped = advanceListScope(scopes, raw, i > 0 ? rawLines[i - 1] : undefined);
                if (scoped.skip) continue;
                const text = scoped.content;
                const tokenStack = scoped.scope.stack;

                const pbMatch = text.match(/^([ \t]*)([-*+])(\s+)/);
                if (pbMatch && !PREFIX_REGEX.test(text)) {
                    const indentLevel = getIndentLevel(text);
                    tokenStack[indentLevel] = { tokens:[], markerType: 'bullet', isUnordered: true };
                    tokenStack.splice(indentLevel + 1);
                    const task = text.match(/^([ \t]*)([-*+])\s+\[([ xX-])\](?:[ \t]+|$)/);
                    parsedLines[absLine] = { isOrphan: true, marker: pbMatch[2] || '', spaces: pbMatch[3] || '', depth: indentLevel + 1, taskTail: task?.[3], text, quoteScope: scoped.scope };
                    continue;
                }

                const match = text.match(PREFIX_REGEX);
                if (match) {
                    const marker = match[2] || '';
                    const prefix = match[3] || '';
                    const spaces = match[4] || '';
                    const content = match[5] || '';
                    const indentLevel = getIndentLevel(text);
                    const userTokens = parseTokens(prefix);
                    const currentMarkerType = /^[-*+]\s+\[[ xX-]\]\s+$/.test(marker) ? 'checkbox' : 'none';

                    const prevSameLevel = tokenStack[indentLevel];
                    if (prevSameLevel) {
                        const lastUser = userTokens[userTokens.length - 1];
                        const prevLast = prevSameLevel.tokens[prevSameLevel.tokens.length - 1];
                        const isDifferentStyle = (userTokens.length !== prevSameLevel.tokens.length) || (lastUser?.type !== prevLast?.type) || (currentMarkerType !== prevSameLevel.markerType);
                        if (isDifferentStyle) { tokenStack[indentLevel] = null; tokenStack.splice(indentLevel + 1); }
                    }

                    const expectedTokens = getNextTokens(userTokens, tokenStack, indentLevel, marker);
                    const fallbackToBullet = isRollbackNeeded(userTokens) || isRollbackNeeded(expectedTokens);
                    const expectedPrefix = fallbackToBullet ? undefined : buildPrefixString(expectedTokens, prefix);
                    tokenStack[indentLevel] = fallbackToBullet
                        ? { tokens: [], markerType: 'bullet', isUnordered: true }
                        : { tokens: expectedTokens, markerType: currentMarkerType };
                    tokenStack.splice(indentLevel + 1);

                    const tailTask = !marker ? content.match(/^\[([ xX-])\](?:[ \t]+|$)/) : null;
                    parsedLines[absLine] = { isOrphan: false, fallbackToBullet, expectedPrefix, prefix, marker, spaces, taskTail: tailTask?.[1], isNativeOrdered: /^(?:0|[1-9][0-9]*)\.$/.test(prefix) && marker === '', isNativeUnordered: /^[-*+]\s+$/.test(marker) && !prefix, depth: indentLevel + 1, quoteScope: scoped.scope };
                }
            }

            // 1. Keep Obsidian's native nested-list containers and replace only markers.
            const liElements = Array.from(element.querySelectorAll('li[data-line]'));
            const nativeItems = new Map<number, HTMLElement>();
            for (let i = 0; i < liElements.length; i++) {
                const blockEl = liElements[i];
                if (!blockEl) continue;
                if (isHtmlElement(blockEl)) {
                    blockEl.classList.remove('smart-list-reading-root');
                }
                const startLineNum = parseInt(blockEl.getAttribute('data-line') || '-1');
                const absLine = sectionInfo.lineStart + startLineNum;
                const lineData = parsedLines[absLine];
                if (startLineNum >= 0 && isHtmlElement(blockEl)) nativeItems.set(absLine, blockEl);
                
                if (!lineData) continue;

                if (lineData.depth === 1 && isHtmlElement(blockEl) && blockEl.tagName === 'LI') {
                    blockEl.classList.add('smart-list-reading-root');
                }

                // Mark native child lists so the plugin can find processed sections,
                // but leave their native margin and padding untouched.
                if (lineData.depth > 1) {
                    const parentListEl = blockEl.parentElement;
                    if (parentListEl && (parentListEl.tagName === 'UL' || parentListEl.tagName === 'OL')) {
                        parentListEl.classList.add('smart-list-reading');
                        parentListEl.classList.add('smart-list-reading-child');
                    }
                }

                // --- ORIGINAL: UNIFY NATIVE ROOT MARKERS ---
                if (!lineData.isOrphan && !lineData.fallbackToBullet && lineData.isNativeOrdered) {
                    const htmlEl = blockEl as HTMLElement;
                    htmlEl.classList.add('smart-list-native-override-reading');
                    if (!htmlEl.querySelector('.smart-list-override-reading')) {
                        const overrideSpan = htmlEl.createEl('span');
                        overrideSpan.className = 'list-number smart-list-prefix smart-list-override-reading';
                        overrideSpan.textContent = `${lineData.expectedPrefix || ''} `;
                        htmlEl.insertBefore(overrideSpan, htmlEl.firstChild);
                    }
                }

                // Reuse Obsidian's bullet when present; a second marker duplicates it.
                if ((lineData.isOrphan || lineData.fallbackToBullet) && lineData.taskTail === undefined && blockEl.tagName === 'LI') {
                    const htmlEl = blockEl as HTMLElement;
                    if (lineData.fallbackToBullet && lineData.marker) {
                        htmlEl.querySelector(':scope > input.task-list-item-checkbox')?.remove();
                    }
                    htmlEl.classList.add('smart-list-native-unordered-reading', 'smart-list-bullet-head');
                    const nativeBullet = htmlEl.querySelector<HTMLElement>(':scope > .list-bullet:not(.smart-list-bullet-reading)');
                    const managedBullet = htmlEl.querySelector<HTMLElement>(':scope > .smart-list-bullet-reading');
                    if (nativeBullet) {
                        if (managedBullet) managedBullet.remove();
                        nativeBullet.classList.add('smart-list-bullet-reading');
                    } else if (!managedBullet) {
                        const firstContent = Array.from(htmlEl.childNodes).find(node =>
                            !(isHtmlElement(node) &&
                                (node.matches('ol, ul, .list-collapse-indicator') ||
                                    node.classList.contains('task-list-item-checkbox')))
                        );
                        const bulletSpan = htmlEl.createEl('span');
                        bulletSpan.className = 'list-bullet smart-list-bullet-reading';
                        htmlEl.insertBefore(bulletSpan, firstContent ?? htmlEl.firstChild);
                    }
                }

                const checkboxHead = ((lineData.isOrphan || lineData.fallbackToBullet) && lineData.taskTail !== undefined) ||
                    (!lineData.fallbackToBullet && /^[-*+]\s+\[[ xX-]\]\s+$/.test(lineData.marker));
                if (checkboxHead && blockEl.querySelector(':scope > input.task-list-item-checkbox')) {
                    blockEl.classList.add('smart-list-checkbox-head');
                }
            }

            // 2. BUILD TRUE NESTED DOM TREES
            interface StackLevel {
                listEl: HTMLElement;
                itemEl: HTMLElement;
                parentItemEl: HTMLElement | null;
                quoteScope: ListScope;
            }
            const listStack: (StackLevel | null)[] =[];
            const readingItems = new Map<number, HTMLElement>();
            let activeQuoteScope: ListScope | null = null;

            for (let absLine = sectionInfo.lineStart; absLine <= sectionInfo.lineEnd; absLine++) {
                const lineData = parsedLines[absLine];
                if (!lineData) continue;
                if (lineData.quoteScope !== activeQuoteScope) {
                    activeQuoteScope = lineData.quoteScope;
                    listStack.length = 0;
                }
                const parentStackBefore = listStack[lineData.depth - 1];
                const parentWasRebuilt = parentStackBefore?.itemEl.classList.contains('smart-list-custom-reading') === true;
                const nativeItem = nativeItems.get(absLine);
                const isPluginSpecificPrefix = lineData.fallbackToBullet ||
                    (!lineData.isOrphan && (!lineData.isNativeOrdered || !nativeItem) && !lineData.isNativeUnordered);
                // Keep ordinary Markdown bullets in Obsidian's native tree. Rebuilding
                // them leaves the original <li> behind and can duplicate the nest.
                const needsFlattenedFix = (isPluginSpecificPrefix || parentWasRebuilt) && !(lineData.fallbackToBullet && nativeItem);
                const nativeCheckbox = lineData.marker && nativeItem?.querySelector(':scope > input.task-list-item-checkbox');
                if (!needsFlattenedFix || nativeCheckbox) {
                    // A native parent starts a new branch. Do not reuse a generated
                    // child list that belonged to an earlier native parent.
                    listStack.length = Math.min(listStack.length, lineData.depth);
                    const nativeList = nativeItem?.parentElement;
                    if (nativeItem && nativeList && (nativeList.tagName === 'UL' || nativeList.tagName === 'OL')) {
                        readingItems.set(absLine, nativeItem);
                        const parentItem = nativeList.parentElement?.tagName === 'LI'
                            ? nativeList.parentElement
                            : null;
                        listStack[lineData.depth] = {
                            listEl: nativeList,
                            itemEl: nativeItem,
                            parentItemEl: parentItem,
                            quoteScope: lineData.quoteScope
                        };
                    }
                    continue;
                }

                // This permanently solves the "- --list" bug without breaking the tree!
                const targetPrefix = lineData.isOrphan ? (lineData.marker + lineData.spaces) : (lineData.marker + (lineData.prefix || ''));
                const escapedTarget = targetPrefix.replace(/^\s+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(^|\\n)([ \\t]*)${escapedTarget}`);

                // Search within the original list item for this source line first.
                // Searching the whole rendered section can select a different row
                // when multiple lines share the same prefix (for example, `1.1`).
                const walkerRoot: Node = nativeItem ?? element;
                const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, null);
                let textNode: Text | null = null;
                let match: RegExpMatchArray | null = null;

                while (true) {
                    const n = walker.nextNode() as Text | null;
                    if (!n) break;
                    let parent = n.parentNode;
                    let isCode = false;
                    while (parent && parent !== walkerRoot) {
                        if (parent.nodeName === 'PRE' || parent.nodeName === 'CODE' ||
                            (isElement(parent) && parent.classList.contains('smart-list-prefix')) ||
                            (nativeItem && parent.nodeName === 'LI')) {
                            isCode = true;
                            break;
                        }
                        parent = parent.parentNode;
                    }
                    if (isCode) continue;
                    match = n.nodeValue?.match(regex) || null;
                    if (match) { textNode = n; break; }
                }

                if (textNode && match) {
                    const splitIndex = match.index! + (match[1] || '').length + (match[2] || '').length; 
                    const afterPrefixNode = textNode.splitText(splitIndex);
                    const replaceRegex = new RegExp(`^${escapedTarget}[ \\t]*`);
                    afterPrefixNode.nodeValue = afterPrefixNode.nodeValue?.replace(replaceRegex, '') || '';
                    afterPrefixNode.nodeValue = afterPrefixNode.nodeValue?.replace(/^\n/, '') || '';
                    if (lineData.taskTail !== undefined) {
                        afterPrefixNode.nodeValue = afterPrefixNode.nodeValue.replace(/^\[[ xX-]\][ \t]*/, '');
                    }

                    const depth = lineData.depth;
                    let listEl: HTMLElement | null = null;
                    const itemEl = element.ownerDocument.createElement('li');
                    itemEl.dir = 'auto';
                    itemEl.classList.add('smart-list-custom-reading');
                    itemEl.setAttribute('data-line', String(absLine - sectionInfo.lineStart));
                    readingItems.set(absLine, itemEl);

                    if (lineData.isOrphan || lineData.fallbackToBullet) {
                        if (lineData.taskTail !== undefined) {
                            const checkbox = itemEl.createEl('input');
                            const lineInSection = String(absLine - sectionInfo.lineStart);
                            itemEl.classList.add('task-list-item', 'smart-list-checkbox-head');
                            itemEl.setAttribute('data-task', lineData.taskTail);
                            itemEl.setAttribute('data-line', lineInSection);
                            checkbox.type = 'checkbox';
                            checkbox.className = 'task-list-item-checkbox';
                            checkbox.setAttribute('data-line', lineInSection);
                            checkbox.checked = lineData.taskTail !== ' ';
                            if (checkbox.checked) itemEl.classList.add('is-checked');
                        } else {
                            itemEl.classList.add('smart-list-bullet-head');
                            const bulletSpan = itemEl.createEl('span');
                            bulletSpan.className = 'list-bullet smart-list-bullet-reading';
                        }
                    } else {
                        const task = lineData.marker.match(/^[-*+]\s+\[([ xX-])\]\s+$/);
                        const status = task?.[1] ?? lineData.taskTail;
                        let checkbox: HTMLInputElement | undefined;
                        if (status !== undefined) {
                            checkbox = itemEl.createEl('input');
                            const lineInSection = String(absLine - sectionInfo.lineStart);
                            itemEl.classList.add('task-list-item');
                            itemEl.setAttribute('data-task', status);
                            itemEl.setAttribute('data-line', lineInSection);
                            checkbox.type = 'checkbox';
                            checkbox.className = 'task-list-item-checkbox';
                            checkbox.setAttribute('data-line', lineInSection);
                            checkbox.checked = status !== ' ';
                            if (checkbox.checked) itemEl.classList.add('is-checked');
                            if (task) itemEl.classList.add('smart-list-checkbox-head');
                        }
                        const prefixSpan = itemEl.createEl('span');
                        prefixSpan.className = 'list-number smart-list-prefix smart-list-prefix-span-reading';
                        prefixSpan.textContent = `${lineData.expectedPrefix || ''} `;
                        if (!task && checkbox) itemEl.insertBefore(prefixSpan, checkbox);
                    }

                    const prevStack = listStack[depth];
                    const parentStack = listStack[depth - 1];
                    const parentItemEl = parentStack?.itemEl || null;
                    const expectedListTag = lineData.isOrphan || lineData.fallbackToBullet ? 'UL' : 'OL';
                    const canReuseList = prevStack &&
                        prevStack.listEl.tagName === expectedListTag &&
                        prevStack.parentItemEl === parentItemEl &&
                        prevStack.quoteScope === lineData.quoteScope;

                    if (canReuseList) {
                        listEl = prevStack.listEl;
                        listEl.appendChild(itemEl);
                    } else {
                        listEl = element.ownerDocument.createElement(expectedListTag.toLowerCase());
                        listEl.className = expectedListTag === 'UL' ? 'has-list-bullet el-ul' : 'el-ol';
                        listEl.classList.add('smart-list-reading');
                        if (depth > 1) listEl.classList.add('smart-list-reading-child');

                        listEl.appendChild(itemEl);

                        if (parentStack && parentStack.itemEl) {
                            parentStack.itemEl.appendChild(listEl);
                            ensureReadingCollapseIndicator(parentStack.itemEl);
                        } else {
                            const parent = afterPrefixNode.parentNode;
                            if (parent) {
                                parent.insertBefore(listEl, afterPrefixNode);
                                let nativeLi: Node | null = afterPrefixNode.parentNode;
                                while (nativeLi && nativeLi !== element && nativeLi.nodeName !== 'LI') {
                                    nativeLi = nativeLi.parentNode;
                                }
                                if (nativeLi && nativeLi.nodeName === 'LI') {
                                    const liEl = nativeLi as HTMLElement;
                                    ensureReadingCollapseIndicator(liEl);
                                }
                            }
                        }
                    }
                    
                    listStack[depth] = { listEl, itemEl, parentItemEl, quoteScope: lineData.quoteScope };
                    listStack.length = depth + 1;

                    const parent = afterPrefixNode.parentNode;
                    if (parent) {
                        let current: Node | null = afterPrefixNode;
                        while (current) {
                            const next: Node | null = current.nextSibling;
                            // A generated child list can now be a sibling of the
                            // original text. Never move an ancestor into itself.
                            if (current.contains(itemEl)) break;
                            if (current.nodeName === 'BR') { parent.removeChild(current); break; }
                            if (current.nodeType === Node.TEXT_NODE) {
                                const newlineIndex = current.nodeValue?.indexOf('\n');
                                if (newlineIndex !== undefined && newlineIndex !== -1) {
                                    const nextLineNode = (current as Text).splitText(newlineIndex);
                                    nextLineNode.nodeValue = nextLineNode.nodeValue?.replace(/^\n/, '') || '';
                                    itemEl.appendChild(current);
                                    break; 
                                }
                            }
                            itemEl.appendChild(current);
                            current = next;
                        }
                    }
                }
            }
            const readingParents = getReadingParentLines(
                parsedLines,
                sectionInfo.lineStart,
                sectionInfo.lineEnd
            );
            repairReadingCustomHierarchy(
                element,
                parsedLines,
                readingItems,
                nativeItems,
                readingParents,
                sectionInfo.lineStart,
                sectionInfo.lineEnd
            );
            const alignmentLines = new Map<number, ReadingAlignmentLine>();
            for (let line = sectionInfo.lineStart; line <= sectionInfo.lineEnd; line++) {
                const lineData = parsedLines[line];
                if (!lineData) continue;
                alignmentLines.set(line, {
                    depth: lineData.depth,
                    slotCount: lineData.isOrphan || lineData.fallbackToBullet ? 0 : parseTokens(lineData.expectedPrefix || lineData.prefix || '').length
                });
            }
            const alignmentItems = new Map(nativeItems);
            for (const [line, item] of readingItems) alignmentItems.set(line, item);
            applyReadingNestDistances(element, alignmentLines, readingParents, alignmentItems);
            if (element.querySelector('.smart-list-override-reading, .smart-list-prefix-span-reading')) {
                context.addChild(new ReadingHeaderObserver(element));
            }
            readingCopy.track(element, sectionInfo, new Set(Object.keys(parsedLines).map(Number)),
                () => context.getSectionInfo(element));
        });

    }

}
