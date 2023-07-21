import {
    allReachable,
} from '../../../../../src/layouter/graphlib/algorithms/traversal';
import { DiGraph } from '../../../../../src/layouter/graphlib/di_graph';

function testAllReachableBasic(): void {
    let g: DiGraph<unknown, unknown>;
    let reachable: Set<string>;

    g = new DiGraph();

    // Construct graph.
    // 0  1
    //    ↓
    //   =2
    //    ↓
    //    3

    g.addNode('0');
    g.addEdges([
        ['1', '2'],
        ['2', '3'],
        ['2', '2'],
    ]);

    reachable = new Set(allReachable(g, '0'));
    expect(reachable.size).toBe(0);
    reachable = new Set(allReachable(g, '1'));
    expect(reachable.size).toBe(2);
    expect(reachable).toContain('2');
    expect(reachable).toContain('3');
    reachable = new Set(allReachable(g, '2'));
    expect(reachable.size).toBe(2);
    expect(reachable).toContain('2');
    expect(reachable).toContain('3');
    reachable = new Set(allReachable(g, '3'));
    expect(reachable.size).toBe(0);

    g = new DiGraph();

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

    reachable = new Set(allReachable(g, '0'));
    expect(reachable.size).toBe(0);
    reachable = new Set(allReachable(g, '1'));
    expect(reachable.size).toBe(5);
    expect(reachable).toContain('2');
    expect(reachable).toContain('3');
    expect(reachable).toContain('4');
    expect(reachable).toContain('5');
    expect(reachable).toContain('6');
    reachable = new Set(allReachable(g, '2'));
    expect(reachable.size).toBe(5);
    expect(reachable).toContain('2');
    expect(reachable).toContain('3');
    expect(reachable).toContain('4');
    expect(reachable).toContain('5');
    expect(reachable).toContain('6');
    reachable = new Set(allReachable(g, '3'));
    expect(reachable.size).toBe(5);
    expect(reachable).toContain('2');
    expect(reachable).toContain('3');
    expect(reachable).toContain('4');
    expect(reachable).toContain('5');
    expect(reachable).toContain('6');
    reachable = new Set(allReachable(g, '4'));
    expect(reachable.size).toBe(5);
    expect(reachable).toContain('2');
    expect(reachable).toContain('3');
    expect(reachable).toContain('4');
    expect(reachable).toContain('5');
    expect(reachable).toContain('6');
    reachable = new Set(allReachable(g, '5'));
    expect(reachable.size).toBe(0);
    reachable = new Set(allReachable(g, '6'));
    expect(reachable.size).toBe(5);
    expect(reachable).toContain('2');
    expect(reachable).toContain('3');
    expect(reachable).toContain('4');
    expect(reachable).toContain('5');
    expect(reachable).toContain('6');
}

describe('Test Reachability', () => {
    test(
        'Test basic reachability with loops and disconnected graphs',
        testAllReachableBasic
    );
});
