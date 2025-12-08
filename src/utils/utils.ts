// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import {
    hex2hexnum,
    hsl2rgb,
    hsl2string,
    rgb2hex,
    tempColor,
} from 'rendure';


/**
 * A general purpose equality check for objects.
 * This is sensitive to ordering.
 * @param a First object to compare.
 * @param b Second object to compare.
 * @returns Boolean indicating whether the objects are considered equal.
 */
export function equals<T>(a: T, b: T): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Create a deep copy for an object.
 * @param obj Object to copy.
 * @returns   Copy of `obj`.
 */
export function deepCopy<T>(obj: T): T {
    if (typeof obj !== 'object' || obj === null)
        return obj;
    if (Array.isArray(obj))
        return obj.map(o => deepCopy(o) as unknown) as T;
    else
        return Object.fromEntries(deepCopy([...Object.entries(obj)])) as T;
}

/**
 * Create a DOM element with an optional given ID and class list.
 *
 * If a parent is provided, the element is automatically added as a child.
 *
 * @param type      Element tag (div, span, etc.)
 * @param id        Optional element id
 * @param classList Optional array of class names
 * @param parent    Optional parent element
 *
 * @returns             The created DOM element
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    type: K,
    id: string = '',
    classList: string[] = [],
    parent: Node | undefined = undefined
): HTMLElementTagNameMap[K] {
    const element = document.createElement(type);
    if (id !== '')
        element.id = id;
    for (const className of classList) {
        if (!element.classList.contains(className))
            element.classList.add(className);
    }
    if (parent)
        parent.appendChild(element);
    return element;
}

/**
 * Similar to Object.assign, but skips properties that already exist in `obj`.
 * @param obj   Object to which to assign.
 * @param other Other object, from which to assign.
 * @returns     Object `obj` with all properties from `other` if not previously
 *              a part of `obj`.
 */
export function assignIfNotExists<T, E>(
    obj: T, other: E
): T & E {
    for (const [key, val] of Object.entries(other as object)) {
        if (!Object.hasOwn(obj as object, key)) {
            /* eslint-disable-next-line
               @typescript-eslint/no-unsafe-member-access */
            (obj as any)[key] = val as unknown;
        }
    }
    return obj as T & E;
}

/**
 * Get the color on a green-red temperature scale based on a fractional value.
 * @param val Value between 0 and 1, 0 = green, .5 = yellow, 1 = red
 * @returns   HSL color string
 */
export function getTempColorHslString(badness: number): string {
    return hsl2string(tempColor(badness));
}

/**
 * Get the color on a green-red temperature scale based on a fractional value.
 * @param val Value between 0 and 1, 0 = green, .5 = yellow, 1 = red
 * @returns   Hex color number
 */
export function getTempColorHEX(badness: number): number {
    const rval = hex2hexnum(rgb2hex(hsl2rgb(...tempColor(badness))));
    if (rval === null)
        return 0x000000; // Default to black if conversion fails
    return rval;
}

/**
 * Display a modal popup with an error message.
 * @param message Message to display.
 * @param title   Optional title of the modal. Defaults to 'Error'.
 */
export function showErrorModal(message: string, title: string = 'Error'): void {
    const errModalBg = $('<div>', {
        class: 'sdfv_modal_background',
    }).appendTo(document.body);
    const modal = $('<div>', {
        class: 'sdfv_modal',
    }).appendTo(errModalBg);
    const header = $('<div>', {
        class: 'sdfv_modal_title_bar',
    }).appendTo(modal);
    $('<span>', {
        class: 'sdfv_modal_title',
        text: title,
    }).appendTo(header);
    $('<div>', {
        class: 'modal_close',
        html: '<i class="material-symbols-outlined">close</i>',
        click: () => errModalBg.remove(),
    }).appendTo(header);

    const contentBox = $('<div>', {
        class: 'sdfv_modal_content_box',
    }).appendTo(modal);
    const content = $('<div>', {
        class: 'sdfv_modal_content',
    }).appendTo(contentBox);
    $('<span>', {
        text: message,
    }).appendTo(content);
    errModalBg.show();
}

export function median(values: number[]): number {
    if (values.length === 0)
        throw new Error('Input array is empty');

    // Sorting values, preventing original array from being mutated.
    values = [...values].sort((a, b) => a - b);
    const half = Math.floor(values.length / 2);
    return (
        values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2
    );
}

// A utility type to create a single type from a discriminate union of types.
type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends (
        (k: infer I) => void
    ) ? I : never;

type Indexify<T> = T & Record<string, undefined>;
type UndefinedVals<T> = { [K in keyof T]: undefined };
type AllUnionKeys<T> = keyof UnionToIntersection<UndefinedVals<T>>;
export type AllFields<T> = { [K in AllUnionKeys<T> & string]: Indexify<T>[K] };
