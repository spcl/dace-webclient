// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import path from 'path';
import fs from 'fs';
import {
    checkCompatLoad,
    parse_sdfg,
} from '../../../../src/utils/sdfg/json_serializer';
import { checkCompatSave, JsonSDFG, stringify_sdfg } from '../../../../src';

function _checkDidLoadGemmExpandedPureCorrectly(sdfg: JsonSDFG): void {
    expect(sdfg.label).toBe('');
    expect(sdfg.attributes.name).toBe('gemm');
    expect(sdfg.attributes.arg_names).toContain('A');
    expect(sdfg.attributes.arg_names).toContain('B');
    expect(sdfg.attributes.arg_names).toContain('C');
    expect(sdfg.attributes.symbols).toHaveProperty('K');
    expect(sdfg.attributes.symbols).toHaveProperty('M');
    expect(sdfg.attributes.symbols).toHaveProperty('N');
}

function testReadSDFG(): void {
    const file = path.join(
        __dirname, '..', '..', '..', 'test_graphs', 'gemm_expanded_pure.sdfg'
    );
    const contents = fs.readFileSync(file, {
        encoding: 'utf-8',
    });
    const sdfg = checkCompatLoad(parse_sdfg(contents));

    _checkDidLoadGemmExpandedPureCorrectly(sdfg);
}

function _loadPreDaCe_0_16_Gemm(): JsonSDFG {
    const file = path.join(
        __dirname, '..', '..', '..', 'test_graphs',
        'gemm_expanded_pure_pre_0_16.sdfg'
    );
    const contents = fs.readFileSync(file, {
        encoding: 'utf-8',
    });
    return checkCompatLoad(parse_sdfg(contents));
}

function testReadSDFGPreDaCe_0_16(): void {
    const sdfg = _loadPreDaCe_0_16_Gemm();

    expect((<any>sdfg).dace_version).toBe('0.15.0');
    expect(sdfg).toHaveProperty('start_block');
    expect(sdfg.start_block).toBe(0);

    _checkDidLoadGemmExpandedPureCorrectly(sdfg);
}

function testSaveSDFGPreDaCe_0_16(): void {
    const sdfg = checkCompatSave(_loadPreDaCe_0_16_Gemm());

    expect((<any>sdfg).dace_version).toBe('0.15.0');
    expect(sdfg).toHaveProperty('start_state');
    expect(sdfg).not.toHaveProperty('start_block');
    expect((<any>sdfg).start_state).toBe(0);

    const stringified = stringify_sdfg(sdfg);

    expect(stringified).toContain('start_state');
    expect(stringified).not.toContain('start_block');
    expect(stringified).toContain('sdfg_list_id');
    expect(stringified).not.toContain('cfg_list_id');
}

describe('Test SDFG serialization and deserialization', () => {
    test('Test reading a regular SDFG file from DaCe 0.16.1', testReadSDFG);
    test(
        'Test reading a regular SDFG file from DaCe 0.15.0',
        testReadSDFGPreDaCe_0_16
    );
    test(
        'Test saving an SDFG file from DaCe 0.15.0, after being made 0.16+ ' +
        'compatible',
        testSaveSDFGPreDaCe_0_16
    );
});
