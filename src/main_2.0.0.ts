import { Plugin, Editor, MarkdownView, Notice } from 'obsidian';
import { Extension, Prec, RangeSetBuilder, Annotation, EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { SyntaxNode } from '@lezer/common';
import { keymap, EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';

// --- CORE REGEX PATTERNS ---
const MIX_COMP = "(?:[1-9][0-9]*|[a-zA-Z])";
const SINGLE_ITEM = `(?:${MIX_COMP}\\.)`;
const MULTI_ITEM = `(?:${MIX_COMP}(?:\\.${MIX_COMP}){1,3}\\.?)`;
const MIXED_LIST = `(?:${MULTI_ITEM}|${SINGLE_ITEM})(?!\\.?(?:[0-9]+|[a-zA-Z]+))`;

const LIST_PATTERN = `(${MIXED_LIST}|\\([1-9][0-9]*\\)|[一二三四五六七八九十]+、)`;
const MARKER_REGEX = "([-*+]\\s+\\[[ xX-]\\]\\s+|[-*+]\\s+|[1-9][0-9]*\\.\\s+)?";
const PREFIX_REGEX = new RegExp(`^([ \\t]*)${MARKER_REGEX}${LIST_PATTERN}([ \\t]+)(.*)$`);
const SPACE_REGEX = new RegExp(`^([ \\t]*)${MARKER_REGEX}${LIST_PATTERN}$`);

// --- CHINESE NUMERAL DICTIONARY ---
const ZH_DIGITS =['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function toChinese(num: number): string {
    if (num <= 10) return ZH_DIGITS[num] || '零';
    if (num < 20) return '十' + (num % 10 === 0 ? '' : (ZH_DIGITS[num % 10] || ''));
    if (num < 100) return (ZH_DIGITS[Math.floor(num / 10)] || '') + '十' + (num % 10 === 0 ? '' : (ZH_DIGITS[num % 10] || ''));
    return num.toString();
}

function fromChinese(str: string): number {
    if (ZH_DIGITS.includes(str)) return Math.max(0, ZH_DIGITS.indexOf(str));
    if (str.startsWith('十')) return 10 + Math.max(0, ZH_DIGITS.indexOf(str[1] || '零'));
    if (str.includes('十')) {
        const parts = str.split('十');
        const tens = Math.max(0, ZH_DIGITS.indexOf(parts[0] || '零'));
        const ones = parts[1] ? Math.max(0, ZH_DIGITS.indexOf(parts[1] || '零')) : 0;
        return tens * 10 + ones;
    }
    return 1;
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
    let inCode = false;
    for (let i = 1; i <= lineNum; i++) {
        if (/^([ \t]*)(```|~~~)/.test(state.doc.line(i).text)) {
            if (i === lineNum) return true;
            inCode = !inCode;
        }
    }
    return inCode;
}

function isConsecutionBreaker(text: string): boolean {
    if (text.trim() === '') return false;
    if (/^([ \t]*)(```|~~~)/.test(text)) return true;
    if (/^([ \t]*)#+\s/.test(text)) return true;
    if (/^([ \t]*)(---|___|\*\*\*)[ \t]*$/.test(text)) return true;
    // Catch Obsidian Callouts accurately (case insensitive)
    if (/^([ \t]*)(>|&gt;)[ \t]*\[!/i.test(text)) return true; 

    return false;
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

function isRollbackNeeded(tokens: Token[]): boolean {
    if (tokens.length > 4) return true;
    if (tokens.length > 1 && (tokens[0]?.type === 'paren' || tokens[0]?.type === 'chinese')) {
        return true;
    }
    return false;
}

// --- HIERARCHY STACK ---
function buildTokenStack(state: EditorState, upToLine: number): (StackItem | null)[] {
    let stack: (StackItem | null)[] =[];
    let inCodeBlock = false;

    for (let i = 1; i < upToLine; i++) {
        const text = state.doc.line(i).text;

        if (/^([ \t]*)(```|~~~)/.test(text)) {
            inCodeBlock = !inCodeBlock;
            stack.length = 0; // Mutate instead of reassign
            continue;
        }
        if (inCodeBlock) continue;
        if (text.trim() === '') continue;

        if (isConsecutionBreaker(text)) {
            stack.length = 0; // Mutate instead of reassign
            continue;
        }

        if (/^([ \t]*)>\s/.test(text) && !/^([ \t]*)>\s*\[!/i.test(text)) {
            continue;
        }

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
                    stack.splice(lvl + 1); // Only purge this branch and its children
                }
            }

            stack[lvl] = { tokens, markerType: currentMarkerType };
            stack.splice(lvl + 1);
        }
    }
    return stack;
}

// --- ERROR CORRECTION ENGINE ---
function getNextTokens(userTokens: Token[], tokenStack: (StackItem | null)[], indentLevel: number, marker: string): Token[] {
    const currentMarkerType = /^[-*+]\s+\[[ xX-]\]\s+$/.test(marker) ? 'checkbox' : 'none';
    const prevSameLevel = tokenStack[indentLevel];
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
            if (lastReset) lastReset.value = 1;
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
            break; // Stop at the very closest parent
        }
    }

    // Ensure we only inherit digits if the parent is explicitly ORDERED
    if (parentItem && !parentItem.isUnordered && parentItem.tokens.length > 0) {
        let newType: Token['type'] = 'number';
        if (userTokens.length > parentItem.tokens.length) {
            newType = userTokens[parentItem.tokens.length]?.type || 'number';
        } else if (userTokens.length > 0) {
            newType = userTokens[userTokens.length - 1]?.type || 'number';
        }
        expectedTokens =[...parentItem.tokens.map(t => ({ ...t })), { type: newType, value: 1 }];
    } else {
        // If parent is unordered, or no parent exists, initialize gracefully
        const firstType = userTokens[0]?.type || 'number';
        expectedTokens = [{ type: firstType, value: 1 }];
    }

    return expectedTokens;
}

// --- LIVE PREVIEW DECORATOR ---
const listMarkerDecorator = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.buildDecorations(view); }
    update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = this.buildDecorations(update.view); }

    buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const state = view.state;

        for (let { from, to } of view.visibleRanges) {
            let startLineNum = state.doc.lineAt(from).number;
            let endLineNum = state.doc.lineAt(to).number;

            // 1. Find the safe start of the block to build a reliable stack
            let blockStart = startLineNum;
            while (blockStart > 1) {
                if (isConsecutionBreaker(state.doc.line(blockStart - 1).text)) break;
                blockStart--;
            }

            // 2. Initialize the stack up to blockStart
            let tokenStack = buildTokenStack(state, blockStart);

            // 3. Process line by line through the visible range
            for (let i = blockStart; i <= endLineNum; i++) {
                const line = state.doc.line(i);
                const text = line.text;

                if (text.trim() === '') continue;
                if (isConsecutionBreaker(text)) {
                    tokenStack.length = 0;
                    continue;
                }

                if (/^([ \t]*)>\s/.test(text) && !/^([ \t]*)>\s*\[!/i.test(text)) {
                    continue;
                }

                // 1. MATCH PURE BULLETS (AND ORPHANS)
                const pbMatch = text.match(/^([ \t]*)([-*+])(\s+)/);
                if (pbMatch && !PREFIX_REGEX.test(text)) {
                    const lvl = getIndentLevel(text);
                    tokenStack[lvl] = { tokens:[], markerType: 'bullet', isUnordered: true };
                    tokenStack.splice(lvl + 1);

                    // FIX: RESCUE ORPHANED AND NESTED BULLETS right here before we `continue`!
                    if (i >= startLineNum) {
                        const indent = pbMatch[1] || '';
                        const markerChar = pbMatch[2] || '';
                        const spaces = pbMatch[3] || '';
                        const start = line.from + indent.length;
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

                        if (!hasNativeListMark) {
                            builder.add(start, start + 1, Decoration.mark({ class: "list-bullet" }));
                            builder.add(start, start + markerChar.length + spaces.length, Decoration.mark({
                                class: `cm-formatting cm-formatting-list cm-formatting-list-ul cm-list-${visualDepth}`
                            }));
                        }
                    }
                    continue; // Now it safely skips the rest of the loop after applying the rescue UI!
                }

                // 2. MATCH SMART ORDERED LISTS
                const match = text.match(PREFIX_REGEX);
                if (match) {
                    const indent = match[1] || '';
                    const marker = match[2] || '';
                    const prefix = match[3] || '';
                    const spaces = match[4] || ''; 
                    const start = line.from + indent.length + marker.length;
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
                    const expectedPrefix = buildPrefixString(expectedTokens, prefix);

                    tokenStack[indentLevel] = { tokens: expectedTokens, markerType: currentMarkerType };
                    tokenStack.splice(indentLevel + 1);

                    // --- DECORATION LOGIC ---
                    if (i >= startLineNum) {
                        const isNativeOrdered = /^[1-9][0-9]*\.$/.test(prefix) && marker === '';

                        // VISUALLY OVERRIDE Obsidian's number using pure CSS holograms!
                        if (isNativeOrdered && expectedPrefix !== prefix) {
                            builder.add(start, start + prefix.length + spaces.length, Decoration.mark({
                                class: `smart-list-prefix smart-list-override`,
                                attributes: { "data-expected": expectedPrefix + spaces }
                            }));
                        } 
                        // Normal styling logic
                        else if (!isNativeOrdered || depth > 3) {
                            builder.add(start, start + prefix.length + spaces.length, Decoration.mark({
                                class: `cm-formatting cm-formatting-list cm-formatting-list-ol cm-list-${visualDepth}`
                            }));
                            builder.add(start, start + prefix.length, Decoration.mark({
                                class: `list-number smart-list-prefix`
                            }));
                        }
                    }
                } 
            }
        }
        return builder.finish();
    }
}, { decorations: v => v.decorations });

// --- AUTO-REFRESH ENGINE ---
const autoRefreshPlugin = ViewPlugin.fromClass(class {
    timeout: NodeJS.Timeout | null = null;
    update(update: ViewUpdate) {
        if (update.docChanged && update.view.hasFocus) {
            if (update.transactions.some(tr => tr.annotation(SmartListSync))) return;
            if (this.timeout) clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
                if (!(update.view as any).isDestroyed) autoFormatVisibleRanges(update.view);
            }, 300);
        }
    }
});

function autoFormatVisibleRanges(view: EditorView) {
    const state = view.state;
    const changes: any[] =[];
    const processedLines = new Set<number>();
    let hasRewrites = false;

    for (let { from, to } of view.visibleRanges) {
        const startLine = state.doc.lineAt(from).number;
        const endLine = state.doc.lineAt(to).number;

        let inCodeBlock = false;
        for (let i = 1; i < startLine; i++) {
            if (/^([ \t]*)(```|~~~)/.test(state.doc.line(i).text)) inCodeBlock = !inCodeBlock;
        }

        for (let i = startLine; i <= endLine; i++) {
            if (processedLines.has(i)) continue;

            const line = state.doc.line(i);

            if (/^([ \t]*)(```|~~~)/.test(line.text)) {
                inCodeBlock = !inCodeBlock;
                processedLines.add(i);
                continue;
            }
            if (inCodeBlock) { processedLines.add(i); continue; }

            if (isConsecutionBreaker(line.text) || line.text.trim() === '') { processedLines.add(i); continue; }

            const isPureBullet = /^([ \t]*)([-*+])\s+/.test(line.text) && !PREFIX_REGEX.test(line.text);
            if (isPureBullet) { processedLines.add(i); continue; }

            if (!PREFIX_REGEX.test(line.text)) { processedLines.add(i); continue; }

            let blockStart = i;
            while (blockStart > 1) {
                const blockLineText = state.doc.line(blockStart - 1).text;
                if (isConsecutionBreaker(blockLineText)) break;
                blockStart--;
            }

            let blockEnd = i;
            while (blockEnd < state.doc.lines) {
                const blockLineText = state.doc.line(blockEnd + 1).text;
                if (isConsecutionBreaker(blockLineText)) break;
                blockEnd++;
            }

            let tokenStack = buildTokenStack(state, blockStart);

            for (let j = blockStart; j <= blockEnd; j++) {
                processedLines.add(j);
                const blockLine = state.doc.line(j);
                const text = blockLine.text;

                if (text.trim() === '') continue;
                if (isConsecutionBreaker(text)) { tokenStack =[]; continue; }

                if (/^([ \t]*)>\s/.test(text) && !/^([ \t]*)>\s*\[!/.test(text)) continue;

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
                    changes.push({ from: blockLine.from, to: blockLine.to, insert: rewrite.newText });
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
                        tokenStack.splice(indentLevel + 1); // Safely sever consecution
                    }
                }

                const expectedTokens = getNextTokens(userTokens, tokenStack, indentLevel, marker);

                if (isRollbackNeeded(expectedTokens)) {
                    changes.push({ from: blockLine.from, to: blockLine.to, insert: `${indentStr}- ${content}` });
                    hasRewrites = true;
                    tokenStack[indentLevel] = null;
                    tokenStack.splice(indentLevel + 1);
                    continue;
                }

                tokenStack[indentLevel] = { tokens: expectedTokens, markerType: currentMarkerType };
                tokenStack.splice(indentLevel + 1);

                const newPrefix = buildPrefixString(expectedTokens, userPrefix);
                const finalText = indentStr + marker + newPrefix + spaces + content;

                if (finalText !== text) {
                    const isNativeOrdered = /^[1-9][0-9]*\.$/.test(userPrefix) && marker === '';
                    const isExpectedNative = /^[1-9][0-9]*\.$/.test(newPrefix);
                    
                    // FIX: If Obsidian is enforcing a standard number, and our expected prefix 
                    // is also a standard number, DO NOT rewrite the underlying text! 
                    // Let the Hologram visually override it. This ends the infinite 
                    // transaction war with Obsidian and permanently stabilizes the cursor!
                    if (isNativeOrdered && isExpectedNative) {
                        // Silently skip textual rewrite
                    } else {
                        changes.push({ from: blockLine.from, to: blockLine.to, insert: finalText });
                        hasRewrites = true;
                    }
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
            const match = textBeforeCursor.match(SPACE_REGEX);
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
                const insertText = rewrite.newText.trimEnd() + " ";
                view.dispatch({
                    changes: { from: line.from, to: selection.from, insert: insertText },
                    selection: { anchor: line.from + insertText.length },
                    userEvent: "smartlist.update"
                });
                return true;
            }

            const targetIndentLevel = getIndentLevel(indentStr);
            let tokenStack = buildTokenStack(state, line.number);
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

            if (isRollbackNeeded(expectedTokens)) {
                const insertText = `${indentStr}- `;
                view.dispatch({
                    changes: { from: line.from, to: selection.from, insert: insertText },
                    selection: { anchor: line.from + insertText.length },
                    userEvent: "smartlist.update"
                });
                return true;
            }

            const nextPrefix = buildPrefixString(expectedTokens, typedPrefix);
            const insertText = `${indentStr}${marker}${nextPrefix} `;

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

            const match = textBeforeCursor.match(PREFIX_REGEX);
            if (!match) return false;

            const indentStr = match[1] || '';
            const marker = match[2] || '';
            const prefix = match[3] || '';
            const spaces = match[4] || ' ';
            const content = match[5] || '';

            if (content.trim() === '' && textAfterCursor.trim() === '') {
                if (getIndentLevel(line.text) > 0) return handleIndent(view, -1);
                view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, userEvent: "smartlist.update" });
                return true;
            }

            const tokens = parseTokens(prefix);
            if (tokens.length === 0) return false;

            const lastToken = tokens[tokens.length - 1];
            if (lastToken) lastToken.value++;

            if (isRollbackNeeded(tokens)) {
                const insertText = `\n${indentStr}- `;
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

            const insertText = `\n${indentStr}${nextMarker}${nextPrefix}${spaces}${nextContentCb}`;

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
        if (PREFIX_REGEX.test(state.doc.line(i).text)) { isList = true; break; }
    }
    if (!isList) return false;

    let startLineNum = fromLine.number;
    while (startLineNum > 1) {
        if (isConsecutionBreaker(state.doc.line(startLineNum - 1).text)) break;
        startLineNum--;
    }

    let endLineNum = toLine.number;
    while (endLineNum < state.doc.lines) {
        if (isConsecutionBreaker(state.doc.line(endLineNum + 1).text)) break;
        endLineNum++;
    }

    const changes: any[] =[];
    let hasRewrites = false;
    let tokenStack = buildTokenStack(state, startLineNum);

    for (let i = startLineNum; i <= endLineNum; i++) {
        const line = state.doc.line(i);
        let text = line.text;
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
                        const lineText = state.doc.line(k).text;
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

        if (isConsecutionBreaker(text) || convertedToUnordered) {
            tokenStack =[];
            if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
            continue;
        }

        if (/^([ \t]*)>\s/.test(text) && !/^([ \t]*)>\s*\[!/.test(text)) {
            if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
            continue;
        }

        const pbMatch = text.match(/^([ \t]*)([-*+])\s+/);
        if (pbMatch && !PREFIX_REGEX.test(text)) {
            const lvl = getIndentLevel(text);
            tokenStack[lvl] = { tokens:[], markerType: 'bullet', isUnordered: true };
            tokenStack.splice(lvl + 1);
            if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
            continue;
        }

        const match = text.match(PREFIX_REGEX);
        if (!match) {
            if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
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
            changes.push({ from: line.from, to: line.to, insert: rewrite.newText });
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

        if (isRollbackNeeded(expectedTokens)) {
            changes.push({ from: line.from, to: line.to, insert: `${indentStr}- ${content}` });
            hasRewrites = true;
            tokenStack[indentLevel] = null;
            tokenStack.splice(indentLevel + 1);
            continue;
        }

        tokenStack[indentLevel] = { tokens: expectedTokens, markerType: currentMarkerType };
        tokenStack.splice(indentLevel + 1);

        const newPrefix = buildPrefixString(expectedTokens, userPrefix);
        const finalText = indentStr + marker + newPrefix + spaces + content;
        
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
    async onload() {
        console.log('Loading Smart Order List Plugin (Clean Native Styling)');
        
        const styleEl = document.createElement('style');
        styleEl.id = 'smart-order-list-styles';
        styleEl.textContent = `
            /* Destroys false counters applied by Obsidian's native engine */
            .smart-list-prefix::before,
            .smart-list-prefix::after { 
                content: none !important; 
                display: none !important; 
            }
            
            /* Clean Grey-Prefix styling matching native Obsidian lists */
            .smart-list-prefix {
                color: var(--list-marker-color, var(--text-faint)) !important;
            }

            /* --- NEW: Hologram Override for Consecution Exits --- */
            .smart-list-override,
            .smart-list-override * {
                color: transparent !important;
                background: transparent !important;
                position: relative;
            }
            .smart-list-override::after {
                /* FIX: Added !important to overpower the 'content: none' rule above */
                content: attr(data-expected) !important;
                display: block !important;
                
                color: var(--list-marker-color, var(--text-faint)) !important;
                position: absolute;
                left: 0;
                top: 0;
                white-space: pre; /* Preserves the trailing space */
                pointer-events: none; /* Allows mouse clicks to pass through */
            }
        `;
        document.head.appendChild(styleEl);

        this.registerEditorExtension([smartEnterPlugin, smartTabPlugin, smartSpacePlugin, autoRefreshPlugin, listMarkerDecorator]);

        // --- READING VIEW POST PROCESSOR ---
        this.registerMarkdownPostProcessor((element, context) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
            let node: Node | null;
            const nodesToProcess: Text[] =[];
            
            while (node = walker.nextNode()) {
                if (!node.parentElement) continue;
                let prev = node.previousSibling;
                let isStart = true;
                while (prev) {
                    if (prev.nodeType === Node.ELEMENT_NODE && (prev as Element).tagName === 'INPUT') {
                        prev = prev.previousSibling;
                        continue;
                    }
                    if (prev.textContent?.trim() !== '') {
                        isStart = false;
                        break;
                    }
                    prev = prev.previousSibling;
                }
                if (isStart) nodesToProcess.push(node as Text);
            }

            nodesToProcess.forEach(textNode => {
                const text = textNode.textContent || '';
                const match = text.match(new RegExp(`^([ \\t]*)${LIST_PATTERN}([ \\t]+)(.*)$`));
                
                if (match) {
                    const leadingSpace = match[1] || '';
                    const prefix = match[2] || '';
                    const trailingSpace = match[3] || '';
                    const rest = match[4] || '';

                    // Construct native-matching structure for Reading Mode
                    const outerSpan = document.createElement('span');
                    outerSpan.className = 'cm-formatting cm-formatting-list cm-formatting-list-ol';
                    
                    const innerSpan = document.createElement('span');
                    innerSpan.className = 'list-number smart-list-prefix';
                    innerSpan.textContent = prefix + trailingSpace;

                    outerSpan.appendChild(innerSpan);

                    const parent = textNode.parentElement;
                    if (parent) {
                        if (leadingSpace) parent.insertBefore(document.createTextNode(leadingSpace), textNode);
                        parent.insertBefore(outerSpan, textNode);
                        if (rest) parent.insertBefore(document.createTextNode(rest), textNode);
                        parent.removeChild(textNode);
                    }
                }
            });
        });

        this.addCommand({
            id: 'format-smart-list',
            name: 'Format Smart List',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                const text = editor.getSelection();
                if (!text) { new Notice("Please select the list you want to format first."); return; }

                const lines = text.split('\n');
                const result: string[] =[];
                let tokenStack: (StackItem | null)[] =[];
                let inCodeBlock = false;

                for (const line of lines) {
                    if (/^([ \t]*)(```|~~~)/.test(line)) {
                        inCodeBlock = !inCodeBlock;
                        tokenStack =[]; 
                        result.push(line);
                        continue;
                    }
                    if (inCodeBlock) { result.push(line); continue; }

                    if (line.trim() === '') { result.push(line); continue; }
                    if (isConsecutionBreaker(line)) { tokenStack =[]; result.push(line); continue; }

                    if (/^([ \t]*)>\s/.test(line) && !/^([ \t]*)>\s*\[!/.test(line)) {
                        result.push(line);
                        continue;
                    }

                    const isPureBullet = /^([ \t]*)([-*+])\s+/.test(line) && !PREFIX_REGEX.test(line);
                    if (isPureBullet) {
                        const lvl = getIndentLevel(line);
                        tokenStack[lvl] = { tokens:[], markerType: 'bullet', isUnordered: true };
                        tokenStack.splice(lvl + 1);
                        result.push(line);
                        continue;
                    }

                    const match = line.match(PREFIX_REGEX);
                    if (!match) { result.push(line); continue; }

                    const indentStr = match[1] || '';
                    const indentLevel = getIndentLevel(line);
                    const marker = match[2] || '';
                    const userPrefix = match[3] || '';
                    const spaces = match[4] || '';
                    const content = match[5] || '';

                    const rewrite = rewritePrefix(indentStr, marker, userPrefix, spaces + content);
                    if (rewrite.changed) {
                        result.push(rewrite.newText);
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
                            tokenStack =[];
                        }
                    }

                    const expectedTokens = getNextTokens(userTokens, tokenStack, indentLevel, marker);

                    if (isRollbackNeeded(expectedTokens)) {
                        result.push(`${indentStr}- ${content}`);
                        tokenStack[indentLevel] = null;
                        tokenStack.splice(indentLevel + 1);
                        continue;
                    }

                    tokenStack[indentLevel] = { tokens: expectedTokens, markerType: currentMarkerType };
                    tokenStack.splice(indentLevel + 1);

                    const newPrefix = buildPrefixString(expectedTokens, userPrefix);
                    result.push(`${indentStr}${marker}${newPrefix}${spaces}${content}`);
                }
                editor.replaceSelection(result.join('\n'));
            }
        });
    }

    onunload() {
        const styleEl = document.getElementById('smart-order-list-styles');
        if (styleEl) styleEl.remove();
    }
}