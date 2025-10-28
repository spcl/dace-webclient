// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { gunzipSync } from 'zlib';
import { JsonSDFG } from '../../types';
import { Edge } from '../../renderer/sdfg/sdfg_elements';
import { setCollapseStateRecursive } from './sdfg_utils';


const propertyReplacements_0_16_0: Record<string, {
    replaceWith: string,
    recursive: boolean,
}> = {
    'start_state': {
        replaceWith: 'start_block',
        recursive: false,
    },
    'sdfg_list_id': {
        replaceWith: 'cfg_list_id',
        recursive: true,
    },
};

const AUTOCOLLAPSE_BYTES_CUTOFF = 1000;

/**
 * Replace the name of a property in a given object.
 * This operates in-place.
 * @param obj      Object in which to replace properties.
 * @param fromName Original property name.
 * @param toName   New name of the property.
 */
function propertyReplace(obj: object, fromName: string, toName: string): void {
    if (Object.hasOwn(obj, fromName)) {
        const prop = Object.getOwnPropertyDescriptor(obj, fromName)!;
        Object.defineProperty(obj, toName, prop);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        delete (obj as any)[fromName];
    }
}

/**
 * Make an SDFG compatible to the current minimum required version for SDFV.
 * This operates in-place.
 * @param sdfg      SDFG to convert.
 * @param direction Whether the SDFG is converted to or from the compatible
 *                  mode, i.e., used for reading or writing. Can be 'in' or
 *                  'out'.
 */
function makeCompat(sdfg: JsonSDFG, direction: 'in' | 'out'): void {
    if (sdfg.dace_version && sdfg.dace_version < '0.16.0') {
        for (const k in propertyReplacements_0_16_0) {
            const v = propertyReplacements_0_16_0[k];
            if (v.recursive) {
                const recurse = (el: {
                    nodes?: any[],
                    edges?: any[],
                    attributes?: object,
                }) => {
                    if (direction === 'in')
                        propertyReplace(el, k, v.replaceWith);
                    else
                        propertyReplace(el, v.replaceWith, k);
                    el.nodes?.forEach(recurse);
                    el.edges?.forEach(recurse);
                    if (el.attributes && Object.hasOwn(el.attributes, 'sdfg'))
                        recurse((el.attributes as { sdfg: JsonSDFG }).sdfg);
                };
                recurse(sdfg);
            } else {
                if (direction === 'in')
                    propertyReplace(sdfg, k, v.replaceWith);
                else
                    propertyReplace(sdfg, v.replaceWith, k);
            }
        }
    }
}

/**
 * Make an SDFG compatible for the current minimum version supported, used when
 * loading an SDFG.
 * Operates in-place.
 * @param sdfg SDFG to make compatible.
 * @returns    The SDFG, now made compatible.
 */
export function checkCompatLoad(sdfg: JsonSDFG): JsonSDFG {
    makeCompat(sdfg, 'in');
    return sdfg;
}

/**
 * Make an SDFG compatible for the current minimum version supported, used when
 * saving an SDFG.
 * Operates in-place.
 * @param sdfg SDFG to make compatible.
 * @returns    The SDFG, now made compatible.
 */
export function checkCompatSave(sdfg: JsonSDFG): JsonSDFG {
    makeCompat(sdfg, 'out');
    return sdfg;
}

/**
 * Read or decompress a JSON string, or a compressed JSON string.
 * @param json JSON string, as a string or compressed in an ArrayBuffer.
 * @returns    Tuple containing the parsed JSON, and a boolean indicating
 *             whether the original string was compressed or not.
 */
export function readOrDecompress(
    json: string | ArrayBuffer
): [string, boolean] {
    try {
        return [
            new TextDecoder().decode(gunzipSync(json)),
            true,
        ];
    } catch {
        if (typeof json !== 'string') {
            const enc = new TextDecoder('utf-8');
            return [enc.decode(json), false];
        }
        return [json, false];
    }
}

/**
 * Recursively parse an SDFG from its string representation.
 * @param sdfgJson          SDFG string.
 * @param skipAutocollapse  Avoid automatically collapsing nested regions.
 * @returns                 Parsed SDFG.
 */
export function parseSDFG(
    sdfgJson: string | ArrayBuffer, skipAutocollapse: boolean = false
): JsonSDFG {
    const sdfgString = readOrDecompress(sdfgJson)[0];
    if (sdfgString.length > AUTOCOLLAPSE_BYTES_CUTOFF && !skipAutocollapse) {
        const sdfgObj = JSON.parse(sdfgString, reviver) as JsonSDFG;
        setCollapseStateRecursive(sdfgObj, true);
        return sdfgObj;
    } else {
        return JSON.parse(sdfgString, reviver) as JsonSDFG;
    }
}

/**
 * Convert an SDFG to its JSON string representation.
 * @param sdfg SDFG to stringify.
 * @returns    JSON string representation of `sdfg`.
 */
export function stringifySDFG(sdfg: JsonSDFG): string {
    return JSON.stringify(sdfg, (name, val) => replacer(name, val));
}

function reviver(name: string, val: unknown): unknown {
    if (name === 'sdfg' && val && typeof val === 'string' &&
        val.startsWith('{'))
        return JSON.parse(val, reviver) as unknown;
    return val;
}

function replacer(name: string, val: unknown): unknown {
    if (name === 'edge' && val instanceof Edge) {  // Skip circular dependencies
        return undefined;
    }
    return val;
}
