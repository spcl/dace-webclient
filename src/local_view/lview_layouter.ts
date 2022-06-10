import dagre from 'dagre';
import { Edge } from './elements/edge';
import { MapNode } from './elements/map_node';
import { Node } from './elements/node';
import { Graph } from './graph/graph';

export class LViewLayouter {

    public static layoutGraph(graph: Graph): Graph {
        const g = new dagre.graphlib.Graph({
            multigraph: true,
        });
        g.setGraph({
            ranksep: 100,
        });
        g.setDefaultEdgeLabel(() => { return {}; });

        graph.nodes.forEach((node: Node) => {
            if (node instanceof MapNode)
                this.layoutGraph(node.innerGraph);

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

        dagre.layout(g);

        g.nodes().forEach((nid: string) => {
            const node: any = g.node(nid);
            node.node.x = node.x - node.width / 2;
            node.node.y = node.y - node.height / 2;
        });
        g.edges().forEach((edge: dagre.Edge) => {
            const edgeObj = g.edge(edge);
            edgeObj.edge.points = edgeObj.points;
        });

        return graph;
    }

}
