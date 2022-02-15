import { GraphEdge } from './graph_element';

export class InterStateEdge extends GraphEdge {

    public static readonly TYPE: string = 'InterstateEdge';

    public constructor(src: string, dst: string) {
        super(src, dst);
    }

    public type(): string {
        return InterStateEdge.TYPE;
    }

    public draw(): void {
        super.draw();
    }

}
