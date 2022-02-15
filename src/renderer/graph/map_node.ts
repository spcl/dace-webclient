import { Text } from 'pixi.js';
import { JsonSDFGNode } from '../..';
import { ScopedNode } from './graph_element';

const HEADER_HEIGHT: number = 40;

type Range = {
    start: string | { main: string, approx: string },
    end: string | { main: string, approx: string },
    step: string | { main: string, approx: string },
    tile: string | { main: string, approx: string },
};

export class MapNode extends ScopedNode {

    public static readonly TYPE: string = 'MapEntry';
    public static readonly EXIT_TYPE: string = 'MapExit';

    public readonly topOffset: number = HEADER_HEIGHT;

    public readonly ranges: Range[] = [];
    public readonly params: string[] = [];

    private readonly labels: Text[] = [];

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

            this.scopedGraph.position.set(
                this.childPadding,
                HEADER_HEIGHT + this.childPadding
            );
            
            this.lineStyle({
                width: 1,
                color: 0x000000,
            });
            const w = this.layoutNode.width;
            const h = this.layoutNode.height;
            this.drawPolygon([
                0, HEADER_HEIGHT,
                0, HEADER_HEIGHT / 2,
                HEADER_HEIGHT / 2, 0,
                w - (HEADER_HEIGHT / 2), 0,
                w, HEADER_HEIGHT / 2,
                w, HEADER_HEIGHT,
                w, h,
                0, h,
                0, HEADER_HEIGHT,
                w, HEADER_HEIGHT,
            ]);

            const labelWidth = w / this.labels.length;
            for (let i = 0; i < this.labels.length; i++) {
                const label = this.labels[i];
                label.position.set(
                    (i * labelWidth) +
                    (labelWidth / 2), HEADER_HEIGHT / 2
                );
                label.anchor.set(0.5);
            }

            this.lineStyle({
                width: 1,
                color: 0x000000,
                alpha: 0.3,
            });
            for (let i = 0; i < this.labels.length - 1; i++) {
                const lineX = (i + 1) * labelWidth;
                this.moveTo(lineX, 0);
                this.lineTo(lineX, HEADER_HEIGHT);
            }

            /*
            this.layoutNode.inConnectors.forEach((iconn: any, i: number) => {
                const conn = this.inConnectors[i];
                const connPos = {
                    x: iconn.x,
                    y: iconn.y,
                };
                const connLPos = this.parent.toLocal(connPos);
                conn.position.set(connLPos.x, connLPos.y);
                conn.draw({ w: iconn.width, h: iconn.width });
            });
            this.layoutNode.outConnectors.forEach((oconn: any, i: number) => {
                const conn = this.outConnectors[i];
                const connPos = {
                    x: oconn.x,
                    y: oconn.y,
                };
                const connLPos = this.parent.toLocal(connPos);
                conn.position.set(connLPos.x, connLPos.y);
                conn.draw({ w: oconn.width, h: oconn.width });
            });
            */
        } else {
            this.scopedGraph.position.set(
                this.childPadding, HEADER_HEIGHT + this.childPadding
            );
            
            this.lineStyle({
                width: 1,
                color: 0x000000,
            });

            let maxLabelWidth = 0;
            this.labels.forEach(label => {
                maxLabelWidth = Math.max(
                    label.width + HEADER_HEIGHT, maxLabelWidth
                );
            });

            const w = Math.max(
                this.scopedGraph.width, maxLabelWidth * this.labels.length
            );
            const h = this.scopedGraph.height + HEADER_HEIGHT;

            this.drawPolygon([
                0, HEADER_HEIGHT,
                0, HEADER_HEIGHT / 2,
                HEADER_HEIGHT / 2, 0,
                w - (HEADER_HEIGHT / 2), 0,
                w, HEADER_HEIGHT / 2,
                w, HEADER_HEIGHT,
                w, h,
                0, h,
                0, HEADER_HEIGHT,
                w, HEADER_HEIGHT,
            ]);

            const labelWidth = w / this.labels.length;
            for (let i = 0; i < this.labels.length; i++) {
                const label = this.labels[i];
                label.position.set(
                    (i * labelWidth) +
                    (labelWidth / 2), HEADER_HEIGHT / 4
                );
                label.anchor.set(0.5);
            }

            this.lineStyle({
                width: 1,
                color: 0x000000,
                alpha: 0.3,
            });
            for (let i = 0; i < this.labels.length - 1; i++) {
                const lineX = (i + 1) * labelWidth;
                this.moveTo(lineX, 0);
                this.lineTo(lineX, HEADER_HEIGHT);
            }
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

            const range = instance.attributes.get('range');
            if (range) {
                const rngs: Range[] = (range as any).ranges;
                rngs.forEach(rng => {
                    instance.ranges.push(rng);
                });
            }

            const pms: string[] = instance.attributes.get('params');
            if (pms)
                pms.forEach(pm => {
                    instance.params.push(pm);
                });

            for (let i = 0; i < instance.ranges.length; i++) {
                const range = instance.ranges[i];
                const param = instance.params[i];
                const startText =
                    typeof range.start === 'string' ?
                    range.start : range.start.approx; 
                const endText =
                    typeof range.end === 'string' ?
                    range.end : range.end.approx; 
                const stepText =
                    typeof range.step === 'string' ?
                    range.step : range.step.approx; 
                const labelText = param + '=' + startText + ':' + endText +
                    ':' + stepText;
                const label = new Text(labelText, {
                    fontFamily: 'Montserrat',
                    fontSize: 16,
                });
                instance.labels.push(label);
                instance.addChild(label);
            }

            return instance;
        }

        return undefined;
    }

}
