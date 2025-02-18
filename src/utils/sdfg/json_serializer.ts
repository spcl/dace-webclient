// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { gunzipSync } from 'zlib';
import { Buffer } from 'buffer';
import { JsonSDFG, JsonSDFGControlFlowRegion } from '../../types';
import { Edge } from '../../renderer/renderer_elements';

const propertyReplacements_0_16_0: { [key: string]: {
    replaceWith: string,
    recursive: boolean,
}} = {
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

function propertyReplace(obj: any, fromName: string, toName: string): void {
    if (Object.hasOwn(obj, fromName)) {
        const prop = Object.getOwnPropertyDescriptor(obj, fromName)!;
        Object.defineProperty(obj, toName, prop);
        delete obj[fromName];
    }
}

function makeCompat(sdfg: any, direction: 'in' | 'out'): void {
    if (sdfg.dace_version && sdfg.dace_version < '0.16.0') {
        for (const k in propertyReplacements_0_16_0) {
            const v = propertyReplacements_0_16_0[k];
            if (v.recursive) {
                const recurse = (el: {
                    nodes?: any[],
                    edges?: any[],
                    attributes?: { sdfg?: any },
                }) => {
                    if (direction === 'in')
                        propertyReplace(el, k, v.replaceWith);
                    else
                        propertyReplace(el, v.replaceWith, k);
                    el.nodes?.forEach(recurse);
                    el.edges?.forEach(recurse);
                    if (el.attributes?.sdfg)
                        recurse(el.attributes.sdfg);
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

export function checkCompatLoad(sdfg: JsonSDFG): JsonSDFG {
    makeCompat(sdfg, 'in');
    return sdfg;
}

export function checkCompatSave(sdfg: JsonSDFG): JsonSDFG {
    makeCompat(sdfg, 'out');
    return sdfg;
}

export function read_or_decompress(
    json: string | ArrayBuffer
): [string, boolean] {
    try {
        return [
            new TextDecoder().decode(
                gunzipSync(Buffer.from(json as Uint8Array))
            ),
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

function recursivelyCollapse(cfg: JsonSDFGControlFlowRegion): void {
    for (const node of cfg.nodes) {
        node.attributes.is_collapsed = true;
        if (Object.hasOwn(node, 'cfg_list_id'))
            recursivelyCollapse(node as JsonSDFGControlFlowRegion);
    }
}

// Recursively parse SDFG, including nested SDFG nodes
export function parse_sdfg(
    sdfg_json: string | ArrayBuffer, skipAutocollapse: boolean = false
): JsonSDFG {
    const sdfg_string = read_or_decompress(sdfg_json)[0];
    if (sdfg_string.length > AUTOCOLLAPSE_BYTES_CUTOFF && !skipAutocollapse) {
        const sdfgObj: JsonSDFG = JSON.parse(sdfg_string, reviver);
        recursivelyCollapse(sdfgObj);
        return sdfgObj
    } else {
        return JSON.parse(sdfg_string, reviver);
    }
}

export function stringify_sdfg(sdfg: JsonSDFG): string {
    return JSON.stringify(sdfg, (name, val) => replacer(name, val));
}

function reviver(name: string, val: unknown) {
    if (name === 'sdfg' && val && typeof val === 'string' && val[0] === '{')
        return JSON.parse(val, reviver);
    return val;
}

function replacer(name: string, val: unknown): unknown {
    if (name === 'edge' && val instanceof Edge) {  // Skip circular dependencies
        return undefined;
    }
    return val;
}
