// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import * as PIXI from 'pixi.js';

export function stringToColor(s: string): [rgbHex: number, alpha: number] {
    s = s.trim();

    if (s === 'transparent')
        return [0, 0];
    if (s.startsWith('#') && s.length >= 8) {
        return [
            stringToColor(s.substring(0, s.length - 2))[0],
            parseInt(s.substring(s.length - 2), 16) / 255
        ];
    }

    const res = PIXI.utils.string2hex(s);
    if (res !== res) { // NaN
        throw new Error(`Unknown color: ${s}. Not all CSS colors are supported; please use hex colors`);
    }
    return [res, 1];
}

export function colorToString(rgbHex: number, alpha: number): string {
    return `rgba(${[...PIXI.utils.hex2rgb(rgbHex)].map(x => 255 * x).join(', ')}, ${alpha})`;
}

/**
 * Returns a temperature color from green (0) over yellow (0.5) to red (1). Any values outside this range will be clamped.
 */
export function getTemperatureRGBHex(temperature: number): number {
    temperature = Math.min(1, Math.max(0, temperature));

    return PIXI.utils.rgb2hex([
        Math.min(1, temperature * 2),
        Math.min(1, (1 - temperature) * 2),
        0,
    ]);
}

/**
 * Returns the color that results from overlaying all the given colors in order. This is not useful if all colors are
 * fully opaque.
 * 
 * For example, overlaying `rgba(255, 255, 0, 1)` (fully opaque yellow) with `rgba(255, 0, 0, 0.5)` (semi-opaque red)
 * will return orange.
 */
export function overlayColors(...colors: [rgbHex: number, alpha: number][]): [rgbHex: number, alpha: number] {
    if (colors.length === 0) {
        return [0, 0];
    } else if (colors.length === 1) {
        return colors[0];
    } else {
        /*
         * If the first color is fully opaque, we can use the opacity formula `(1-alpha)*baseC + alpha*newC`. If it's
         * not, we have to find a color `resC` such that for every fully opaque color `baseC`,
         * `overlayColors(baseC, ...colors)` equals `overlayColors(baseC, resC)`.
         * 
         * ```ts
         * overlayColorChannels([baseC, 1], [c1, a1], [c2, a2])
         * = (1-a2)*overlayColorChannels([baseC, 1], [c1, a1]) + a2*c2
         * = (1-a2)*((1-a1)*baseC + a1*c1) + a2*c2
         * = (1-a2)*(1-a1)*baseC + (1-a2)*a1*c1 + a2*c2
         * = (1-(a1+a2-a1*a2))*baseC + (1-a2)*a1*c1 + a2*c2
         * = (1-(a1+a2-a1*a2))*baseC + (a1+a2-a1*a2)*((a1-a1*a2)*c1 + a2*c2)/(a1+a2-a1*a2))
         * = overlayColorChannels([baseC, 1], [((a1-a1*a2)*c1 + a2*c2)/(a1+a2-a1*a2), a1+a2-a1*a2])
         * ```
         */
        const color1 = [...PIXI.utils.hex2rgb(colors[0][0])];
        const color2 = [...PIXI.utils.hex2rgb(colors[1][0])];
        const alpha1 = colors[0][1];
        const alpha2 = colors[1][1];

        const newAlpha = alpha1 + alpha2 - alpha1 * alpha2;
        const resC = color1.map((c1, i) => ((newAlpha - alpha2) * c1 + alpha2 * color2[i]) / newAlpha);

        return overlayColors([PIXI.utils.rgb2hex(resC), newAlpha], ...colors.slice(2));
    }
}
