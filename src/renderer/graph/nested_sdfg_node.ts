import { Graph } from './graph';
import { GraphNode } from './graph_element';

export class NestedSDFGNode extends GraphNode {

    public readonly nestedGraph = new Graph();

    public constructor(id: number) {
        super(id);
    }

    public draw(): void {
        super.draw();

        this.lineStyle({
            width: 1,
            color: 0x000000,
        });
        this.drawRect(0, 0, this.width, this.height);

        this.nestedGraph.draw();
    }

}
