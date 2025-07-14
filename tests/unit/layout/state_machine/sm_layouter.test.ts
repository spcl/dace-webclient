// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { DiGraph } from '../../../../src/layout/graphlib/di_graph';
import {
    BACKEDGE_SPACING,
    SMLayouter,
    SMLayouterEdge,
    SMLayouterNode,
} from '../../../../src/layout/state_machine/sm_layouter';


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
    if (!graph.has(src))
        constructNode(graph, src);
    if (!graph.has(dst))
        constructNode(graph, dst);
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

function testSelfLoop(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Test a simple loop with a self edge.
    // Construct graph.
    //   0
    //   |
    //  =1
    //   |
    //   2

    constructEdge(graph, '0', '1');
    constructEdge(graph, '1', '1');
    constructEdge(graph, '1', '2');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    expect(graph.get('0')?.rank).toBe(0);
    expect(graph.get('1')?.rank).toBe(1);
    expect(graph.get('2')?.rank).toBe(2);

    const graph2 = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Test the same scenario with an additional nested loop inside.
    // Construct graph.
    //   0
    //   |
    //  =1==--3
    //   | |
    //   2--

    constructEdge(graph2, '0', '1');
    constructEdge(graph2, '1', '1');
    constructEdge(graph2, '1', '2');
    constructEdge(graph2, '1', '3');
    constructEdge(graph2, '2', '1');

    const layouter2 = new SMLayouter(graph2);
    layouter2.doLayout();

    expect(graph2.get('0')?.rank).toBe(0);
    expect(graph2.get('1')?.rank).toBe(1);
    expect(graph2.get('2')?.rank).toBe(2);
    expect(graph2.get('3')?.rank).toBe(3);
}

function testMultiInvertedSkipLoops(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.

    constructEdge(graph, '0', '1');
    constructEdge(graph, '0', '15');
    constructEdge(graph, '1', '2');
    constructEdge(graph, '1', '7');
    constructEdge(graph, '2', '3');
    constructEdge(graph, '2', '6');
    constructEdge(graph, '3', '4');
    constructEdge(graph, '4', '3');
    constructEdge(graph, '4', '5');
    constructEdge(graph, '5', '6');
    constructEdge(graph, '6', '2');
    constructEdge(graph, '6', '7');
    constructEdge(graph, '7', '8');
    constructEdge(graph, '7', '16');
    constructEdge(graph, '8', '9');
    constructEdge(graph, '8', '17');
    constructEdge(graph, '9', '10');
    constructEdge(graph, '10', '9');
    constructEdge(graph, '10', '11');
    constructEdge(graph, '11', '12');
    constructEdge(graph, '12', '8');
    constructEdge(graph, '12', '13');
    constructEdge(graph, '13', '14');
    constructEdge(graph, '14', '1');
    constructEdge(graph, '14', '15');
    constructEdge(graph, '16', '14');
    constructEdge(graph, '17', '12');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    expect(graph.get('0')?.rank).toBe(0);
    expect(graph.get('1')?.rank).toBe(1);
    expect(graph.get('2')?.rank).toBe(2);
    expect(graph.get('3')?.rank).toBe(3);
    expect(graph.get('4')?.rank).toBe(4);
    expect(graph.get('5')?.rank).toBe(5);
    expect(graph.get('6')?.rank).toBe(6);
    expect(graph.get('7')?.rank).toBe(7);
    expect(graph.get('8')?.rank).toBe(8);
    expect(graph.get('9')?.rank).toBe(9);
    expect(graph.get('10')?.rank).toBe(10);
    expect(graph.get('11')?.rank).toBe(11);
    expect(graph.get('12')?.rank).toBe(12);
    expect(graph.get('13')?.rank).toBe(13);
    expect(graph.get('14')?.rank).toBe(14);
    expect(graph.get('15')?.rank).toBe(15);
    expect(graph.get('16')?.rank).toBe(8);
    expect(graph.get('17')?.rank).toBe(9);
}

function testSkipLoopWithBreakReturn(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.

    constructEdge(graph, '0', '1');
    constructEdge(graph, '1', '2');
    constructEdge(graph, '1', '6');
    constructEdge(graph, '2', '3');
    constructEdge(graph, '2', '6');
    constructEdge(graph, '3', '4');
    constructEdge(graph, '3', '6');
    constructEdge(graph, '4', '5');
    constructEdge(graph, '4', '7');
    constructEdge(graph, '5', '2');
    constructEdge(graph, '6', '7');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    expect(graph.get('0')?.rank).toBe(0);
    expect(graph.get('1')?.rank).toBe(1);
    expect(graph.get('2')?.rank).toBe(2);
    expect(graph.get('3')?.rank).toBe(3);
    expect(graph.get('4')?.rank).toBe(4);
    expect(graph.get('5')?.rank).toBe(5);
    expect(graph.get('6')?.rank).toBe(6);
    expect(graph.get('7')?.rank).toBe(7);
}

function testMultiEntryExit(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.
    //   0  1
    //   |  |
    //   2--|
    //   |
    //   3

    constructEdge(graph, '0', '2');
    constructEdge(graph, '1', '2');
    constructEdge(graph, '2', '3');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    expect(graph.get('0')?.rank).toBe(1);
    expect(graph.get('1')?.rank).toBe(1);
    expect(graph.get('2')?.rank).toBe(2);
    expect(graph.get('3')?.rank).toBe(3);

    const graph2 = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.
    //   0
    //   |
    //   1--|
    //   |  |
    //   2  3

    constructEdge(graph2, '0', '1');
    constructEdge(graph2, '1', '2');
    constructEdge(graph2, '1', '3');

    const layouter2 = new SMLayouter(graph2);
    layouter2.doLayout();

    expect(graph2.get('0')?.rank).toBe(0);
    expect(graph2.get('1')?.rank).toBe(1);
    expect(graph2.get('2')?.rank).toBe(2);
    expect(graph2.get('3')?.rank).toBe(2);
}

describe('Test vertical state machine layout ranking', () => {
    test('Basic branching', testBasicBranching);
    test('Nested branching', testNestedBranching);
    test(
        'Nested loops with fused assignment and condition edges',
        testNestedLoopsFusedEdes
    );
    test('Test self loops', testSelfLoop);
    test(
        'Test multiple inverted loops with skip edges',
        testMultiInvertedSkipLoops
    );
    test(
        'Test conditionally skipped loop with break and returns',
        testSkipLoopWithBreakReturn
    );
    test('Test multiple source nodes and sink nodes', testMultiEntryExit);
});

function testEdgeRoutingSelfLoop(): void {
    const graph = new DiGraph<SMLayouterNode, SMLayouterEdge>();

    // Construct graph.
    //   0
    //   |
    //  =1
    //   |
    //   2

    constructEdge(graph, '0', '1');
    constructEdge(graph, '1', '1');
    constructEdge(graph, '1', '2');

    const layouter = new SMLayouter(graph);
    layouter.doLayout();

    const selfEdge = graph.edge('1', '1')!;
    const node = graph.get('1')!;
    const lowerY = node.y + (node.height / 4);
    const upperY = node.y - (node.height / 4);
    const leftX = node.x - ((node.width / 2) + (BACKEDGE_SPACING / 2));
    const rightX = node.x - (node.width / 2);
    expect(selfEdge.points.length).toBe(4);
    expect(selfEdge.points[0].x).toBeCloseTo(rightX);
    expect(selfEdge.points[0].y).toBeCloseTo(lowerY);
    expect(selfEdge.points[1].x).toBeCloseTo(leftX);
    expect(selfEdge.points[1].y).toBeCloseTo(lowerY);
    expect(selfEdge.points[2].x).toBeCloseTo(leftX);
    expect(selfEdge.points[2].y).toBeCloseTo(upperY);
    expect(selfEdge.points[3].x).toBeCloseTo(rightX);
    expect(selfEdge.points[3].y).toBeCloseTo(upperY);
}

describe('Test vertical state machine edge routing', () => {
    test('Test routing a self edge loop', testEdgeRoutingSelfLoop);
});
