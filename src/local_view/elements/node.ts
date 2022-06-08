import { Graph } from '../graph/graph';
import { Edge } from './edge';
import { Element } from './element';

export class Node extends Element {

    public readonly inEdges: Edge[] = [];
    public readonly outEdges: Edge[] = [];

    constructor(
        public readonly parentGraph: Graph
    ) {
        super();
    }

    public draw(): void {
        super.draw();
    }

}
