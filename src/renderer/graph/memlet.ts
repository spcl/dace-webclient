import { JsonSDFGEdge } from '../..';
import { GraphEdge } from './graph_element';

export class Memlet extends GraphEdge {

    public static readonly TYPE: string = 'MultiConnectorEdge';

    public constructor(src: string, dst: string) {
        super(src, dst);
    }

    public type(): string {
        return Memlet.TYPE;
    }

    public draw(): void {
        super.draw();

        this.drawSelf();
    }

    private drawSelf(): void {
        if (this.layoutEdge) {
            const startPoint = this.layoutEdge.points[0];
            const endPoint =
                this.layoutEdge.points[this.layoutEdge.points.length - 1];
            
            const localStart = this.parent.toLocal(startPoint);
            const localEnd = this.parent.toLocal(endPoint);

            this.moveTo(localStart.x, localStart.y);
            this.lineStyle({
                width: 1,
                color: 0x000000,
            });
            this.lineTo(localEnd.x, localEnd.y);
        }
    }

    public static fromJSON(value: JsonSDFGEdge): Memlet | undefined {
        if (value.type === Memlet.TYPE && value.src !== undefined &&
            value.dst !== undefined) {
            const instance = new this(value.src, value.dst);

            instance.loadAttributes(value.attributes);

            if (value.src_connector)
                instance.srcConnector = value.src_connector;
            if (value.dst_connector)
                instance.dstConnector = value.dst_connector;

            return instance;
        }
        return undefined;
    }

}
