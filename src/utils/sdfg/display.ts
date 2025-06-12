// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { simplify } from 'mathjs';
import {
    DataSubset,
    JsonSDFGCodeBlock,
    JsonSDFGLogicalGroup,
    JsonSDFGMemletAttributes,
    JsonSDFGSerializedAtom,
    JsonSDFGSymExpr,
    JsonSDFGTypeclass,
    SDFGRange,
} from '../../types';
import {
    SDFVSettingKey,
    SDFVSettings,
    SDFVSettingValT,
} from '../sdfv_settings';


/**
 * Convert an SDFG range element to a string.
 * @param range    Range element to convert.
 * @param settings Current view settings.
 * @returns        String representation of `range`.
 */
export function sdfgRangeElemToString(
    range: SDFGRange, settings?: Record<SDFVSettingKey, SDFVSettingValT>
): string {
    let preview = '';
    const step = parseInt(range.step);
    const tile = parseInt(range.tile);
    if (range.start === range.end && step === 1 && tile === 1) {
        preview += sdfgPropertyToString(range.start, settings);
    } else {
        if (settings?.inclusiveRanges) {
            preview += sdfgPropertyToString(range.start, settings) + '..' +
                sdfgPropertyToString(range.end, settings);
        } else {
            let endp1 = sdfgPropertyToString(range.end, settings) + ' + 1';
            try {
                endp1 = simplify(endp1).toString();
            } catch (_e) {}
            preview += sdfgPropertyToString(range.start, settings) + ':' +
                endp1;
        }

        if (step !== 1) {
            preview += ':' + sdfgPropertyToString(range.step, settings);
            if (tile !== 1)
                preview += ':' + sdfgPropertyToString(range.tile, settings);
        } else if (tile !== 1) {
            preview += '::' + sdfgPropertyToString(range.tile, settings);
        }
    }
    return preview;
}

/**
 * Convert an SDFG consume element to a string.
 * @param numPEs   Number of PEs.
 * @param settings Current view settings.
 * @returns        String representation of `numPEs`.
 */
export function sdfgConsumeElemToString(
    numPEs: number, settings?: Record<SDFVSettingKey, SDFVSettingValT>
): string {
    let result = '0';
    if (settings?.inclusiveRanges)
        result += '..' + (numPEs - 1).toString();
    else
        result += ':' + numPEs.toString();
    return result;
}

/**
 * Convert SDFG properties to their string representation.
 * @param prop      SDFG property.
 * @param settings  Current view settings.
 * @returns         A string representation of the property `prop`.
 */
export function sdfgPropertyToString(
    prop: unknown, settings?: Record<SDFVSettingKey, SDFVSettingValT>
): string {
    if (prop === null || prop === undefined)
        return '';
    if (typeof prop === 'boolean') {
        if (prop)
            return 'True';
        return 'False';
    } else if (typeof prop === 'string') {
        return prop;
    } else if (Object.hasOwn(prop, 'type')) {
        const sProp = prop as JsonSDFGSerializedAtom;
        if (sProp.type === 'Indices' || sProp.type === 'subsets.Indices') {
            const indices = (sProp as DataSubset).indices;
            let preview = '[';
            for (const index of indices ?? [])
                preview += sdfgPropertyToString(index, settings) + ', ';
            return preview.slice(0, -2) + ']';
        } else if (sProp.type === 'Range' || sProp.type === 'subsets.Range') {
            const ranges = (sProp as DataSubset).ranges;
            let preview = '[';
            for (const range of ranges ?? [])
                preview += sdfgRangeElemToString(range, settings) + ', ';
            return preview.slice(0, -2) + ']';
        } else if (sProp.type === 'SubsetUnion' ||
                sProp.type === 'subsets.SubsetUnion') {
            const subsList = (sProp as DataSubset).subset_list ?? [];
            if (subsList.length < 2)
                return sdfgPropertyToString(subsList[0], settings);
            let preview = '{';
            for (const subs of subsList)
                preview += sdfgPropertyToString(subs, settings) + '\n';
            return preview + '}';
        } else if (sProp.type === 'LogicalGroup') {
            return '<span style="color: ' +
                ((sProp as JsonSDFGLogicalGroup).color ?? 'black') +
                ';">' + ((sProp as JsonSDFGLogicalGroup).name ?? '') + ' (' +
                ((sProp as JsonSDFGLogicalGroup).color ?? 'undefined') +
                ' )</span>';
        }
    } else if (Object.hasOwn(prop, 'language')) {
        const codesProp = prop as JsonSDFGCodeBlock;
        if (codesProp.string_data !== '' &&
            codesProp.string_data !== undefined &&
            codesProp.string_data !== null) {
            return '<pre class="code"><code>' +
                codesProp.string_data.trim() +
                '</code></pre><div class="clearfix"></div>';
        }
        return '';
    } else if (Object.hasOwn(prop, 'main') &&
        Object.hasOwn(prop, 'approx') &&
        (prop as JsonSDFGSymExpr).main !== undefined &&
        (prop as JsonSDFGSymExpr).approx !== undefined) {
        return (prop as JsonSDFGSymExpr).main!;
    } else if (prop.constructor === Object) {
        // General dictionary / object.
        return '<pre class="code"><code>' +
            JSON.stringify(prop, undefined, 4) +
            '</code></pre><div class="clearfix"></div>';
    } else if (prop.constructor === Array) {
        // Array of properties / general array.
        let result = '[ ';
        let first = true;
        for (const subsProp of prop as unknown[]) {
            if (!first)
                result += ', ';
            result += sdfgPropertyToString(subsProp, settings);
            first = false;
        }
        return result + ' ]';
    }
    console.error('Property could not be converted to a string:', prop);
    throw Error('Property could not be converted to a string');
}

/**
 * Create an HTML representation of an SDFG memlet.
 * @param memletAttributes Attributes of the SDFG memlet.
 * @returns                String containing the memlet's HTML representation.
 */
export function memletToHtml(
    memletAttributes: JsonSDFGMemletAttributes
): string {
    const dsettings = SDFVSettings.settingsDict;

    let htmlStr = memletAttributes.data ?? '';
    htmlStr += sdfgPropertyToString(memletAttributes.subset, dsettings);

    if (memletAttributes.other_subset) {
        // TODO: Obtain other data name, if possible
        if (memletAttributes.is_data_src) {
            htmlStr += ' -> ' + sdfgPropertyToString(
                memletAttributes.other_subset, dsettings
            );
        } else {
            htmlStr = sdfgPropertyToString(
                memletAttributes.other_subset, dsettings
            ) + ' -> ' + htmlStr;
        }
    }

    if (memletAttributes.wcr) {
        htmlStr += '<br /><b>CR: ' + sdfgPropertyToString(
            memletAttributes.wcr, dsettings
        ) + '</b>';
    }

    let numAccesses = null;
    if (memletAttributes.volume) {
        numAccesses = sdfgPropertyToString(
            memletAttributes.volume, dsettings
        );
    } else {
        numAccesses = sdfgPropertyToString(
            memletAttributes.num_accesses, dsettings
        );
    }

    if (memletAttributes.dynamic) {
        if (numAccesses === '0' || numAccesses === '-1') {
            numAccesses = '<b>Dynamic (unbounded)</b>';
        } else {
            numAccesses = '<b>Dynamic</b> (up to ' +
                numAccesses + ')';
        }
    } else if (numAccesses === '-1') {
        numAccesses = '<b>Dynamic (unbounded)</b>';
    }
    htmlStr += '<br /><font style="font-size: 14px">Volume: ' +
        numAccesses + '</font>';

    return htmlStr;
}

/**
 * Convert a string to an SDFG typeclass.
 * @param str String to convert.
 * @returns   Typeclass corresponding to `str`.
 */
export function stringToSDFGTypeclass(
    str: string
): JsonSDFGTypeclass | undefined {
    str.replace(/\s+/g, '');

    if (str === '' || str === 'null')
        return undefined;

    if (str.endsWith(')')) {
        if (str.startsWith('vector(')) {
            const argstring = str.substring(7, str.length - 1);
            if (argstring) {
                const splitidx = argstring.lastIndexOf(',');
                if (splitidx) {
                    const dtype = stringToSDFGTypeclass(
                        argstring.substring(0, splitidx)
                    );
                    const count = argstring.substring(splitidx);
                    if (dtype && count) {
                        return {
                            type: 'vector',
                            dtype: dtype,
                            elements: count,
                        };
                    }
                }
            }
        } else if (str.startsWith('pointer(')) {
            const argstring = str.substring(8, str.length - 1);
            if (argstring) {
                return {
                    type: 'pointer',
                    dtype: stringToSDFGTypeclass(argstring),
                };
            }
        } else if (str.startsWith('opaque(')) {
            const argstring = str.substring(7, str.length - 1);
            if (argstring) {
                return {
                    type: 'opaque',
                    name: argstring,
                };
            }
        } else if (str.startsWith('callback(')) {
            const argstring = str.substring(9, str.length - 1);
            if (argstring) {
                const splitidx = argstring.lastIndexOf(',');
                if (splitidx) {
                    const cbArgString = argstring.substring(0, splitidx);
                    if (cbArgString.startsWith('[') &&
                        cbArgString.endsWith(']')) {
                        const cbArgsRaw = cbArgString.substring(
                            1, cbArgString.length - 1
                        ).split(',');
                        const retType = stringToSDFGTypeclass(
                            argstring.substring(splitidx)
                        );

                        const cbArgs: any[] = [];
                        cbArgsRaw.forEach(rawArg => {
                            cbArgs.push(stringToSDFGTypeclass(rawArg));
                        });

                        if (retType) {
                            return {
                                type: 'callback',
                                arguments: cbArgs,
                                returntype: retType,
                            };
                        }
                    }
                }
            }
        }
    }

    console.error('Could not convert string to typeclass: ', str);
    throw Error('Could not convert string to typeclass');
}

/**
 * Convert an SDFG typeclass property to a string.
 * @param typeclass Typeclass property to convert.
 * @returns         String representation of `typeclass`.
 */
export function sdfgTypeclassToString(typeclass: unknown): string {
    if (typeclass === undefined || typeclass === null)
        return 'null';

    if (typeof typeclass === 'string') {
        return typeclass;
    } else if (typeclass.constructor === Object) {
        if (Object.hasOwn(typeclass, 'type') &&
            (typeclass as JsonSDFGSerializedAtom).type !== undefined) {
            const sdfgTclass = typeclass as JsonSDFGTypeclass;
            switch (sdfgTclass.type) {
                case 'vector':
                    if (sdfgTclass.elements !== undefined &&
                        sdfgTclass.dtype !== undefined) {
                        return 'vector(' + sdfgTypeclassToString(
                            sdfgTclass.dtype
                        ) + ', ' + sdfgTclass.elements + ')';
                    }
                    break;
                case 'pointer':
                    if (sdfgTclass.dtype !== undefined) {
                        return 'pointer(' + sdfgTypeclassToString(
                            sdfgTclass.dtype
                        ) + ')';
                    }
                    break;
                case 'opaque':
                    if (sdfgTclass.name !== undefined)
                        return 'opaque(' + sdfgTclass.name + ')';
                    break;
                case 'callback':
                    if (sdfgTclass.arguments !== undefined) {
                        let str = 'callback([';
                        for (let i = 0; i < sdfgTclass.arguments.length; i++) {
                            str += sdfgTypeclassToString(
                                sdfgTclass.arguments[i]
                            );
                            if (i < sdfgTclass.arguments.length - 1)
                                str += ', ';
                        }
                        str += '], ';
                        if (sdfgTclass.returntype !== undefined) {
                            str += sdfgTypeclassToString(
                                sdfgTclass.returntype
                            );
                        } else {
                            str += 'None';
                        }
                        str += ')';
                        return str;
                    }
                    break;
            }
        }

        // This is an unknown typeclass, just show the entire JSON.
        return sdfgPropertyToString(typeclass);
    }

    console.error('Typeclass cannot be converted to a string:', typeclass);
    throw Error('Typeclass cannot be converted to a string');
}

/**
 * Format bytes as human-readable text.
 * Taken from https://stackoverflow.com/a/14919494
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
export function bytesToString(
    bytes: number, si: boolean = false, dp: number = 1
) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh)
        return bytes.toString() + ' B';

    const units = si ?
        ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] :
        ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10**dp;

    do {
        bytes /= thresh;
        ++u;
    } while (
        Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1
    );

    return bytes.toFixed(dp) + ' ' + units[u];
}
