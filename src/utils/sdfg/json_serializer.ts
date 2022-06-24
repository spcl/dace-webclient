// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { Edge, JsonSDFG } from '../../index';
import zlib = require('zlib');
import { Buffer } from 'buffer';

export function read_or_decompress(json: string | ArrayBuffer): string {
    try {
        return zlib.gunzipSync(Buffer.from(json as Uint8Array)).toString();
    } catch {
        if (typeof json !== 'string') {
            const enc = new TextDecoder("utf-8");
            return enc.decode(json);
        }
        return json;
    }
}

// Recursively parse SDFG, including nested SDFG nodes
export function parse_sdfg(sdfg_json: string | ArrayBuffer): JsonSDFG {
    return JSON.parse(read_or_decompress(sdfg_json), reviver);
}

export function stringify_sdfg(sdfg: JsonSDFG): string {
    return JSON.stringify(sdfg, (name, val) => replacer(name, val));
}

function reviver(name: string, val: unknown) {
    if (name == 'sdfg' && val && typeof val === 'string' && val[0] === '{') {
        return JSON.parse(val, reviver);
    }
    return val;
}

function replacer(name: string, val: unknown): unknown {
    if (name === 'edge' && val instanceof Edge) {  // Skip circular dependencies
        return undefined;
    }
    return val;
}
