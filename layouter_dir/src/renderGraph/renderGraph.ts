import * as _ from "lodash";
import Box from "../geometry/box";
import Graph from "../graph/graph";
import RenderEdge from "./renderEdge";
import RenderNode from "./renderNode";

export default class RenderGraph extends Graph<RenderNode, RenderEdge> {
    public layoutGraph = null;

    boundingBox(): Box {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        _.forEach(this.nodes(), (node: RenderNode) => {
            const box = node.boundingBox();
            minX = Math.min(minX, box.x);
            maxX = Math.max(maxX, box.x + box.width);
            minY = Math.min(minY, box.y);
            maxY = Math.max(maxY, box.y + box.height);
        });
        _.forEach(this.edges(), (edge: RenderEdge) => {
            const box = edge.boundingBox();
            minX = Math.min(minX, box.x);
            maxX = Math.max(maxX, box.x + box.width);
            minY = Math.min(minY, box.y);
            maxY = Math.max(maxY, box.y + box.height);
        });
        return new Box(minX, minY, maxX - minX, maxY - minY);
    }

    numNodes(): number {
        return this.allNodes().length;
    }

    numEdges(): number {
        return this.allEdges().length;
    }

    numConnectors(): number {
        return _.sum(_.map(this.allNodes(), node => node.inConnectors.length + node.outConnectors.length));
    }
}
