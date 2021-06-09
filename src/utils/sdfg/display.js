// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { simplify } from 'mathjs';

export function sdfg_range_elem_to_string(range, settings = null) {
    let preview = '';
    if (range.start == range.end && range.step == 1 && range.tile == 1)
        preview += sdfg_property_to_string(range.start, settings);
    else {
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
        if (range.step != 1) {
            preview += ':' + sdfg_property_to_string(range.step, settings);
            if (range.tile != 1)
                preview += ':' + sdfg_property_to_string(range.tile, settings);
        } else if (range.tile != 1) {
            preview += '::' + sdfg_property_to_string(range.tile, settings);
        }
    }
    return preview;
}


// Includes various properties and returns their string representation
export function sdfg_property_to_string(prop, settings = null) {
    if (prop === null) return prop;
    if (typeof prop === 'boolean') {
        if (prop)
            return 'True';
        return 'False';
    } else if (prop.type === "Indices" || prop.type === "subsets.Indices") {
        const indices = prop.indices;
        let preview = '[';
        for (const index of indices) {
            preview += sdfg_property_to_string(index, settings) + ', ';
        }
        return preview.slice(0, -2) + ']';
    } else if (prop.type === "Range" || prop.type === "subsets.Range") {
        const ranges = prop.ranges;

        // Generate string from range
        let preview = '[';
        for (const range of ranges) {
            preview += sdfg_range_elem_to_string(range, settings) + ', ';
        }
        return preview.slice(0, -2) + ']';
    } else if (prop.language !== undefined) {
        // Code
        if (prop.string_data !== '' && prop.string_data !== undefined && prop.string_data !== null)
            return '<pre class="code"><code>' + prop.string_data.trim() +
                '</code></pre><div class="clearfix"></div>';
        return '';
    } else if (prop.approx !== undefined && prop.main !== undefined) {
        // SymExpr
        return prop.main;
    } else if (prop.constructor == Object) {
        // General dictionary
        return '<pre class="code"><code>' + JSON.stringify(prop, undefined, 4) +
            '</code></pre><div class="clearfix"></div>';
    } else if (prop.constructor == Array) {
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
