import path from 'path';
import fs from 'fs';
import {
    checkCompatLoad,
    parse_sdfg,
} from '../../src/utils/sdfg/json_serializer';
import { JsonSDFG, relayoutStateMachine, SDFG } from '../../src';
import { SDFGDiffViewer } from '../../src/sdfg_diff_viewer';

function _loadSDFG(name: string): JsonSDFG {
    const file = path.join(
        __dirname, '..', 'test_graphs', name + '.sdfg'
    );
    const contents = fs.readFileSync(file, {
        encoding: 'utf-8',
    });
    return checkCompatLoad(parse_sdfg(contents));
}

async function testDiffTiledGemm(): Promise<void> {
    const sdfgAjson = _loadSDFG('gemm_expanded_pure');
    const sdfgBjson = _loadSDFG('gemm_expanded_pure_tiled');

    const graphA = relayoutStateMachine(sdfgAjson, sdfgAjson);
    const graphB = relayoutStateMachine(sdfgBjson, sdfgBjson);

    const sdfgA = new SDFG(sdfgAjson);
    sdfgA.sdfgDagreGraph = graphA;
    const sdfgB = new SDFG(sdfgBjson);
    sdfgB.sdfgDagreGraph = graphB;

    const diff = await SDFGDiffViewer.diff(sdfgA, sdfgB);
    const diffInverse = await SDFGDiffViewer.diff(sdfgB, sdfgA);

    const keysAddedToB = [
        'e562bb57-462f-445d-8ed8-bf9969c757fa',
        '70a0d824-b445-47e9-9f63-6cd4824c85c3',
        '8401cf3a-a250-4c50-ad7d-95a1b864487c',
        '8ba64156-455d-48d9-a244-31b5b408fc2e',
        'e49445d9-0bdc-4e64-b6d7-dc1eca194ac1',
        '299e3980-2477-4ea7-ad30-4c8616cf33a6',
        '6371609f-0c7d-4732-b432-2f18d785bc46',
        'df4da5a9-89ed-4d0a-8fe2-53925ec1212d',
        '57d0797b-6f39-44b5-a5a2-df301b280a24',
        'dacd854b-3331-450b-a35e-206a1d129df7',
        '94341c4d-d598-40b4-a96e-9e100b67b72d',
        '6d8bfe3f-f22a-4333-a1a1-f32dea84865d',
        '53c0c330-40c0-4f53-a147-fa24cc10fb4e',
        '762fb2f4-8c7e-4eb3-a9fe-35c0a10a379b',
        '93136e27-88c0-46f6-9f78-a27c39204137',
    ];
    const keysRemovedInB = [
        'df493a73-5bbb-451e-94e6-fc43b4c2f3c6',
        '1a93a12e-eb21-4037-9238-a3317aed8594',
        'f53b1f56-9e4b-46d0-9b66-6bbd6b87012c',
        '5144b1f0-dd46-4756-86a1-8753e4eadc5c',
        '6217fb9b-cf97-4ebc-8cc8-4c4ce8bf3956',
        'b5b0794e-281c-4750-a560-1ecba58a41b8',
        '446e66c4-2285-41ec-95a1-08532e89c3e5',
        '7310d962-192e-42b9-b6ba-b56b877d5236',
    ];
    const keysChanged = ['38ef19e5-7e2b-4611-ab17-22a0345766de'];

    expect(diff.addedKeys.size).toBe(15);
    expect(diff.removedKeys.size).toBe(8);
    expect(diff.changedKeys.size).toBe(1);

    for (const k of keysAddedToB)
        expect(diff.addedKeys).toContain(k);
    for (const k of keysRemovedInB)
        expect(diff.removedKeys).toContain(k);
    for (const k of keysChanged)
        expect(diff.changedKeys).toContain(k);

    expect(diffInverse.removedKeys.size).toBe(15);
    expect(diffInverse.addedKeys.size).toBe(8);
    expect(diffInverse.changedKeys.size).toBe(1);

    for (const k of keysAddedToB)
        expect(diffInverse.removedKeys).toContain(k);
    for (const k of keysRemovedInB)
        expect(diffInverse.addedKeys).toContain(k);
    for (const k of keysChanged)
        expect(diffInverse.changedKeys).toContain(k);
}

describe('Test SDFG diffs', () => {
    test('Test SDFG diff on a tiled GEMM (pure expansion)', testDiffTiledGemm);
});
