import {
    SMLayouter,
    SMLayouterEdge,
    SMLayouterNode,
} from '../../../../src/layouter/state_machine/sm_layouter';
import { DiGraph } from '../../../../src/layouter/graphlib/di_graph';

function constructNode(
    graph: DiGraph<SMLayouterNode, SMLayouterEdge>, id: string, height?: number,
    width?: number
): SMLayouterNode {
    const node = { x: 0, y: 0, height: height ?? 1, width: width ?? 1 };
    graph.addNode(id, node);
    return node;
}

function constructEdge(
    graph: DiGraph<SMLayouterNode, SMLayouterEdge>, src: string, dst: string
): SMLayouterEdge {
    const edge = { points: [], weight: 2 };
    graph.addEdge(src, dst, edge);
    return edge;
}

function testBasicBranching(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.
    //   0
    //   |
    // --1--
    // | | |
    // 2 3 4
    // | | |
    // 5 6 |
    // | | |
    // 7 | |
    // | | |
    // 8----
    // |
    // 9

    const n0 = constructNode(graph, '0');
    const n1 = constructNode(graph, '1');
    const n2 = constructNode(graph, '2');
    const n3 = constructNode(graph, '3');
    const n4 = constructNode(graph, '4');
    const n5 = constructNode(graph, '5');
    const n6 = constructNode(graph, '6');
    const n7 = constructNode(graph, '7');
    const n8 = constructNode(graph, '8');
    const n9 = constructNode(graph, '9');
    constructEdge(graph, '0', '1');
    constructEdge(graph, '1', '2');
    constructEdge(graph, '1', '3');
    constructEdge(graph, '1', '4');
    constructEdge(graph, '2', '5');
    constructEdge(graph, '3', '6');
    constructEdge(graph, '5', '7');
    constructEdge(graph, '7', '8');
    constructEdge(graph, '6', '8');
    constructEdge(graph, '4', '8');
    constructEdge(graph, '8', '9');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    expect(n0.rank).toBe(0);
    expect(n1.rank).toBe(1);
    expect(n2.rank).toBe(2);
    expect(n3.rank).toBe(2);
    expect(n4.rank).toBe(2);
    expect(n5.rank).toBe(3);
    expect(n6.rank).toBe(3);
    expect(n7.rank).toBe(4);
    expect(n8.rank).toBe(5);
    expect(n9.rank).toBe(6);
}

function testNestedBranching(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.
    //   0
    //   |
    // --1--
    // |   |
    // 2-- 3
    // | | |
    // 4 | |
    // | | |
    // 5-- |
    // |   |
    // 6----
    // |
    // 7

    const n0 = constructNode(graph, '0');
    const n1 = constructNode(graph, '1');
    const n2 = constructNode(graph, '2');
    const n3 = constructNode(graph, '3');
    const n4 = constructNode(graph, '4');
    const n5 = constructNode(graph, '5');
    const n6 = constructNode(graph, '6');
    const n7 = constructNode(graph, '7');
    constructEdge(graph, '0', '1');
    constructEdge(graph, '1', '2');
    constructEdge(graph, '1', '3');
    constructEdge(graph, '2', '4');
    constructEdge(graph, '4', '5');
    constructEdge(graph, '5', '6');
    constructEdge(graph, '2', '5');
    constructEdge(graph, '3', '6');
    constructEdge(graph, '6', '7');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    expect(n0.rank).toBe(0);
    expect(n1.rank).toBe(1);
    expect(n2.rank).toBe(2);
    expect(n3.rank).toBe(2);
    expect(n4.rank).toBe(3);
    expect(n5.rank).toBe(4);
    expect(n6.rank).toBe(5);
    expect(n7.rank).toBe(6);
}

function testNestedLoopsFusedEdes(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.
    //   0
    //   |
    // --1 --
    // | |  |
    // ==2  5
    // | |
    // ==3
    // | |
    // --4

    const n0 = constructNode(graph, '0');
    const n1 = constructNode(graph, '1');
    const n2 = constructNode(graph, '2');
    const n3 = constructNode(graph, '3');
    const n4 = constructNode(graph, '4');
    const n5 = constructNode(graph, '5');
    constructEdge(graph, '0', '1');
    constructEdge(graph, '1', '2');
    constructEdge(graph, '1', '5');
    constructEdge(graph, '2', '1');
    constructEdge(graph, '2', '3');
    constructEdge(graph, '3', '2');
    constructEdge(graph, '3', '4');
    constructEdge(graph, '4', '3');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    expect(n0.rank).toBe(0);
    expect(n1.rank).toBe(1);
    expect(n2.rank).toBe(2);
    expect(n3.rank).toBe(3);
    expect(n4.rank).toBe(4);
    expect(n5.rank).toBe(5);
}

describe('Test vertical state machine layout ranking', () => {
    test('Basic branching', testBasicBranching);
    test('Nested branching', testNestedBranching);
    test(
        'Nested loops with fused assignment and condition edges',
        testNestedLoopsFusedEdes
    );
});
