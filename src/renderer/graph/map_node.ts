import { JsonSDFGNode } from '../..';
import { ScopedNode } from './graph_element';

export class MapNode extends ScopedNode {

    public static readonly TYPE: string = 'MapEntry';
    public static readonly EXIT_TYPE: string = 'MapExit';

    public constructor(id: number) {
        super(id);
    }

    protected drawExpanded(): void {
        console.log('drawing expanded');
        console.log(this);
        
        this.lineStyle({
            width: 1,
            color: 0xFF0000,
        });
        this.drawRect(0, 0, this.width, this.height);
        return;
    }

    protected drawCollapsed(): void {
        console.log('drawing collapsed');
        
        return;
    }

    public static fromJSON(value: JsonSDFGNode): MapNode | undefined {
        if (value.type === MapNode.TYPE && value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);

            return instance;
        }

        return undefined;
    }

}
