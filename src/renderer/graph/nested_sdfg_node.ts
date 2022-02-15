import { Graph } from './graph';
import { GraphNode } from './graph_element';

export class NestedSDFGNode extends GraphNode {

    public static readonly TYPE: string = 'NestedSDFGNode';

    public readonly nestedGraph = new Graph();

    public constructor(id: number) {
        super(id);
    }

    public type(): string {
        return NestedSDFGNode.TYPE;
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

    public get childGraph(): Graph {
        return this.nestedGraph;
    }

}
