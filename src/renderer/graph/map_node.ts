import { JsonSDFGNode } from '../..';
import { Connector, ScopedNode } from './graph_element';

export class MapNode extends ScopedNode {

    public static readonly TYPE: string = 'MapEntry';
    public static readonly EXIT_TYPE: string = 'MapExit';

    public constructor(id: number) {
        super(id);
    }

    public type(): string {
        return MapNode.TYPE;
    }

    protected drawExpanded(): void {
        if (this.layoutNode) {
            const pos = {
                x: this.layoutNode.x,
                y: this.layoutNode.y,
            };
            const lPos = this.parent.toLocal(pos);
            this.position.set(lPos.x, lPos.y);

            this.scopedGraph.position.set(0);
            
            this.lineStyle({
                width: 1,
                color: 0xFF0000,
            });
            this.drawRect(
                0, 0, this.layoutNode.width, this.layoutNode.height
            );
        } else {
            this.scopedGraph.position.set(10);
            
            this.lineStyle({
                width: 1,
                color: 0xFF0000,
            });
            this.drawRect(0, 0, this.scopedGraph.width + 2 * 10, this.scopedGraph.height + 2 * 10);
        }
    }

    protected drawCollapsed(): void {
        return;
    }

    public static fromJSON(value: JsonSDFGNode): MapNode | undefined {
        if (value.type === MapNode.TYPE && value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);
            instance.loadInConnectors();

            return instance;
        }

        return undefined;
    }

}
