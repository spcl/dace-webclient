import { GraphEdge } from './graph_element';

export class InterStateEdge extends GraphEdge {

    public constructor(src: string, dst: string) {
        super(src, dst);
    }

    public draw(): void {
        super.draw();
    }

}
