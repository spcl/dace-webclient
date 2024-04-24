// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    MapExit,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
    State,
} from '../renderer/renderer_elements';
import { Point2D } from '..';
import { rgb2hex } from '@pixi/utils';
import $ from 'jquery';

declare const SDFGRenderer: any;

// From: https://eleanormaclure.files.wordpress.com/2011/03/colour-coding.pdf,
// Via: https://stackoverflow.com/a/4382138/3547036
export const KELLY_COLORS = [
    0xFFB300, // Vivid Yellow
    0x803E75, // Strong Purple
    0xFF6800, // Vivid Orange
    0xA6BDD7, // Very Light Blue
    0xC10020, // Vivid Red
    0xCEA262, // Grayish Yellow
    0x817066, // Medium Gray

    // The following don't work well for people with defective color vision.
    0x007D34, // Vivid Green
    0xF6768E, // Strong Purplish Pink
    0x00538A, // Strong Blue
    0xFF7A5C, // Strong Yellowish Pink
    0x53377A, // Strong Violet
    0xFF8E00, // Vivid Orange Yellow
    0xB32851, // Strong Purplish Red
    0xF4C800, // Vivid Greenish Yellow
    0x7F180D, // Strong Reddish Brown
    0x93AA00, // Vivid Yellowish Green
    0x593315, // Deep Yellowish Brown
    0xF13A13, // Vivid Reddish Orange
    0x232C16, // Dark Olive Green
];

export function equals<T>(a: T, b: T): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function deepCopy<T>(obj: T): T {
    if (typeof obj !== 'object' || obj === null)
        return obj;
    if (Array.isArray(obj))
        return obj.map(o => deepCopy(o)) as any;
    else
        return Object.fromEntries(deepCopy([...Object.entries(obj)])) as any;
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
    for (const class_name of classList) {
        if (!element.classList.contains(class_name))
            element.classList.add(class_name);
    }
    if (parent)
        parent.appendChild(element);
    return element;
}

/**
 * Similar to Object.assign, but skips properties that already exist in `obj`.
 */
export function assignIfNotExists<T, E>(
    obj: T, other: E
): T & Omit<E, keyof T> {
    const o = obj as any;
    for (const [key, val] of Object.entries(other as any)) {
        if (!(key in (obj as any)))
            o[key] = val;
    }
    return o;
}

// This function was taken from the now deprecated dagrejs library, see:
// https://github.com/dagrejs/dagre/blob/c8bb4a1b891fc50071e6fac7bd84658d31eb9d8a/lib/util.js#L96
/*
 * Finds where a line starting at point ({x, y}) would intersect a rectangle
 * ({x, y, width, height}) if it were pointing at the rectangle's center.
 */
export function intersectRect(
    rect: { x: number, y: number, height: number, width: number },
    point: Point2D
): Point2D {
    const x = rect.x;
    const y = rect.y;

    // Rectangle intersection algorithm from:
    // http://math.stackexchange.com/questions/108113/find-edge-between-two-boxes
    const dx = point.x - x;
    const dy = point.y - y;
    let w = rect.width / 2;
    let h = rect.height / 2;

    if (!dx && !dy) {
        throw new Error(
            'Not possible to find intersection inside of the rectangle'
        );
    }

    let sx, sy;
    if (Math.abs(dy) * w > Math.abs(dx) * h) {
        // Intersection is top or bottom of rect.
        if (dy < 0)
            h = -h;
        sx = h * dx / dy;
        sy = h;
    } else {
        // Intersection is left or right of rect.
        if (dx < 0)
            w = -w;
        sx = w;
        sy = w * dy / dx;
    }

    return {
        x: x + sx,
        y: y + sy,
    };
}

export function hsl2rgb(h: number, s: number, l: number): number[] {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number, k = (n + h / 30) % 12): number => {
        return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return [f(0), f(8), f(4)];
}

function tempColor(badness: number): [number, number, number] {
    if (Number.isNaN(badness))
        badness = 0;

    if (badness < 0)
        badness = 0;
    else if (badness > 1)
        badness = 1;

    // The hue of the green-red spectrum must lie between 0 and 120, so we map
    // the 'badness' to that interval (inverted, since green=120 hue and
    // red=0 hue).
    const maxHue = 120;
    let saturation = 1.0;
    let lightness = 0.75;
    try {
        saturation = parseFloat(
            SDFGRenderer.getCssProperty('--overlay-color-saturation')
        );
        lightness = parseFloat(
            SDFGRenderer.getCssProperty('--overlay-color-lightness')
        );
    } catch (_ignored) {
        // Ignored.
    }
    return [(1 - badness) * maxHue, saturation, lightness];
}

/**
 * Get the color on a green-red temperature scale based on a fractional value.
 * @param {Number} val Value between 0 and 1, 0 = green, .5 = yellow, 1 = red
 * @returns            HSL color string
 */
export function getTempColorHslString(badness: number): string {
    const col = tempColor(badness);
    return 'hsl(' + col[0] + ',' + (col[1] * 100) + '%,' + (col[2] * 100) +
        '%)';
}

/**
 * Get the color on a green-red temperature scale based on a fractional value.
 * @param {Number} val Value between 0 and 1, 0 = green, .5 = yellow, 1 = red
 * @returns            Hex color number
 */
export function getTempColorHEX(badness: number): number {
    return rgb2hex(hsl2rgb(...tempColor(badness)));
}

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
        html: '<i class="material-icons">close</i>',
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
