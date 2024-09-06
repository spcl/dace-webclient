// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import path from 'path';
import fs from 'fs';
import { checkCompatLoad, JsonSDFG, parse_sdfg } from '../../../../src';
import { memletTreeComplete } from '../../../../src/utils/sdfg/memlet_trees';

function _loadSDFG(name: string): JsonSDFG {
    const file = path.join(
        __dirname, '..', '..', '..', 'test_graphs', name + '.sdfg'
    );
    const contents = fs.readFileSync(file, {
        encoding: 'utf-8',
    });
    return checkCompatLoad(parse_sdfg(contents));
}

function testMemletTreeNestedSDFGMultiMap(): void {
    const sdfg = _loadSDFG('gemm_expanded_pure_tiled');
    const mtree = memletTreeComplete(sdfg);

    expect(mtree.length).toBe(3);
    expect(mtree[0].size).toBe(6);
    expect(mtree[1].size).toBe(6);
    expect(mtree[2].size).toBe(6);
}

describe('Test memlet tree construction', () => {
    test('Nested SDFG with nested maps', testMemletTreeNestedSDFGMultiMap);
});
