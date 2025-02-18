// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { simplify } from 'mathjs';
import type { SDFGRenderer } from '../../renderer/renderer';

export function sdfg_range_elem_to_string(
    range: any,
    settings: any = null
): string {
    let preview = '';
    const step = parseInt(range.step);
    const tile = parseInt(range.tile);
    if (range.start === range.end && step === 1 && tile === 1) {
        preview += sdfg_property_to_string(range.start, settings);
    } else {
        if (settings && settings.inclusive_ranges) {
            preview += sdfg_property_to_string(range.start, settings) + '..' +
                sdfg_property_to_string(range.end, settings);
        } else {
            let endp1 = sdfg_property_to_string(range.end, settings) + ' + 1';
            try {
                endp1 = simplify(endp1).toString();
            } catch (e) { }
            preview += sdfg_property_to_string(range.start, settings) + ':' +
                endp1;
        }

        if (step !== 1) {
            preview += ':' + sdfg_property_to_string(range.step, settings);
            if (tile !== 1)
                preview += ':' + sdfg_property_to_string(range.tile, settings);
        } else if (tile !== 1) {
            preview += '::' + sdfg_property_to_string(range.tile, settings);
        }
    }
    return preview;
}

export function sdfg_consume_elem_to_string(
    num_pes: number,
    settings: any = null
): string {
    let result = '0';
    if (settings && settings.inclusive_ranges)
        result += '..' + (num_pes - 1).toString();
    else
        result += ':' + num_pes.toString();
    return result;
}

// Includes various properties and returns their string representation
export function sdfg_property_to_string(
    prop: any,
    settings: any = null
): string {
    if (prop === null || prop === undefined)
        return prop;
    if (typeof prop === 'boolean') {
        if (prop)
            return 'True';
        return 'False';
    } else if (prop.type === 'Indices' || prop.type === 'subsets.Indices') {
        const indices = prop.indices;
        let preview = '[';
        for (const index of indices)
            preview += sdfg_property_to_string(index, settings) + ', ';
        return preview.slice(0, -2) + ']';
    } else if (prop.type === 'Range' || prop.type === 'subsets.Range') {
        const ranges = prop.ranges;

        // Generate string from range
        let preview = '[';
        for (const range of ranges)
            preview += sdfg_range_elem_to_string(range, settings) + ', ';
        return preview.slice(0, -2) + ']';
    } else if (prop.type === 'SubsetUnion' ||
               prop.type === 'subsets.SubsetUnion') {
        const subsList = prop.subset_list;
        if (subsList.length < 2)
            return sdfg_property_to_string(subsList[0], settings);
        let preview = '{';
        for (const subs of subsList)
            preview += sdfg_property_to_string(subs, settings) + '\n';
        return preview + '}';
    } else if (prop.type === 'LogicalGroup' && prop.color !== undefined &&
        prop.name !== undefined) {
        return '<span style="color: ' + prop.color + ';">' + prop.name + ' (' +
            prop.color + ' )</span>';
    } else if (prop.language !== undefined) {
        // Code
        if (prop.string_data !== '' && prop.string_data !== undefined &&
            prop.string_data !== null) {
            return '<pre class="code"><code>' + prop.string_data.trim() +
                '</code></pre><div class="clearfix"></div>';
        }
        return '';
    } else if (prop.approx !== undefined && prop.main !== undefined) {
        // SymExpr
        return prop.main;
    } else if (prop.constructor === Object) {
        // General dictionary
        return '<pre class="code"><code>' + JSON.stringify(prop, undefined, 4) +
            '</code></pre><div class="clearfix"></div>';
    } else if (prop.constructor === Array) {
        // General array
        let result = '[ ';
        let first = true;
        for (const subprop of prop) {
            if (!first)
                result += ', ';
            result += sdfg_property_to_string(subprop, settings);
            first = false;
        }
        return result + ' ]';
    } else {
        return prop;
    }
}

export function memletToHtml(
    renderer: SDFGRenderer, memletAttributes: any
): string {
        const dsettings = renderer.view_settings();

        let htmlStr = memletAttributes.data;
        htmlStr += sdfg_property_to_string(memletAttributes.subset, dsettings);

        if (memletAttributes.other_subset) {
            // TODO: Obtain other data name, if possible
            if (memletAttributes.is_data_src) {
                htmlStr += ' -> ' + sdfg_property_to_string(
                    memletAttributes.other_subset, dsettings
                );
            } else {
                htmlStr = sdfg_property_to_string(
                    memletAttributes.other_subset, dsettings
                ) + ' -> ' + htmlStr;
            }
        }

        if (memletAttributes.wcr) {
            htmlStr += '<br /><b>CR: ' + sdfg_property_to_string(
                memletAttributes.wcr, dsettings
            ) + '</b>';
        }

        let num_accesses = null;
        if (memletAttributes.volume) {
            num_accesses = sdfg_property_to_string(
                memletAttributes.volume, dsettings
            );
        } else {
            num_accesses = sdfg_property_to_string(
                memletAttributes.num_accesses, dsettings
            );
        }

        if (memletAttributes.dynamic) {
            if (num_accesses === '0' || num_accesses === '-1') {
                num_accesses = '<b>Dynamic (unbounded)</b>';
            } else {
                num_accesses = '<b>Dynamic</b> (up to ' +
                    num_accesses + ')';
            }
        } else if (num_accesses === '-1') {
            num_accesses = '<b>Dynamic (unbounded)</b>';
        }
        htmlStr += '<br /><font style="font-size: 14px">Volume: ' +
            num_accesses + '</font>';

        return htmlStr;
}

export function string_to_sdfg_typeclass(str: string): any {
    str.replace(/\s+/g, '');

    if (str === '' || str === 'null')
        return null;

    if (str.endsWith(')')) {
        if (str.startsWith('vector(')) {
            const argstring = str.substring(7, str.length - 1);
            if (argstring) {
                const splitidx = argstring.lastIndexOf(',');
                if (splitidx) {
                    const dtype = string_to_sdfg_typeclass(
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
                    dtype: string_to_sdfg_typeclass(argstring),
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
                    const cb_argstring = argstring.substring(0, splitidx);
                    if (cb_argstring.startsWith('[') &&
                        cb_argstring.endsWith(']')) {
                        const cb_args_raw = cb_argstring.substring(
                            1, cb_argstring.length - 1
                        ).split(',');
                        const ret_type = string_to_sdfg_typeclass(
                            argstring.substring(splitidx)
                        );

                        const cb_args: any[] = [];
                        if (cb_args_raw) {
                            cb_args_raw.forEach(raw_arg => {
                                cb_args.push(string_to_sdfg_typeclass(raw_arg));
                            });
                        }

                        if (cb_args && ret_type) {
                            return {
                                type: 'callback',
                                arguments: cb_args,
                                returntype: ret_type,
                            };
                        }
                    }
                }
            }
        }
    }
    return str;
}

export function sdfg_typeclass_to_string(typeclass: any): string {
    if (typeclass === undefined || typeclass === null)
        return 'null';

    if (typeclass.constructor === Object) {
        if (typeclass.type !== undefined) {
            switch (typeclass.type) {
                case 'vector':
                    if (typeclass.elements !== undefined &&
                        typeclass.dtype !== undefined) {
                        return 'vector(' + sdfg_typeclass_to_string(
                            typeclass.dtype
                        ) + ', ' + typeclass.elements + ')';
                    }
                    break;
                case 'pointer':
                    if (typeclass.dtype !== undefined) {
                        return 'pointer(' + sdfg_typeclass_to_string(
                            typeclass.dtype
                        ) + ')';
                    }
                    break;
                case 'opaque':
                    if (typeclass.name !== undefined)
                        return 'opaque(' + typeclass.name + ')';
                    break;
                case 'callback':
                    if (typeclass.arguments !== undefined) {
                        let str = 'callback([';
                        for (let i = 0; i < typeclass.arguments.length; i++) {
                            str += sdfg_typeclass_to_string(
                                typeclass.arguments[i]
                            );
                            if (i < typeclass.arguments.length - 1)
                                str += ', ';
                        }
                        str += '], ';
                        if (typeclass.returntype !== undefined) {
                            str += sdfg_typeclass_to_string(
                                typeclass.returntype
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
        return sdfg_property_to_string(typeclass);
    }

    // This typeclass already is a regular string.
    return typeclass;
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
        return bytes + ' B';

    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
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
