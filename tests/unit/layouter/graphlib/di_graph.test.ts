// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { DiGraph } from '../../../../src/layouter/graphlib/di_graph';

function testAddEdges(): void {
    const graph = new DiGraph();

    const testNodeId1 = 'tNodeId1';
    const testNodeId2 = 'tNodeId2';
    const testNodeId3 = 'tNodeId3';
    const testNodeId4 = 'tNodeId4';
    const testNodeId5 = 'tNodeId5';

    const e1 = {
        attr1: 'val1',
    };
    const e2 = {
        otherAttr: 'otherVal',
    };
    const e3 = {
        thatAttr: 'someVal',
    };

    graph.addNode(testNodeId5);
    graph.addEdge(testNodeId1, testNodeId2, e1);
    graph.addEdges([[testNodeId1, testNodeId3], [testNodeId4, testNodeId1]]);
    graph.addEdgesWithAttributes([
        [testNodeId2, testNodeId3, e2],
        [testNodeId3, testNodeId4, e3],
    ]);

    const edges = graph.edges();
    expect(edges).toContainEqual([testNodeId1, testNodeId2]);
    expect(graph.hasEdge(testNodeId1, testNodeId2)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId1, testNodeId3]);
    expect(graph.hasEdge(testNodeId1, testNodeId3)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId4, testNodeId1]);
    expect(graph.hasEdge(testNodeId4, testNodeId1)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId2, testNodeId3]);
    expect(graph.hasEdge(testNodeId2, testNodeId3)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId3, testNodeId4]);
    expect(graph.hasEdge(testNodeId3, testNodeId4)).toBeTruthy();
    expect(edges).not.toContainEqual([testNodeId2, testNodeId1]);
    expect(graph.hasEdge(testNodeId2, testNodeId1)).toBeFalsy();
    expect(edges).not.toContainEqual([testNodeId3, testNodeId1]);
    expect(graph.hasEdge(testNodeId3, testNodeId1)).toBeFalsy();
    expect(edges).not.toContainEqual([testNodeId1, testNodeId4]);
    expect(graph.hasEdge(testNodeId1, testNodeId4)).toBeFalsy();
    expect(edges).not.toContainEqual([testNodeId3, testNodeId2]);
    expect(graph.hasEdge(testNodeId3, testNodeId2)).toBeFalsy();
    expect(edges).not.toContainEqual([testNodeId4, testNodeId3]);
    expect(graph.hasEdge(testNodeId4, testNodeId3)).toBeFalsy();
    expect(edges.length).toBe(5);
    expect(graph.numberOfEdges()).toBe(5);

    expect(graph.edge(testNodeId1, testNodeId2)).toBe(e1);
    expect(graph.edge(testNodeId1, testNodeId3)).toBeNull();
    expect(graph.edge(testNodeId4, testNodeId1)).toBeNull();
    expect(graph.edge(testNodeId2, testNodeId3)).toBe(e2);
    expect(graph.edge(testNodeId3, testNodeId4)).toBe(e3);
    expect(() => graph.edge(testNodeId2, testNodeId4)).toThrow(Error);
    expect(() => graph.edge(testNodeId2, testNodeId1)).toThrow(Error);
    expect(() => graph.edge(testNodeId3, testNodeId1)).toThrow(Error);
    expect(() => graph.edge(testNodeId1, testNodeId4)).toThrow(Error);
    expect(() => graph.edge(testNodeId3, testNodeId2)).toThrow(Error);
    expect(() => graph.edge(testNodeId4, testNodeId3)).toThrow(Error);
    expect(() => graph.edge(testNodeId4, testNodeId2)).toThrow(Error);

    const neighbors1 = graph.neighbors(testNodeId1);
    const neighbors2 = graph.neighbors(testNodeId2);
    const neighbors3 = graph.neighbors(testNodeId3);
    const neighbors4 = graph.neighbors(testNodeId4);
    expect(neighbors1.length).toBe(2);
    expect(neighbors1).toContainEqual(testNodeId2);
    expect(neighbors1).toContainEqual(testNodeId3);
    expect(neighbors2.length).toBe(1);
    expect(neighbors2).toContainEqual(testNodeId3);
    expect(neighbors3.length).toBe(1);
    expect(neighbors3).toContainEqual(testNodeId4);
    expect(neighbors4.length).toBe(1);
    expect(neighbors4).toContainEqual(testNodeId1);

    expect(() => graph.neighbors('doesnotexist')).toThrow(Error);
    expect(graph.neighbors(testNodeId5)).toStrictEqual([]);

    const sources = graph.sources();
    expect(sources.length).toBe(1);
    expect(sources).toContain(testNodeId5);
    const sinks = graph.sinks();
    expect(sinks.length).toBe(1);
    expect(sinks).toContain(testNodeId5);

    expect(graph.inDegree(testNodeId1)).toBe(1);
    const iEdges1 = graph.inEdges(testNodeId1);
    expect(iEdges1.length).toBe(1);
    expect(iEdges1).toContainEqual([[testNodeId4, testNodeId1], null]);

    expect(graph.inDegree(testNodeId2)).toBe(1);
    const iEdges2 = graph.inEdges(testNodeId2);
    expect(iEdges2.length).toBe(1);
    expect(iEdges2).toContainEqual([[testNodeId1, testNodeId2], e1]);

    expect(graph.inDegree(testNodeId3)).toBe(2);
    const iEdges3 = graph.inEdges(testNodeId3);
    expect(iEdges3.length).toBe(2);
    expect(iEdges3).toContainEqual([[testNodeId1, testNodeId3], null]);
    expect(iEdges3).toContainEqual([[testNodeId2, testNodeId3], e2]);

    expect(graph.inDegree(testNodeId4)).toBe(1);
    const iEdges4 = graph.inEdges(testNodeId4);
    expect(iEdges4.length).toBe(1);
    expect(iEdges4).toContainEqual([[testNodeId3, testNodeId4], e3]);

    expect(graph.inDegree(testNodeId5)).toBe(0);

    expect(graph.outDegree(testNodeId1)).toBe(2);
    const oEdges1 = graph.outEdges(testNodeId1);
    expect(oEdges1.length).toBe(2);
    expect(oEdges1).toContainEqual([[testNodeId1, testNodeId2], e1]);
    expect(oEdges1).toContainEqual([[testNodeId1, testNodeId3], null]);

    expect(graph.outDegree(testNodeId2)).toBe(1);
    const oEdges2 = graph.outEdges(testNodeId2);
    expect(oEdges2.length).toBe(1);
    expect(oEdges2).toContainEqual([[testNodeId2, testNodeId3], e2]);

    expect(graph.outDegree(testNodeId3)).toBe(1);
    const oEdges3 = graph.outEdges(testNodeId3);
    expect(oEdges3.length).toBe(1);
    expect(oEdges3).toContainEqual([[testNodeId3, testNodeId4], e3]);

    expect(graph.outDegree(testNodeId4)).toBe(1);
    const oEdges4 = graph.outEdges(testNodeId4);
    expect(oEdges4.length).toBe(1);
    expect(oEdges4).toContainEqual([[testNodeId4, testNodeId1], null]);

    expect(graph.outDegree(testNodeId5)).toBe(0);

}

function testCopy(): void {
    const graph = new DiGraph();

    const testNode1 = {
        someAttr: 1,
    };
    const testNodeId1 = 'tNodeId1';

    const testNode2 = {
        someAttr: 2,
    };
    const testNodeId2 = 'tNodeId2';

    const testNode3 = {
        someAttr: 3,
    };
    const testNodeId3 = 'tNodeId3';

    const testNode4 = {
        someAttr: 4,
    };
    const testNodeId4 = 'tNodeId4';

    graph.addNodesWithAttributes([
        [testNodeId1, testNode1],
        [testNodeId2, testNode2],
        [testNodeId3, testNode3],
        [testNodeId4, testNode4],
    ]);
    graph.addEdges([
        [testNodeId1, testNodeId2],
        [testNodeId2, testNodeId3],
        [testNodeId3, testNodeId4],
        [testNodeId4, testNodeId1],
    ]);

    const copyGraph = graph.copy();

    expect(copyGraph).toStrictEqual(graph);
}

function testClear(): void {
    const graph = new DiGraph('somename');

    const testNodeId1 = 'tNodeId1';
    const testNodeId2 = 'tNodeId2';
    const testNodeId3 = 'tNodeId3';
    const testNodeId4 = 'tNodeId4';

    graph.addEdges([
        [testNodeId1, testNodeId2],
        [testNodeId2, testNodeId3],
        [testNodeId3, testNodeId4],
        [testNodeId1, testNodeId3],
        [testNodeId4, testNodeId1],
    ]);

    expect(graph.name).toBe('somename');

    graph.clear();

    expect(graph.name).toBe('');
    expect(graph.numberOfEdges()).toBe(0);
    expect(graph.numberOfNodes()).toBe(0);
    expect(() =>  graph.get(testNodeId1)).toThrow(Error);
    expect(() =>  graph.get(testNodeId2)).toThrow(Error);
    expect(() =>  graph.get(testNodeId3)).toThrow(Error);
    expect(() =>  graph.get(testNodeId4)).toThrow(Error);
}

function testSubgraph(): void {
    const graph = new DiGraph('somename');

    const testNodeId1 = 'tNodeId1';
    const testNodeId2 = 'tNodeId2';
    const testNodeId3 = 'tNodeId3';
    const testNodeId4 = 'tNodeId4';

    graph.addEdges([
        [testNodeId1, testNodeId2],
        [testNodeId2, testNodeId3],
        [testNodeId1, testNodeId3],
        [testNodeId4, testNodeId1],
    ]);

    const subgraph0 = graph.subgraph(new Set([testNodeId2, testNodeId4]));

    expect(subgraph0.numberOfEdges()).toBe(0);
    expect(subgraph0.numberOfNodes()).toBe(2);
    expect(subgraph0.nodes()).not.toContain(testNodeId1);
    expect(subgraph0.nodes()).toContain(testNodeId2);
    expect(subgraph0.nodes()).not.toContain(testNodeId3);
    expect(subgraph0.nodes()).toContain(testNodeId4);
    expect(subgraph0.hasEdge(testNodeId2, testNodeId4)).toBeFalsy();
    expect(subgraph0.hasEdge(testNodeId4, testNodeId2)).toBeFalsy();

    const subgraph1 = graph.subgraph(new Set([testNodeId1, testNodeId3]));

    expect(subgraph1.numberOfEdges()).toBe(1);
    expect(subgraph1.numberOfNodes()).toBe(2);
    expect(subgraph1.nodes()).toContain(testNodeId1);
    expect(subgraph1.nodes()).not.toContain(testNodeId2);
    expect(subgraph1.nodes()).toContain(testNodeId3);
    expect(subgraph1.nodes()).not.toContain(testNodeId4);
    expect(subgraph1.hasEdge(testNodeId1, testNodeId3)).toBeTruthy();
    expect(subgraph1.hasEdge(testNodeId3, testNodeId1)).toBeFalsy();

    const subgraph2 = graph.subgraph(new Set([
        testNodeId1, testNodeId3, testNodeId4
    ]));

    expect(subgraph2.numberOfEdges()).toBe(2);
    expect(subgraph2.numberOfNodes()).toBe(3);
    expect(subgraph2.nodes()).toContain(testNodeId1);
    expect(subgraph2.nodes()).not.toContain(testNodeId2);
    expect(subgraph2.nodes()).toContain(testNodeId3);
    expect(subgraph2.nodes()).toContain(testNodeId4);
    expect(subgraph2.hasEdge(testNodeId1, testNodeId3)).toBeTruthy();
    expect(subgraph2.hasEdge(testNodeId3, testNodeId1)).toBeFalsy();
    expect(subgraph2.hasEdge(testNodeId1, testNodeId4)).toBeFalsy();
    expect(subgraph2.hasEdge(testNodeId4, testNodeId1)).toBeTruthy();
    expect(subgraph2.hasEdge(testNodeId3, testNodeId4)).toBeFalsy();
    expect(subgraph2.hasEdge(testNodeId4, testNodeId3)).toBeFalsy();
}

function testReversing(): void {
    const graph = new DiGraph('somename');

    const testNodeId1 = 'tNodeId1';
    const testNodeId2 = 'tNodeId2';
    const testNodeId3 = 'tNodeId3';
    const testNodeId4 = 'tNodeId4';

    graph.addEdges([
        [testNodeId1, testNodeId2],
        [testNodeId2, testNodeId3],
        [testNodeId1, testNodeId3],
        [testNodeId4, testNodeId1],
    ]);

    const reversed = graph.reversed();

    expect(reversed.numberOfNodes()).toBe(4);
    expect(reversed.numberOfEdges()).toBe(4);
    expect(reversed.hasEdge(testNodeId1, testNodeId2)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId2, testNodeId1)).toBeTruthy();
    expect(reversed.hasEdge(testNodeId1, testNodeId3)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId3, testNodeId1)).toBeTruthy();
    expect(reversed.hasEdge(testNodeId1, testNodeId4)).toBeTruthy();
    expect(reversed.hasEdge(testNodeId4, testNodeId1)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId2, testNodeId3)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId3, testNodeId2)).toBeTruthy();
    expect(reversed.hasEdge(testNodeId2, testNodeId4)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId4, testNodeId2)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId3, testNodeId4)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId4, testNodeId3)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId1, testNodeId1)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId2, testNodeId2)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId3, testNodeId3)).toBeFalsy();
    expect(reversed.hasEdge(testNodeId4, testNodeId4)).toBeFalsy();
}

describe('Basic di-graph tests', () => {
    test('Test edge insertion', testAddEdges);
    test('Test graph copying', testCopy);
    test('Test graph clearing', testClear);
    test('Test subgraph', testSubgraph);
    test('Test reversing directed graph', testReversing);
});
