// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

/**
 * Create a DOM element with an optional given ID and class list.
 *
 * If a parent is provided, the element is automatically added as a child.
 *
 * @param {*} type      Element tag (div, span, etc.)
 * @param {*} id        Optional element id
 * @param {*} classList Optional array of class names
 * @param {*} parent    Optional parent element
 *
 * @returns             The created DOM element
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    type: K,
    id = '',
    classList: string[] = [],
    parent: Node | undefined = undefined,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(type);
    if (id !== '')
        element.id = id;
    if (classList !== [])
        classList.forEach(class_name => {
            if (!element.classList.contains(class_name))
                element.classList.add(class_name);
        });
    if (parent)
        parent.appendChild(element);
    return element;
}
