// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import path from 'path';
import fs from 'fs';
import { JsonSDFG } from '../../../../src/types';
import {
    checkCompatLoad,
    parseSDFG,
} from '../../../../src/utils/sdfg/json_serializer';
import { cfgToDotGraph } from '../../../../src/utils/sdfg/dotgraph';


function _loadSDFG(name: string): JsonSDFG {
    const file = path.join(
        __dirname, '..', '..', '..', 'test_graphs', name + '.sdfg'
    );
    const contents = fs.readFileSync(file, {
        encoding: 'utf-8',
    });
    return checkCompatLoad(parseSDFG(contents));
}

function testWhileDoToDot(): void {
    const sdfg = _loadSDFG('while_do');
    const dotString = cfgToDotGraph(sdfg);

    expect(dotString).toContain('state -> while_guard');
    expect(dotString).toContain('while_guard -> assign_7_8');
    expect(dotString).toContain('while_guard -> assign_9_4');
    expect(dotString).toContain('assign_7_8 -> while_guard');
    expect(dotString).not.toContain('state -> state');
    expect(dotString).not.toContain('state -> assign_7_8');
    expect(dotString).not.toContain('state -> assign_9_4');
    expect(dotString).not.toContain('while_guard -> state');
    expect(dotString).not.toContain('while_guard -> while_guard');
    expect(dotString).not.toContain('assign_7_8 -> assign_7_8');
    expect(dotString).not.toContain('assign_7_8 -> assign_9_4');
    expect(dotString).not.toContain('assign_7_8 -> state');
    expect(dotString).not.toContain('assign_9_4 -> assign_7_8');
    expect(dotString).not.toContain('assign_9_4 -> state');
    expect(dotString).not.toContain('assign_9_4 -> while_guard');
    expect(dotString).not.toContain('assign_9_4 -> assign_9_4');
}

describe('Test SDFG to DOT graph conversion', () => {
    test('While-Do loop', testWhileDoToDot);
});
