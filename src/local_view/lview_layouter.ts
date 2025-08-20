// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import { Edge } from './elements/edge';
import { MapNode } from './elements/map_node';
import { Node } from './elements/node';
import { Graph } from './graph/graph';


export function layoutGraph(graph: Graph): Graph {
    const g = new graphlib.Graph({
        multigraph: true,
    });
    g.setGraph({
        ranksep: 100,
    });
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    graph.nodes.forEach((node: Node) => {
        if (node instanceof MapNode) {
            layoutGraph(node.innerGraph);
            // TODO: this is a hack, drawing gets the proper sizes, but
            // it has to be possible without.
            node.innerGraph.draw();
            node.recalculateSize();
        }

        g.setNode(node.id, {
            node: node,
            width: node.unscaledWidth,
            height: node.unscaledHeight,
        });
    });
    graph.edges.forEach((edge: Edge) => {
        g.setEdge(edge.src.id, edge.dst.id, {
            edge: edge,
        });
    });

    dagreLayout(g);

    g.nodes().forEach(nid => {
        const node = g.node(nid) as dagre.Node & {
            node: dagre.Node;
        };
        node.node.x = node.x - node.width / 2;
        node.node.y = node.y - node.height / 2;
    });
    g.edges().forEach((edge: dagre.Edge) => {
        const edgeObj = g.edge(edge) as dagre.GraphEdge & {
            edge: dagre.GraphEdge;
        };
        edgeObj.edge.points = edgeObj.points;
    });

    return graph;
}
