export interface ReadingAlignmentLine {
    depth: number;
    slotCount: number;
}

/** Parentheses are formatting; center their first digit rather than the opening bracket. */
export function leadingHeaderCharacterIndex(prefix: string): number {
    if (prefix.startsWith('(')) {
        const firstDigit = prefix.search(/[0-9]/);
        if (firstDigit >= 0) return firstDigit;
    }
    return 0;
}

/** Measure the first character's center without separating the prefix from its body. */
export function applyReadingHeaderOffsets(element: HTMLElement): void {
    const view = element.ownerDocument.defaultView;
    if (!view || !element.isConnected) return;
    const prefixes = element.querySelectorAll<HTMLElement>(
        'li.smart-list-native-override-reading > .smart-list-override-reading, ' +
        'li.smart-list-custom-reading > .smart-list-prefix-span-reading'
    );
    const offsets: { item: HTMLElement; value: string | null }[] = [];

    for (const prefix of Array.from(prefixes)) {
        const item = prefix.parentElement;
        const node = prefix.firstChild;
        if (!item || item.classList.contains('smart-list-checkbox-head') || !node || node.nodeType !== Node.TEXT_NODE) continue;

        const text = node.textContent ?? '';
        const index = leadingHeaderCharacterIndex(text);
        const character = Array.from(text.slice(index))[0];
        if (!character) continue;

        const range = element.ownerDocument.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + character.length);
        const characterBox = range.getBoundingClientRect();
        const prefixBox = prefix.getBoundingClientRect();
        const style = view.getComputedStyle(item);
        const fontSize = parseFloat(style.fontSize);
        if (characterBox.width <= 0 || prefixBox.width <= 0 || !Number.isFinite(fontSize) || fontSize <= 0) {
            offsets.push({ item, value: null });
            continue;
        }

        const center = characterBox.left + characterBox.width / 2;
        const offset = style.direction === 'rtl' ? prefixBox.right - center : center - prefixBox.left;
        offsets.push({ item, value: `${Math.round(offset / fontSize * 10000) / 10000}em` });
    }

    for (const { item, value } of offsets) {
        if (value === null) item.style.removeProperty('--sol-reading-head-offset');
        else if (item.style.getPropertyValue('--sol-reading-head-offset') !== value) {
            item.style.setProperty('--sol-reading-head-offset', value);
        }
    }
}

/** The README's dynamic distance, measured in ch for a parent prefix. */
export function distanceForSlots(slotCount: number): number {
    return slotCount <= 1 ? 2 : Math.round((2 + slotCount + (slotCount - 1) * 0.3) * 10) / 10;
}

/** Give children at the same depth under one root the largest parent distance. */
export function calculateDynamicNestDistances(
    lines: ReadonlyMap<number, ReadingAlignmentLine>,
    parentByLine: ReadonlyMap<number, number>
): Map<number, number> {
    const rootFor = (line: number): number => {
        const seen = new Set<number>();
        let root = line;
        while (parentByLine.has(root) && !seen.has(root)) {
            seen.add(root);
            root = parentByLine.get(root)!;
        }
        return root;
    };

    const maximums = new Map<number, Map<number, number>>();
    for (const [line, info] of lines) {
        const root = rootFor(line);
        let depths = maximums.get(root);
        if (!depths) {
            depths = new Map<number, number>();
            maximums.set(root, depths);
        }
        depths.set(info.depth, Math.max(depths.get(info.depth) ?? 2, distanceForSlots(info.slotCount)));
    }

    const distances = new Map<number, number>();
    for (const [child, parent] of parentByLine) {
        const parentInfo = lines.get(parent);
        if (!parentInfo) continue;
        distances.set(child, maximums.get(rootFor(parent))?.get(parentInfo.depth) ?? 2);
    }
    return distances;
}

/** Attach the Profile 2 distances to the actual child lists after tree repair. */
export function applyReadingNestDistances(
    element: HTMLElement,
    lines: ReadonlyMap<number, ReadingAlignmentLine>,
    parentByLine: ReadonlyMap<number, number>,
    items: ReadonlyMap<number, HTMLElement>
): void {
    const childLists = element.querySelectorAll<HTMLElement>('ol.smart-list-reading-child, ul.smart-list-reading-child');
    for (const list of Array.from(childLists)) {
        // Older builds set these properties inline, which would mask the profile CSS.
        if (list.style.getPropertyValue('--sol-reading-nest-distance')) {
            list.style.removeProperty('--sol-reading-nest-distance');
            for (const property of ['padding-inline-start', 'padding-left', 'margin-inline-start', 'margin-left']) {
                list.style.removeProperty(property);
            }
        }
        list.style.removeProperty('--sol-reading-dynamic-distance');
    }

    for (const [line, distance] of calculateDynamicNestDistances(lines, parentByLine)) {
        const list = items.get(line)?.parentElement;
        if (list?.matches('ol.smart-list-reading-child, ul.smart-list-reading-child')) {
            list.style.setProperty('--sol-reading-dynamic-distance', `${distance}ch`);
        }
    }
}
