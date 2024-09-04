import path from 'path';
import fs from 'fs';
import { checkCompatLoad, parse_sdfg } from '../../../../src';

function testReadSDFG(): void {
    const file = path.join(
        __dirname, '..', '..', '..', 'test_graphs', 'gemm_expanded_pure.sdfg'
    );
    const contents = fs.readFileSync(file, {
        encoding: 'utf-8',
    });
    const sdfg = checkCompatLoad(parse_sdfg(contents));

    expect(sdfg.label).toBe('');
    expect(sdfg.attributes.name).toBe('gemm');
    expect(sdfg.attributes.arg_names).toContain('A');
    expect(sdfg.attributes.arg_names).toContain('B');
    expect(sdfg.attributes.arg_names).toContain('C');
    expect(sdfg.attributes.symbols).toHaveProperty('K');
    expect(sdfg.attributes.symbols).toHaveProperty('M');
    expect(sdfg.attributes.symbols).toHaveProperty('N');
}

describe('Test SDFG serialization and deserialization', () => {
    test('Test reading a regular SDFG file from DaCe 0.16.0', testReadSDFG);
});
