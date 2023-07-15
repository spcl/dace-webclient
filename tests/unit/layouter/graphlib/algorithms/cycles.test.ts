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
    expect(cycle.length).toBe(4);
    expect(cycle).toContain('2');
    expect(cycle).toContain('3');
    expect(cycle).toContain('4');
    expect(cycle).toContain('6');

    // If no start node is provided, this should toss an error since the start
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
    expect(cycle.length).toBe(1);
    expect(cycle).toContain('2');

    const [backedges, eclipsedBackedges] = allBackedges(g, '1', true);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(1);
    expect(backedges).toContainEqual(['2', '2']);
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
        setifiedCycles.add(new Set(cycle));
    expect(setifiedCycles).toContainEqual(new Set(['4']));
    expect(setifiedCycles).toContainEqual(new Set(['4', '3', '5', '8']));
    expect(setifiedCycles).toContainEqual(new Set(['4', '3', '5', '6', '2']));

    const [backedges, eclipsedBackedges] = allBackedges(g, undefined, true);
    expect(eclipsedBackedges.size).toBe(0);
    expect(backedges.size).toBe(3);
    expect(backedges).toContainEqual(['6', '2']);
    expect(backedges).toContainEqual(['8', '3']);
    expect(backedges).toContainEqual(['4', '4']);
}

function testFindEclipsedBackedges(): void {
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
        setifiedCycles.add(new Set(cycle));
    expect(setifiedCycles).toContainEqual(new Set(['4']));
    expect(setifiedCycles).toContainEqual(new Set(['4', '2', '3', '5']));
    expect(setifiedCycles).toContainEqual(new Set(['4', '3', '5', '6', '2']));

    const [backedges, eclipsedBackedges] = allBackedges(g, undefined, true);
    expect(eclipsedBackedges.size).toBe(1);
    expect(backedges.size).toBe(2);
    expect(backedges).toContainEqual(['6', '2']);
    expect(backedges).toContainEqual(['4', '4']);
    expect(eclipsedBackedges).toContainEqual(['5', '2']);
}

describe('Test cycle-related graph algorithms', () => {
    test('Test finding a single simple cycles', testFindSimpleCycle);
    test('Test finding a self cycles', testFindSelfCycle);
    test(
        'Test finding nested cycles, including self cycles',
        testFindNestedCycles
    );
    test('Test finding eclipsed backedges', testFindEclipsedBackedges);
});
