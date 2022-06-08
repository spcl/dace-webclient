import { Text } from '@pixi/text';
import $ from 'jquery';
import { cos, sin, tanh } from 'mathjs';
import { getTempColorHEX } from '../../utils/utils';
import { Graph } from '../graph/graph';
import { Edge } from './edge';
import { DEFAULT_TEXT_STYLE } from './element';
import { MemoryNode } from './memory_node';
import { Node } from './node';

export class MemoryMovementEdge extends Edge {

    private readonly gfxText: Text;

    public physMovementOverlayActive: boolean = false;

    private _volume: number = 0;

    constructor(
        private text: string | null,
        private readonly parentGraph: Graph,
        src: Node,
        dst: Node,
    ) {
        super(src, dst);

        src.outEdges.push(this);
        dst.inEdges.push(this);

        this.gfxText = new Text(this.text ? this.text : '', DEFAULT_TEXT_STYLE);
        this.gfxText.renderable = false;
        this.addChild(this.gfxText);
    }

    private drawText(
        text: string | null, fromX: number, toX: number, fromY: number,
        toY: number, fontSize: number
    ): void {
        if (text !== null && text !== '') {
            this.gfxText.renderable = true;
            this.gfxText.text = text;
            this.gfxText.style = {
                fontSize: fontSize,
                fontFamily: DEFAULT_TEXT_STYLE.fontFamily,
            };

            const centerX = fromX + (toX - fromX) / 2;
            const centerY = fromY + (toY - fromY) / 2;

            this.gfxText.position.x = centerX;
            this.gfxText.position.y = centerY;
            this.gfxText.anchor.x = 0.5;
            this.gfxText.anchor.y = 0.5;

            this.lineStyle({
                color: 0x000000,
            }).beginFill(0xffffff).drawRect(
                this.gfxText.position.x - ((this.gfxText.width / 2) + 5),
                this.gfxText.position.y - ((this.gfxText.height / 2) + 5),
                this.gfxText.width + 10,
                this.gfxText.height + 10
            );
        } else {
            this.gfxText.renderable = false;
        }
    }

    public clearVolume(): void {
        this._volume = 0;
    }

    private getVolumeFromMemNode(memNode: MemoryNode): number {
        const misses = memNode.getTotalCacheMisses();
        const lineSizeInput = $('#cacheLineSizeInput').val();
        let lineSize = 0;
        if (lineSizeInput !== undefined && typeof(lineSizeInput) === 'string')
            lineSize = parseInt(lineSizeInput);

        return lineSize * misses;
    }

    public calculateMovementVolume(): number {
        this._volume = 0;
        if (this.src instanceof MemoryNode) {
            this._volume = this.getVolumeFromMemNode(this.src);
        } else if (this.dst instanceof MemoryNode) {
            this._volume = this.getVolumeFromMemNode(this.dst);
        }

        return this._volume;
    }

    private rotatePoint(
        point: { x: number, y: number }, around: { x: number, y: number },
        by: number
    ): { x: number, y: number } {
        const s = sin(by);
        const c = cos(by);
        point.x -= around.x;
        point.y -= around.y;
        const xnew = point.x * c - point.y * s;
        const ynew = point.x * s + point.y * c;
        point.x = xnew + around.x;
        point.y = ynew + around.y;
        return point;
    }

    public draw(): void {
        super.draw();

        // Figure out where on the x axis of the source we should position
        // ourselves.
        const srcNEdges = this.src.outEdges.length;
        const srcSegmentWidth = this.src.width / srcNEdges;
        const srcStartOffset = srcSegmentWidth / 2;
        const srcIdx = this.src.outEdges.indexOf(this);

        const fromX = this.src.x + (srcIdx * srcSegmentWidth) + srcStartOffset;
        const fromY = this.src.y + this.src.height;

        // Figure out where on the x axis of the destionation we should position
        // ourselves.
        const dstNEdges = this.dst.inEdges.length;
        const dstSegmentWidth = this.dst.width / dstNEdges;
        const dstStartOffset = dstSegmentWidth / 2;
        const dstIdx = this.dst.inEdges.indexOf(this);

        const toX = this.dst.x + (dstIdx * dstSegmentWidth) + dstStartOffset;
        const toY = this.dst.y;

        // Figure out the line angle with respect to the x-axis (in the
        // src->dst direction).
        const theta = (fromX === toX) ?
            0 : 0 - tanh((fromX - toX) / (fromY - toY));

        let color = 0x000000;
        let text: string | null = null;
        let arrowHeadLength = 16;
        let lineWidth = 1;
        let fontSize = 30;

        if (this.physMovementOverlayActive) {
            // TODO
            //const keys = [
            //    ...Application.getInstance().globalMemMovementHistogram.keys()
            //];
            //keys.sort((a, b) => { return a - b; });

            //const idx = keys.indexOf(this._volume);

            //let badness = 0;

            //if (idx > 0 && keys.length > 1)
            //    badness = idx / (keys.length - 1);
            const badness = 0;

            color = getTempColorHEX(badness);

            lineWidth = 10;
            arrowHeadLength = 30;

            let vol = this._volume;
            let unit = 1;
            while (vol >= 1024 && unit <= 1000000000) {
                vol /= 1024;
                unit *= 1000;
            }
            let unitString = 'B';
            switch (unit) {
                case 1000:
                    unitString = 'KB';
                    break;
                case 1000000:
                    unitString = 'MB';
                    break;
                case 1000000000:
                    unitString = 'GB';
                    break;
            }
            text = vol.toString() + ' ' + unitString;
            fontSize = 20;
        } else {
            text = this.text;
            fontSize = 30;
        }

        this.lineStyle({
            color: color,
            width: lineWidth,
        });

        // Draw the edge.
        this.moveTo(fromX, fromY);
        this.lineTo(toX, toY);

        // Draw the arrow head at the destination.
        const arrowTopLeftXStraight = toX - (arrowHeadLength / 2);
        const arrowTopLeftYStraight = toY - arrowHeadLength;
        const arrowTopRightXStraight = toX + (arrowHeadLength / 2);
        const arrowTopRightYStraight = toY - arrowHeadLength;

        // Rotate according to angle.
        const arrowTopLeft = this.rotatePoint(
            { x: arrowTopLeftXStraight, y: arrowTopLeftYStraight },
            { x: toX, y: toY }, theta
        );
        const arrowTopRight = this.rotatePoint(
            { x: arrowTopRightXStraight, y: arrowTopRightYStraight },
            { x: toX, y: toY }, theta
        );
        this.lineStyle({
            color: color,
        }).beginFill(color).drawPolygon([
            toX - (lineWidth / 2), toY,
            arrowTopLeft.x, arrowTopLeft.y,
            arrowTopRight.x, arrowTopRight.y,
            toX + (lineWidth / 2), toY,
        ]);

        this.drawText(text, fromX, toX, fromY, toY, fontSize);
    }

    public get volume(): number {
        return this._volume;
    }

}
