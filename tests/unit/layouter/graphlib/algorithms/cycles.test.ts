import {
    allBackedges,
    simpleCycles,
} from '../../../../../src/layouter/graphlib/algorithms/cycles';
import { DiGraph } from '../../../../../src/layouter/graphlib/di_graph';

function testFindSimpleCycle(): void {
    const g = new DiGraph();

    // Construct graph.
    // 0    1
    //      ↓
    //    ┌→2
    //    | ↓
    //    6 3
    //    ↑ ↓
    //    └-4
    //      ↓
    //      5

    g.addNode('0');
    g.addEdges([
        ['1', '2'],
        ['2', '3'],
        ['3', '4'],
        ['4', '5'],
        ['4', '6'],
        ['6', '2'],
    ]);

    const cycles = Array.from(simpleCycles(g));

    expect(cycles.length).toBe(1);
    const cycle = cycles[0];
    const nodeCycle = cycle[0];
    expect(nodeCycle.length).toBe(4);
    expect(nodeCycle).toContain('2');
    expect(nodeCycle).toContain('3');
    expect(nodeCycle).toContain('4');
    expect(nodeCycle).toContain('6');

    const edgeCycle = cycle[1];
    expect(edgeCycle.length).toBe(4);
    expect(edgeCycle).toContainEqual(['2', '3']);
    expect(edgeCycle).toContainEqual(['3', '4']);
    expect(edgeCycle).toContainEqual(['4', '6']);
    expect(edgeCycle).toContainEqual(['6', '2']);

    // If no start node is provided, this should throw an error since the start
    // is ambiguous.
    expect(() => allBackedges(g)).toThrow(Error);
    const [backedges, eclipsedBackedges] = allBackedges(g, '1', true);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(1);
    expect(backedges).toContainEqual(['6', '2']);
}

function testFindSelfCycle(): void {
    const g = new DiGraph();

    // Construct graph.
    // 0    1
    //      ↓
    //     =2
    //      ↓
    //      3

    g.addNode('0');
    g.addEdges([
        ['1', '2'],
        ['2', '3'],
        ['2', '2'],
    ]);

    const cycles = Array.from(simpleCycles(g));

    expect(cycles.length).toBe(1);
    const cycle = cycles[0];
    expect(cycle[0].length).toBe(1);
    expect(cycle[0]).toContain('2');
    expect(cycle[1].length).toBe(1);
    expect(cycle[1]).toContainEqual(['2', '2']);

    const [backedges, eclipsedBackedges] = allBackedges(g, '1', true);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(1);
    expect(backedges).toContainEqual(['2', '2']);
}

function testSelfLoopsTightNestedLoop(): void {
    const g = new DiGraph();

    // Construct graph.
    //   0   
    //   ↓   
    // ┌→1=-┐
    // | ↓  |
    // └-2= |
    // ┌→|  |
    // | ↓  |
    // └-3= |
    //      |
    //   4←-┘

    g.addEdges([
        ['0', '1'],
        ['1', '1'],
        ['1', '2'],
        ['1', '4'],
        ['2', '1'],
        ['2', '2'],
        ['2', '3'],
        ['3', '2'],
        ['3', '3'],
    ]);

    const cycles = Array.from(simpleCycles(g));

    expect(cycles.length).toBe(5);
    const setifiedCycles = new Set();
    for (const cycle of cycles)
        setifiedCycles.add([new Set(cycle[0]), new Set(cycle[1])]);
    expect(setifiedCycles).toContainEqual([
        new Set(['1']),
        new Set([['1', '1']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['2']),
        new Set([['2', '2']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['3']),
        new Set([['3', '3']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['1', '2']),
        new Set([['1', '2'], ['2', '1']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['3', '2']),
        new Set([['3', '2'], ['2', '3']])
    ]);

    const [backedges, eclipsedBackedges] = allBackedges(g, '1', false);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(5);
    expect(backedges).toContainEqual(['1', '1']);
    expect(backedges).toContainEqual(['2', '2']);
    expect(backedges).toContainEqual(['3', '3']);
    expect(backedges).toContainEqual(['2', '1']);
    expect(backedges).toContainEqual(['3', '2']);
}

function testFindNestedCycles(): void {
    const g = new DiGraph();

    // Construct graph.
    //      1
    //      ↓
    //  ┌--→2
    //  |   ↓
    //  | ┌→3
    //  | ↑ ↓
    //  | 8 4=
    //  | ↑ ↓
    //  | └-5
    //  |   ↓
    //  └---6
    //      ↓
    //      7

    g.addEdges([
        ['1', '2'],
        ['2', '3'],
        ['3', '4'],
        ['4', '5'],
        ['5', '6'],
        ['6', '7'],
        ['5', '8'],
        ['8', '3'],
        ['6', '2'],
        ['4', '4'],
    ]);

    const cycles = Array.from(simpleCycles(g));

    expect(cycles.length).toBe(3);
    const setifiedCycles = new Set();
    for (const cycle of cycles)
        setifiedCycles.add([new Set(cycle[0]), new Set(cycle[1])]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4']),
        new Set([['4', '4']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4', '3', '5', '8']),
        new Set([['3', '4'], ['4', '5'], ['5', '8'], ['8', '3']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4', '3', '5', '6', '2']),
        new Set([['2', '3'], ['3', '4'], ['4', '5'], ['5', '6'], ['6', '2']])
    ]);

    const [backedges, eclipsedBackedges] = allBackedges(g, undefined, true);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(3);
    expect(backedges).toContainEqual(['6', '2']);
    expect(backedges).toContainEqual(['8', '3']);
    expect(backedges).toContainEqual(['4', '4']);
}

function testFindBackedgesWithMultipleCrossEdges(): void {
    const g = new DiGraph();

    // Construct graph.

    g.addEdges([
        ['0', '1'],
        ['0', '15'],
        ['1', '2'],
        ['1', '7'],
        ['2', '3'],
        ['2', '6'],
        ['3', '4'],
        ['4', '3'],
        ['4', '5'],
        ['5', '6'],
        ['6', '2'],
        ['6', '7'],
        ['7', '8'],
        ['7', '16'],
        ['8', '9'],
        ['8', '17'],
        ['9', '10'],
        ['10', '9'],
        ['10', '11'],
        ['11', '12'],
        ['12', '8'],
        ['12', '13'],
        ['13', '14'],
        ['14', '1'],
        ['14', '15'],
        ['16', '14'],
        ['17', '12'],
    ]);

    const [backedgesSt, eclipsedBackedgesSt] = allBackedges(g, undefined, true);

    expect(eclipsedBackedgesSt.size).toBe(0);
    expect(backedgesSt.size).toBe(5);
    expect(backedgesSt).toContainEqual(['14', '1']);
    expect(backedgesSt).toContainEqual(['6', '2']);
    expect(backedgesSt).toContainEqual(['4', '3']);
    expect(backedgesSt).toContainEqual(['10', '9']);
    expect(backedgesSt).toContainEqual(['12', '8']);
}

function testFindEclipsedBackedgesDistinctLengths(): void {
    const g = new DiGraph();

    // Construct graph.
    //      1
    //      ↓
    //  ┌--→2
    //  | | ↓
    //  | | 3
    //  | | ↓
    //  | | 4=
    //  | | ↓
    //  | └-5
    //  |   ↓
    //  |   6
    //  |   ↓
    //  └---7
    //      ↓
    //      8

    g.addEdges([
        ['1', '2'],
        ['2', '3'],
        ['3', '4'],
        ['4', '5'],
        ['5', '6'],
        ['6', '7'],
        ['7', '8'],
        ['5', '2'],
        ['7', '2'],
        ['4', '4'],
    ]);

    const cycles = Array.from(simpleCycles(g));

    expect(cycles.length).toBe(3);
    const setifiedCycles = new Set();
    for (const cycle of cycles)
        setifiedCycles.add([new Set(cycle[0]), new Set(cycle[1])]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4']),
        new Set([['4', '4']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4', '3', '5', '2']),
        new Set([['2', '3'], ['3', '4'], ['4', '5'], ['5', '2']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4', '3', '5', '6', '2', '7']),
        new Set([
            ['2', '3'], ['3', '4'], ['4', '5'], ['5', '6'], ['6', '7'],
            ['7', '2']
        ])
    ]);

    const [backedgesSt, eclipsedBackedgesSt] = allBackedges(g, undefined, true);
    expect(eclipsedBackedgesSt.size).toBe(1);
    expect(backedgesSt.size).toBe(2);
    expect(backedgesSt).toContainEqual(['7', '2']);
    expect(backedgesSt).toContainEqual(['4', '4']);
    expect(eclipsedBackedgesSt).toContainEqual(['5', '2']);

    const [backedges, eclipsedBackedges] = allBackedges(g, undefined, false);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(3);
    expect(backedges).toContainEqual(['7', '2']);
    expect(backedges).toContainEqual(['4', '4']);
    expect(backedges).toContainEqual(['5', '2']);
}

function testFindEclipsedBackedgesSimilarLengths(): void {
    const g = new DiGraph();

    // Construct graph.
    //      1
    //      ↓
    //  ┌--→2
    //  | | ↓
    //  | | 3
    //  | | ↓
    //  | | 4=
    //  | | ↓
    //  | └-5
    //  |   ↓
    //  └---6
    //      ↓
    //      7

    g.addEdges([
        ['1', '2'],
        ['2', '3'],
        ['3', '4'],
        ['4', '5'],
        ['5', '6'],
        ['6', '7'],
        ['5', '2'],
        ['6', '2'],
        ['4', '4'],
    ]);

    const cycles = Array.from(simpleCycles(g));

    expect(cycles.length).toBe(3);
    const setifiedCycles = new Set();
    for (const cycle of cycles)
        setifiedCycles.add([new Set(cycle[0]), new Set(cycle[1])]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4']),
        new Set([['4', '4']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4', '3', '5', '2']),
        new Set([['2', '3'], ['3', '4'], ['4', '5'], ['5', '2']])
    ]);
    expect(setifiedCycles).toContainEqual([
        new Set(['4', '3', '5', '6', '2']),
        new Set([
            ['2', '3'], ['3', '4'], ['4', '5'], ['5', '6'], ['6', '2']
        ])
    ]);

    const [backedgesSt, eclipsedBackedgesSt] = allBackedges(g, undefined, true);
    expect(eclipsedBackedgesSt.size).toBe(1);
    expect(backedgesSt.size).toBe(2);
    expect(backedgesSt).toContainEqual(['6', '2']);
    expect(backedgesSt).toContainEqual(['4', '4']);
    expect(eclipsedBackedgesSt).toContainEqual(['5', '2']);

    const [backedges, eclipsedBackedges] = allBackedges(g, undefined, false);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(3);
    expect(backedges).toContainEqual(['6', '2']);
    expect(backedges).toContainEqual(['4', '4']);
    expect(backedges).toContainEqual(['5', '2']);
}

describe('Test cycle-related graph algorithms', () => {
    test('Test finding a single simple cycles', testFindSimpleCycle);
    test('Test finding a self cycles', testFindSelfCycle);
    test(
        'Test finding self cycles in tightly nested loops',
        testSelfLoopsTightNestedLoop
    );
    test(
        'Test finding nested cycles, including self cycles',
        testFindNestedCycles
    );
    test(
        'Test finding backedges in a situation with many cross edges and skip' +
        ' edges.',
        testFindBackedgesWithMultipleCrossEdges
    );
    test(
        'Test finding eclipsed backedges',
        testFindEclipsedBackedgesDistinctLengths
    );
    test(
        'Test finding eclipsed backedges with similar lengths',
        testFindEclipsedBackedgesSimilarLengths
    );
});
