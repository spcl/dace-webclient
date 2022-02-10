import { JsonSDFGEdge } from '../..';
import { GraphEdge } from './graph_element';

export class Memlet extends GraphEdge {

    public static readonly TYPE: string = 'MultiConnectorEdge';

    public constructor(src: string, dst: string) {
        super(src, dst);
    }

    public draw(): void {
        super.draw();
    }

    public static fromJSON(value: JsonSDFGEdge): Memlet | undefined {
        if (value.type === Memlet.TYPE && value.src !== undefined &&
            value.dst !== undefined) {
            const instance = new this(value.src, value.dst);

            instance.loadAttributes(value.attributes);

            return instance;
        }
        return undefined;
    }

}
