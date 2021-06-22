// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

export function equals<T>(a: T, b: T): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}


export function deepCopy<T>(obj: T): T {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) {
        return obj.map(o => deepCopy(o)) as any;
    } else {
        return Object.fromEntries(deepCopy([...Object.entries(obj)])) as any;
    }
}

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
    parent: Node | undefined = undefined
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

/**
 * Similar to Object.assign, but skips properties that already exist in `obj`.
 */
export function assignIfNotExists<T, E>(obj: T, other: E): T & Omit<E, keyof T> {
    const o = obj as any;
    for (const [key, val] of Object.entries(other)) {
        if (!(key in obj)) o[key] = val;
    }
    return o;
}
