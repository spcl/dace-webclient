import { Graph } from '../../../../src/layouter/graphlib/graph';

function testInsertNode(): void {
    const graph = new Graph();

    const testNode1 = {
        someAttribute: 'withSomeValue',
        anotherAttribute: {
            aNestedAttribute: 'ohAnotherValue!',
        },
    };
    const testNodeId1 = 'tNodeId1';

    const testNode2 = {
        completelyDifferentAttribute: null,
    };
    const testNodeId2 = 'tNodeId2';

    graph.addNode(testNodeId1, testNode1);
    graph.addNode(testNodeId2, testNode2);

    const nodes = graph.nodes();
    expect(nodes).toContainEqual(testNodeId1);
    expect(nodes).toContainEqual(testNodeId2);
    expect(nodes.length).toBe(2);
    expect(graph.numberOfNodes()).toBe(2);

    expect(graph.get(testNodeId1)).toStrictEqual(testNode1);
    expect(graph.get(testNodeId2)).toStrictEqual(testNode2);
    expect(() => graph.get('doesnotexist')).toThrow(Error);
}

function testInsertMultipleNodes(): void {
    const graph = new Graph();

    const testNode1 = {
        someAttribute: 'withSomeValue',
        anotherAttribute: {
            aNestedAttribute: 'ohAnotherValue!',
        },
    };
    const testNodeId1 = 'tNodeId1';

    const testNode2 = {
        completelyDifferentAttribute: null,
    };
    const testNodeId2 = 'tNodeId2';

    graph.addNodesWithAttributes([
        [testNodeId1, testNode1],
        [testNodeId2, testNode2],
    ]);

    const testNodeId3 = 'tNodeId3';
    const testNodeId4 = 'tNodeId4';
    graph.addNodes([testNodeId3, testNodeId4]);

    const nodes = graph.nodes();
    expect(nodes).toContainEqual(testNodeId1);
    expect(nodes).toContainEqual(testNodeId2);
    expect(nodes).toContainEqual(testNodeId3);
    expect(nodes).toContainEqual(testNodeId4);
    expect(nodes.length).toBe(4);
    expect(graph.numberOfNodes()).toBe(4);

    expect(graph.get(testNodeId1)).toStrictEqual(testNode1);
    expect(graph.get(testNodeId2)).toStrictEqual(testNode2);
    expect(graph.get(testNodeId3)).toBeNull();
    expect(graph.get(testNodeId4)).toBeNull();
    expect(() => graph.get('doesnotexist')).toThrow(Error);
}

function testAddEdges(): void {
    const graph = new Graph();

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
    expect(edges).toContainEqual([testNodeId2, testNodeId1]);
    expect(graph.hasEdge(testNodeId2, testNodeId1)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId3, testNodeId1]);
    expect(graph.hasEdge(testNodeId3, testNodeId1)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId1, testNodeId4]);
    expect(graph.hasEdge(testNodeId1, testNodeId4)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId3, testNodeId2]);
    expect(graph.hasEdge(testNodeId3, testNodeId2)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId4, testNodeId3]);
    expect(graph.hasEdge(testNodeId4, testNodeId3)).toBeTruthy();
    expect(edges.length).toBe(10);
    expect(graph.numberOfEdges()).toBe(5);

    expect(graph.edge(testNodeId1, testNodeId2)).toBe(e1);
    expect(graph.edge(testNodeId1, testNodeId3)).toBeNull();
    expect(graph.edge(testNodeId4, testNodeId1)).toBeNull();
    expect(graph.edge(testNodeId2, testNodeId3)).toBe(e2);
    expect(graph.edge(testNodeId3, testNodeId4)).toBe(e3);
    expect(() => graph.edge(testNodeId2, testNodeId4)).toThrow(Error);
    expect(graph.edge(testNodeId2, testNodeId1)).toBe(e1);
    expect(graph.edge(testNodeId3, testNodeId1)).toBeNull();
    expect(graph.edge(testNodeId1, testNodeId4)).toBeNull();
    expect(graph.edge(testNodeId3, testNodeId2)).toBe(e2);
    expect(graph.edge(testNodeId4, testNodeId3)).toBe(e3);
    expect(() => graph.edge(testNodeId4, testNodeId2)).toThrow(Error);

    const neighbors1 = graph.neighbors(testNodeId1);
    const neighbors2 = graph.neighbors(testNodeId2);
    const neighbors3 = graph.neighbors(testNodeId3);
    const neighbors4 = graph.neighbors(testNodeId4);
    expect(neighbors1.length).toBe(3);
    expect(neighbors1).toStrictEqual([testNodeId2, testNodeId3, testNodeId4]);
    expect(neighbors2.length).toBe(2);
    expect(neighbors2).toStrictEqual([testNodeId1, testNodeId3]);
    expect(neighbors3.length).toBe(3);
    expect(neighbors3).toStrictEqual([testNodeId1, testNodeId2, testNodeId4]);
    expect(neighbors4.length).toBe(2);
    expect(neighbors4).toStrictEqual([testNodeId1, testNodeId3]);

    expect(() => graph.neighbors('doesnotexist')).toThrow(Error);
    expect(graph.neighbors(testNodeId5)).toStrictEqual([]);

    const adjList = graph.adjList();
    expect(adjList).toContainEqual(testNodeId5);
    expect(adjList).toContainEqual([testNodeId1, testNodeId2]);
    expect(adjList).toContainEqual([testNodeId1, testNodeId3]);
    expect(adjList).toContainEqual([testNodeId1, testNodeId4]);
    expect(adjList).toContainEqual([testNodeId2, testNodeId1]);
    expect(adjList).toContainEqual([testNodeId2, testNodeId3]);
    expect(adjList).toContainEqual([testNodeId3, testNodeId1]);
    expect(adjList).toContainEqual([testNodeId3, testNodeId2]);
    expect(adjList).toContainEqual([testNodeId3, testNodeId4]);
    expect(adjList).toContainEqual([testNodeId4, testNodeId1]);
    expect(adjList).toContainEqual([testNodeId4, testNodeId3]);
    expect(adjList.length).toBe(11);
}

function testRemoveNode(): void {
    const graph = new Graph();

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

    graph.removeNode(testNodeId1);
    graph.removeNodes([testNodeId3, testNodeId4]);

    const nodes = graph.nodes();
    expect(nodes).not.toContainEqual(testNodeId1);
    expect(nodes).toContainEqual(testNodeId2);
    expect(nodes).not.toContainEqual(testNodeId3);
    expect(nodes).not.toContainEqual(testNodeId4);
    expect(nodes.length).toBe(1);
    expect(graph.numberOfNodes()).toBe(1);

    expect(() => graph.get(testNodeId1)).toThrow(Error);
    expect(graph.get(testNodeId2)).toStrictEqual(testNode2);
    expect(() => graph.get(testNodeId3)).toThrow(Error);
    expect(() => graph.get(testNodeId4)).toThrow(Error);
}

function testRemoveEdge(): void {
    const graph = new Graph();

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

    graph.removeEdge(testNodeId1, testNodeId2);

    const edges = graph.edges();
    expect(edges).not.toContainEqual([testNodeId1, testNodeId2]);
    expect(graph.hasEdge(testNodeId1, testNodeId2)).toBeFalsy();
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
    expect(edges).toContainEqual([testNodeId3, testNodeId1]);
    expect(graph.hasEdge(testNodeId3, testNodeId1)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId1, testNodeId4]);
    expect(graph.hasEdge(testNodeId1, testNodeId4)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId3, testNodeId2]);
    expect(graph.hasEdge(testNodeId3, testNodeId2)).toBeTruthy();
    expect(edges).toContainEqual([testNodeId4, testNodeId3]);
    expect(graph.hasEdge(testNodeId4, testNodeId3)).toBeTruthy();
    expect(edges.length).toBe(8);
    expect(graph.numberOfEdges()).toBe(4);

    expect(() => graph.edge(testNodeId1, testNodeId2)).toThrow(Error);
    expect(graph.edge(testNodeId1, testNodeId3)).toBeNull();
    expect(graph.edge(testNodeId4, testNodeId1)).toBeNull();
    expect(graph.edge(testNodeId2, testNodeId3)).toBeNull();
    expect(graph.edge(testNodeId3, testNodeId4)).toBeNull();
    expect(() => graph.edge(testNodeId2, testNodeId4)).toThrow(Error);
    expect(() => graph.edge(testNodeId2, testNodeId1)).toThrow(Error);
    expect(graph.edge(testNodeId3, testNodeId1)).toBeNull();
    expect(graph.edge(testNodeId1, testNodeId4)).toBeNull();
    expect(graph.edge(testNodeId3, testNodeId2)).toBeNull();
    expect(graph.edge(testNodeId4, testNodeId3)).toBeNull();
    expect(() => graph.edge(testNodeId4, testNodeId2)).toThrow(Error);
}

function testCopy(): void {
    const graph = new Graph();

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
    const graph = new Graph('somename');

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
    const graph = new Graph('somename');

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

    const subgraph1 = graph.subgraph(new Set([testNodeId1, testNodeId3]));

    expect(subgraph1.numberOfEdges()).toBe(1);
    expect(subgraph1.numberOfNodes()).toBe(2);
    expect(subgraph1.nodes()).toContain(testNodeId1);
    expect(subgraph1.nodes()).not.toContain(testNodeId2);
    expect(subgraph1.nodes()).toContain(testNodeId3);
    expect(subgraph1.nodes()).not.toContain(testNodeId4);
    expect(subgraph1.hasEdge(testNodeId1, testNodeId3)).toBeTruthy();
    expect(subgraph1.hasEdge(testNodeId3, testNodeId1)).toBeTruthy();

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
    expect(subgraph2.hasEdge(testNodeId3, testNodeId1)).toBeTruthy();
    expect(subgraph2.hasEdge(testNodeId1, testNodeId4)).toBeTruthy();
    expect(subgraph2.hasEdge(testNodeId4, testNodeId1)).toBeTruthy();
    expect(subgraph2.hasEdge(testNodeId3, testNodeId4)).toBeFalsy();
    expect(subgraph2.hasEdge(testNodeId4, testNodeId3)).toBeFalsy();
}

describe('Basic graph tests', () => {
    test('Test node insertion', testInsertNode);
    test('Test multiple node insertion', testInsertMultipleNodes);
    test('Test edge insertion', testAddEdges);
    test('Test node removal', testRemoveNode);
    test('Test edge removal', testRemoveEdge);
    test('Test graph copying', testCopy);
    test('Test graph clearing', testClear);
    test('Test subgraphs', testSubgraph);
});
