import { Plugin, Editor, MarkdownView, Notice } from 'obsidian';
import { Extension, Prec, RangeSetBuilder, Annotation, EditorState } from '@codemirror/state';
import { keymap, EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { SyntaxNode } from '@lezer/common';

// --- CORE REGEX PATTERNS (Strict Limitations Enforced) ---

const MIX_COMP = "(?:[0-9]+|[a-zA-Z])";
const SINGLE_ITEM = `(?:${MIX_COMP}\\.)`;
const MULTI_ITEM = `(?:${MIX_COMP}(?:\\.${MIX_COMP}){1,3}\\.?)`;
const MIXED_LIST = `(?:${MULTI_ITEM}|${SINGLE_ITEM})(?!\\.?(?:[0-9]+|[a-zA-Z]+))`;

const LIST_PATTERN = `(${MIXED_LIST}|\\([0-9]+\\)|[一二三四五六七八九十]+、)`;
const MARKER_REGEX = "([-*+]\\s+\\[[ xX]\\]\\s+|[-*+]\\s+)?";
const PREFIX_REGEX = new RegExp(`^([ \\t]*)${MARKER_REGEX}${LIST_PATTERN}\\s+(.*)$`);
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
    const forceDot = tokens.length === 1 || (originalPrefix.endsWith('.') && originalPrefix.split('.').length > 2);
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
    if (/^([ \t]*)(---|___|\*\*\*)/.test(text)) return true; 
    
    const isUnordered = /^([ \t]*)([-*+])\s+/.test(text);
    const isSmartList = PREFIX_REGEX.test(text);
    if (isUnordered && !isSmartList) return true; 
    
    return false; 
}

// --- PREFIX REWRITE MECHANISM ---
function rewritePrefix(indent: string, marker: string, prefix: string, content: string): { changed: boolean, newText: string } {
    const isPureBullet = /^[-*+]\s+$/.test(marker);
    if (isPureBullet) {
        return { changed: true, newText: `${indent}${marker}${content}` };
    }
    return { changed: false, newText: "" };
}

function getNextTokens(userTokens: Token[], currentTokens: Token[], currentIndent: number, indentLevel: number): Token[] {
    if (currentTokens.length === 0) {
        return userTokens.map(t => ({ ...t, value: 1 }));
    }

    if (indentLevel > currentIndent) {
        let newType: Token['type'] = 'number';
        if (userTokens.length > currentTokens.length) newType = userTokens[currentTokens.length]?.type || 'number';
        else if (userTokens.length > 0) newType = userTokens[userTokens.length - 1]?.type || 'number';
        return[...currentTokens, { type: newType, value: 1 }];
    }

    let expectedTokens = [...currentTokens];
    if (indentLevel < currentIndent) {
        const diff = currentIndent - indentLevel;
        for (let i = 0; i < diff; i++) if (expectedTokens.length > 1) expectedTokens.pop();
    }

    const lastIdx = expectedTokens.length - 1;
    if (lastIdx >= 0 && expectedTokens[lastIdx]) {
        expectedTokens[lastIdx] = { ...expectedTokens[lastIdx]!, value: expectedTokens[lastIdx]!.value + 1 };
    }

    const currToken = userTokens[userTokens.length - 1];
    const expectedToken = expectedTokens[expectedTokens.length - 1];
    
    const isConsistentStyle = (userTokens.length === expectedTokens.length) && (currToken?.type === expectedToken?.type);

    const isNextSibling = userTokens.length === currentTokens.length &&
        currentTokens.every((t, i) => {
            const uToken = userTokens[i];
            if (!uToken) return false;
            if (i === currentTokens.length - 1) return t.type === uToken.type && t.value + 1 === uToken.value;
            return t.type === uToken.type && t.value === uToken.value;
        });
        
    const isChild = userTokens.length > currentTokens.length &&
        currentTokens.every((t, i) => t.type === userTokens[i]?.type && t.value === userTokens[i]?.value) &&
        userTokens.slice(currentTokens.length).every(t => t.value === 1 && t.type === 'number');

    const isArtifact = indentLevel <= currentIndent && (isNextSibling || isChild);

    return (isConsistentStyle || isArtifact) ? expectedTokens : [...userTokens];
}

// --- LIVE PREVIEW DECORATOR (Cleaned & Optimized) ---
const listMarkerDecorator = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.buildDecorations(view); }
    update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = this.buildDecorations(update.view); }

    buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        for (let { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                if (!isLineInFencedCode(view.state, line.number)) {
                    const match = line.text.match(PREFIX_REGEX);
                    if (match) {
                        const indent = match[1] || '';
                        const marker = match[2] || '';
                        const prefix = match[3] || '';
                        const start = line.from + indent.length + marker.length;
                        
                        const isNativeOrdered = /^[0-9]+\.$/.test(prefix) && marker === '';

                        if (!isNativeOrdered) {
                            const depth = getIndentLevel(line.text) + 1;
                            const visualDepth = ((depth - 1) % 3) + 1; 
                            builder.add(start, start + prefix.length + 1, Decoration.mark({ 
                                class: `cm-list-${visualDepth} cm-formatting cm-formatting-list cm-formatting-list-ol` 
                            }));
                        }
                    }
                }
                pos = line.to + 1;
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

        for (let i = startLine; i <= endLine; i++) {
            if (processedLines.has(i)) continue;
            
            if (isLineInFencedCode(state, i)) { processedLines.add(i); continue; }
            
            const line = state.doc.line(i);
            if (isConsecutionBreaker(line.text) || line.text.trim() === '') { processedLines.add(i); continue; }
            if (!PREFIX_REGEX.test(line.text)) { processedLines.add(i); continue; }

            let blockStart = i;
            while (blockStart > 1) {
                const blockLine = state.doc.line(blockStart - 1);
                if (isConsecutionBreaker(blockLine.text) || isLineInFencedCode(state, blockStart - 1)) break;
                blockStart--;
            }

            let blockEnd = i;
            while (blockEnd < state.doc.lines) {
                const blockLine = state.doc.line(blockEnd + 1);
                if (isConsecutionBreaker(blockLine.text) || isLineInFencedCode(state, blockEnd + 1)) break;
                blockEnd++;
            }

            let currentTokens: Token[] =[];
            let currentIndent = -1;

            for (let j = blockStart; j <= blockEnd; j++) {
                processedLines.add(j);
                const blockLine = state.doc.line(j);
                const text = blockLine.text;

                if (text.trim() === '') continue;
                if (isConsecutionBreaker(text)) { currentTokens =[]; currentIndent = -1; continue; }

                const m = text.match(PREFIX_REGEX);
                if (!m) continue;

                const indentStr = m[1] || '';
                const indentLevel = getIndentLevel(text);
                const marker = m[2] || '';
                const userPrefix = m[3] || '';
                const content = m[4] || '';

                const rewrite = rewritePrefix(indentStr, marker, userPrefix, content);
                if (rewrite.changed) {
                    changes.push({ from: blockLine.from, to: blockLine.to, insert: rewrite.newText });
                    hasRewrites = true;
                    currentTokens =[]; currentIndent = -1;
                    continue; 
                }

                const userTokens = parseTokens(userPrefix);
                const expectedTokens = getNextTokens(userTokens, currentTokens, currentIndent, indentLevel);

                if (expectedTokens.length > 4) {
                    changes.push({ from: blockLine.from, to: blockLine.to, insert: `${indentStr}- ${content}` });
                    hasRewrites = true;
                    currentTokens =[]; currentIndent = -1;
                    continue;
                }

                currentTokens = expectedTokens;
                currentIndent = indentLevel;

                const newPrefix = buildPrefixString(currentTokens, userPrefix);

                if (newPrefix !== userPrefix) {
                    const prefixStart = blockLine.from + indentStr.length + marker.length;
                    changes.push({ from: prefixStart, to: prefixStart + userPrefix.length, insert: newPrefix });
                }
            }
        }
    }

    if (changes.length > 0) {
        view.dispatch({ changes, annotations: hasRewrites ? undefined : SmartListSync.of(true) });
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
                    selection: { anchor: line.from + insertText.length }
                });
                return true;
            }

            const targetIndentLevel = getIndentLevel(indentStr);
            let prevTokens: Token[] =[];
            let prevIndentLevel = -1;

            for (let i = line.number - 1; i >= 1; i--) {
                const prevLine = state.doc.line(i).text;
                if (prevLine.trim() === '') continue;
                if (isConsecutionBreaker(prevLine)) break;

                const prevMatch = prevLine.match(PREFIX_REGEX);
                if (prevMatch) {
                    const prevIndent = getIndentLevel(prevMatch[1] || '');
                    if (prevIndent <= targetIndentLevel) {
                        prevTokens = parseTokens(prevMatch[3] || '');
                        prevIndentLevel = prevIndent;
                        break;
                    }
                }
            }

            let nextTokens = parseTokens(typedPrefix);
            let currentTokens = getNextTokens(nextTokens, prevTokens, prevIndentLevel, targetIndentLevel);

            if (currentTokens.length > 4) {
                const insertText = `${indentStr}- `;
                view.dispatch({
                    changes: { from: line.from, to: selection.from, insert: insertText },
                    selection: { anchor: line.from + insertText.length },
                    annotations: SmartListSync.of(true)
                });
                return true;
            }

            const nextPrefix = buildPrefixString(currentTokens, typedPrefix);
            const insertText = `${indentStr}${marker}${nextPrefix} `;

            view.dispatch({
                changes: { from: line.from, to: selection.from, insert: insertText },
                selection: { anchor: line.from + insertText.length },
                annotations: SmartListSync.of(true)
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
                        selection: { anchor: selection.from + 1 + baseIndent.length }
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
            const content = match[4] || '';

            if (content.trim() === '' && textAfterCursor.trim() === '') {
                if (getIndentLevel(line.text) > 0) return handleIndent(view, -1);
                view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
                return true;
            }

            const tokens = parseTokens(prefix);
            if (tokens.length === 0) return false;
            
            const lastToken = tokens[tokens.length - 1];
            if (lastToken) lastToken.value++; 
            
            if (tokens.length > 4) {
                const insertText = `\n${indentStr}- `;
                view.dispatch({
                    changes: { from: selection.from, to: selection.from, insert: insertText },
                    selection: { anchor: selection.from + insertText.length }
                });
                return true;
            }

            const nextPrefix = buildPrefixString(tokens, prefix);
            
            let nextMarker = marker.replace(/\[[xX]\]/, '[ ]');
            let nextContentCb = '';
            
            if (!marker) {
                const cbMatch = content.match(/^((?:[-*+]\s+)?\[[ xX]\]\s+)/);
                if (cbMatch) {
                    nextContentCb = (cbMatch[1] || '').replace(/\[[xX]\]/, '[ ]');
                }
            }

            const insertText = `\n${indentStr}${nextMarker}${nextPrefix} ${nextContentCb}`;

            view.dispatch({
                changes: { from: selection.from, to: selection.from, insert: insertText },
                selection: { anchor: selection.from + insertText.length }
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

    let currentTokens: Token[] = [];
    let currentIndent = -1;
    const changes: any[] =[];
    let hasRewrites = false;

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
                    
                    const isPureUnordered = /^([ \t]*)([-*+]\s+\[[ xX]\]|[-*+])\s+/.test(prevListLine) && !PREFIX_REGEX.test(prevListLine);
                    if (isPureUnordered) {
                        const marker = prevListLine.match(/^([ \t]*)([-*+]\s+\[[ xX]\]|[-*+])\s+/)?.[2];
                        const currMatch = (match[2] || '').match(new RegExp(`^([-*+]\\s+\\[[ xX]\\]\\s+)?${LIST_PATTERN}\\s+(.*)$`));
                        if (marker && currMatch) {
                            newText = newIndent + marker + ' ' + (currMatch[3] || '');
                            convertedToUnordered = true;
                        }
                    }
                }
                text = newText;
            }
        }

        if (text.trim() === '') {
            if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
            continue;
        }

        if (isConsecutionBreaker(text) || convertedToUnordered) {
            currentTokens =[]; currentIndent = -1;
            if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
            continue;
        }

        const match = text.match(PREFIX_REGEX);
        if (!match) {
            if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
            continue;
        }

        const indentStr = match[1] || '';
        const indentLevel = getIndentLevel(text);
        const marker = match[2] || '';
        const userPrefix = match[3] || '';
        const content = match[4] || '';
        
        const rewrite = rewritePrefix(indentStr, marker, userPrefix, content);
        if (rewrite.changed) {
            changes.push({ from: line.from, to: line.to, insert: rewrite.newText });
            hasRewrites = true;
            currentTokens =[]; currentIndent = -1;
            continue; 
        }

        const userTokens = parseTokens(userPrefix);
        const expectedTokens = getNextTokens(userTokens, currentTokens, currentIndent, indentLevel);
        
        if (expectedTokens.length > 4) {
            changes.push({ from: line.from, to: line.to, insert: `${indentStr}- ${content}` });
            hasRewrites = true;
            currentTokens =[]; currentIndent = -1;
            continue;
        }

        currentTokens = expectedTokens;
        currentIndent = indentLevel;

        const newPrefix = buildPrefixString(currentTokens, userPrefix);
        const newLineText = `${indentStr}${marker}${newPrefix} ${content}`;
        if (newLineText !== line.text) changes.push({ from: line.from, to: line.to, insert: newLineText });
    }

    if (changes.length > 0) view.dispatch({ changes, annotations: hasRewrites ? undefined : SmartListSync.of(true) });
    return true;
}

export default class SmartOrderListPlugin extends Plugin {
    async onload() {
        console.log('Loading Smart Order List Plugin');
        this.registerEditorExtension([smartEnterPlugin, smartTabPlugin, smartSpacePlugin, autoRefreshPlugin, listMarkerDecorator]);

        this.addCommand({
            id: 'format-smart-list',
            name: 'Format Smart List',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                const text = editor.getSelection();
                if (!text) { new Notice("Please select the list you want to format first."); return; }
                
                const lines = text.split('\n');
                const result =[];
                let currentTokens: Token[] =[];
                let currentIndent = -1;
                
                let inCodeBlock = false;

                for (const line of lines) {
                    if (/^([ \t]*)(```|~~~)/.test(line)) { inCodeBlock = !inCodeBlock; result.push(line); continue; }
                    if (inCodeBlock) { result.push(line); continue; }

                    if (line.trim() === '') { result.push(line); continue; }
                    if (isConsecutionBreaker(line)) { currentTokens =[]; currentIndent = -1; result.push(line); continue; }

                    const match = line.match(PREFIX_REGEX);
                    if (!match) { result.push(line); continue; }

                    const indentStr = match[1] || '';
                    const indentLevel = getIndentLevel(line);
                    const marker = match[2] || '';
                    const userPrefix = match[3] || '';
                    const content = match[4] || '';
                    
                    const rewrite = rewritePrefix(indentStr, marker, userPrefix, content);
                    if (rewrite.changed) {
                        result.push(rewrite.newText);
                        currentTokens =[];
                        currentIndent = -1;
                        continue;
                    }

                    const userTokens = parseTokens(userPrefix);
                    const expectedTokens = getNextTokens(userTokens, currentTokens, currentIndent, indentLevel);
                    
                    if (expectedTokens.length > 4) {
                        result.push(`${indentStr}- ${content}`);
                        currentTokens =  [];
                        currentIndent = -1;
                        continue;
                    }

                    currentTokens = expectedTokens;
                    currentIndent = indentLevel;

                    const newPrefix = buildPrefixString(currentTokens, userPrefix);
                    result.push(`${indentStr}${marker}${newPrefix} ${content}`);
                }
                editor.replaceSelection(result.join('\n'));
            }
        });
    }
}