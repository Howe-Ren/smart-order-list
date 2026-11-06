/** DOM nodes from an Obsidian pop-out window have different constructors. */
export function isElement(node: Node | null): node is Element {
    return node !== null && node.nodeType === Node.ELEMENT_NODE;
}

export function isHtmlElement(node: Node | null): node is HTMLElement {
    return isElement(node) && node.namespaceURI === 'http://www.w3.org/1999/xhtml';
}
