/** Element formats that can occur in an ordered prefix. */
export type OrderedElementType = 'number' | 'paren' | 'upper' | 'lower' | 'chinese';

interface OrderedElement {
    type: OrderedElementType;
}

type CrossNestDecision = 'inherit' | 'overwrite';

const ELEMENT_RULES: Record<OrderedElementType, {
    id: number;
    family: 'numeral' | 'alphabet' | 'chinese';
    mixable: boolean;
}> = {
    number: { id: 1, family: 'numeral', mixable: true },
    paren: { id: 2, family: 'numeral', mixable: false },
    upper: { id: 3, family: 'alphabet', mixable: true },
    lower: { id: 4, family: 'alphabet', mixable: true },
    chinese: { id: 5, family: 'chinese', mixable: false }
};

/**
 * Decide how a child prefix relates to its ordered parent when there is no
 * preceding sibling to continue. `nesting` describes a Tab operation: it
 * retains the existing prefix-expansion and fallback behavior for indentation.
 */
export function decideCrossNest(
    parent: readonly OrderedElement[],
    trigger: readonly OrderedElement[],
    nesting = false
): CrossNestDecision {
    const parentLast = parent[parent.length - 1];
    const triggerLast = trigger[trigger.length - 1];
    if (!parentLast || !triggerLast || nesting) return 'inherit';

    const base = ELEMENT_RULES[parentLast.type];
    const requested = ELEMENT_RULES[triggerLast.type];
    if (!base.mixable || !requested.mixable) return 'overwrite';

    // Multi-slot inputs are already nested and keep their inherited ancestry.
    if (parent.length > 1 || trigger.length > 1) return 'inherit';

    if (base.family !== requested.family || requested.id > base.id) return 'overwrite';
    return 'inherit';
}
