// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import path from 'path';
import fs from 'fs';
import { JsonSDFG } from '../../../../src/types';
import {
    parseSDFG,
    checkCompatLoad,
} from '../../../../src/utils/sdfg/json_serializer';
import {
    setCollapseStateRecursive,
} from '../../../../src/utils/sdfg/sdfg_utils';
import { memletTreeComplete } from '../../../../src/utils/sdfg/memlet_trees';


function _loadSDFG(name: string): JsonSDFG {
    const file = path.join(
        __dirname, '..', '..', '..', 'test_graphs', name + '.sdfg'
    );
    const contents = fs.readFileSync(file, {
        encoding: 'utf-8',
    });
    return checkCompatLoad(parseSDFG(contents, true));
}

function testMemletTreeNestedSDFGMultiMap(): void {
    const sdfg = _loadSDFG('gemm_expanded_pure_tiled');

    // Test fully expanded first.
    setCollapseStateRecursive(sdfg, false);
    const mtree = memletTreeComplete(sdfg);

    expect(mtree.length).toBe(3);
    expect(mtree[0].size).toBe(6);
    expect(mtree[1].size).toBe(6);
    expect(mtree[2].size).toBe(6);

    // Test fully collapsed next. There should be no trees computed.
    setCollapseStateRecursive(sdfg, true);
    const mtreeCollapsed = memletTreeComplete(sdfg);

    expect(mtreeCollapsed.length).toBe(0);
}

describe('Test memlet tree construction', () => {
    test('Nested SDFG with nested maps', testMemletTreeNestedSDFGMultiMap);
});
