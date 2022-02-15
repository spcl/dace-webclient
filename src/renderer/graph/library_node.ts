import { GraphNode } from './graph_element';

export class LibraryNode extends GraphNode {

    public static readonly TYPE: string = 'LibraryNode';

    public constructor(id: number) {
        super(id);
    }

    public type(): string {
        return LibraryNode.TYPE;
    }

    public draw(): void {
        super.draw();
    }

}
