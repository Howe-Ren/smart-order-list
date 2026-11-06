// Shared patterns for the supported ordered prefixes and optional task header.
const MIX_COMP = '(?:0|[1-9][0-9]*|[a-zA-Z])';
const SINGLE_ITEM = `(?:${MIX_COMP}\\.)`;
// Multi-slot prefixes use dots only between elements; a final dot is invalid.
const MULTI_ITEM = `(?:${MIX_COMP}(?:\\.${MIX_COMP}){1,3})`;
// Mixed zero is recognized as a candidate so the fallback can handle it.
const MIXED_LIST = `(?:${MULTI_ITEM}|${SINGLE_ITEM})(?!\\.?(?:[0-9]+|[a-zA-Z]+))`;
// Recognize larger Chinese numerals too, so an out-of-range entry can fall back.
export const LIST_PATTERN = `(${MIXED_LIST}|\\([1-9][0-9]*\\)|[零一二三四五六七八九十百千万亿]+、)`;
const MARKER_REGEX = '([-*+]\\s+\\[[ xX-]\\]\\s+)?';

export const PREFIX_REGEX = new RegExp(`^([ \\t]*)${MARKER_REGEX}${LIST_PATTERN}([ \\t]+)(.*)$`);
export const SPACE_REGEX = new RegExp(`^([ \\t]*)${MARKER_REGEX}${LIST_PATTERN}$`);
