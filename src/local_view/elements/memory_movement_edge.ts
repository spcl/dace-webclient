// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import { cos, sin, tanh } from 'mathjs';
import { Point, Text } from 'pixi.js';
import { getTempColorHEX } from '../../utils/utils';
import { Graph } from '../graph/graph';
import { LViewRenderer } from '../lview_renderer';
import { Edge } from './edge';
import { DEFAULT_TEXT_STYLE } from './element';
import { MemoryNode } from './memory_node';
import { Node } from './node';

export class MemoryMovementEdge extends Edge {

    private readonly gfxText: Text;

    public physMovementOverlayActive: boolean = false;

    private _volume: number = 0;

    constructor(
        public readonly text: string | null,
        private readonly parentGraph: Graph,
        public points: Point[],
        src: Node,
        dst: Node,
        renderer?: LViewRenderer,
    ) {
        super(src, dst, renderer);

        src.outEdges.push(this);
        dst.inEdges.push(this);

        this.gfxText = new Text(this.text ? this.text : '', DEFAULT_TEXT_STYLE);
        this.gfxText.renderable = false;
        this.addChild(this.gfxText);
    }

    private drawText(
        text: string | null, x: number, y: number, fontSize: number
    ): void {
        if (text !== null && text !== '') {
            this.gfxText.renderable = true;
            this.gfxText.text = text;
            this.gfxText.style = {
                fontSize: fontSize,
                fontFamily: DEFAULT_TEXT_STYLE.fontFamily,
            };

            this.gfxText.position.x = x;
            this.gfxText.position.y = y;
            this.gfxText.anchor.x = 0.5;
            this.gfxText.anchor.y = 1.0;

            this.lineStyle({
                color: 0x000000,
            }).beginFill(0xffffff).drawRect(
                this.gfxText.position.x - ((this.gfxText.width / 2) + 5),
                this.gfxText.position.y - (this.gfxText.height + 5),
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
        const lineSizeInput = $('#cache-line-size-input').val();
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

        // Figure out the line angle with respect to the x-axis (in the
        // src->dst direction).
        const firstPoint = this.points[0];
        const secondToLastPoint = this.points[this.points.length - 2];
        const lastPoint = this.points[this.points.length - 1];
        const theta = (lastPoint.x === secondToLastPoint.x) ?
                0 : 0 - tanh(
                    (secondToLastPoint.x - lastPoint.x) /
                    (secondToLastPoint.y - lastPoint.y)
                );

        let color = 0x000000;
        let text: string | null = null;
        let arrowHeadLength = 16;
        let lineWidth = 1;
        let fontSize = 30;

        if (this.physMovementOverlayActive) {
            let badness = 0;
            if (this.renderer) {
                const keys = [
                    ...this.renderer.globalMemoryMovementHistogram.keys()
                ];
                keys.sort((a, b) => { return a - b; });

                const idx = keys.indexOf(this._volume);

                if (idx > 0 && keys.length > 1)
                    badness = idx / (keys.length - 1);
            }

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
            fontSize = 20;
        }

        this.lineStyle({
            color: color,
            width: lineWidth,
        });

        // Draw the edge.
        this.moveTo(firstPoint.x, firstPoint.y);
        for (let i = 1; i < this.points.length; i++)
            this.lineTo(this.points[i].x, this.points[i].y);

        // Draw the arrow head at the destination.
        const arrowTopLeftXStraight = lastPoint.x - (arrowHeadLength / 2);
        const arrowTopLeftYStraight = lastPoint.y - arrowHeadLength;
        const arrowTopRightXStraight = lastPoint.x + (arrowHeadLength / 2);
        const arrowTopRightYStraight = lastPoint.y - arrowHeadLength;

        // Rotate according to angle.
        const arrowTopLeft = this.rotatePoint(
            { x: arrowTopLeftXStraight, y: arrowTopLeftYStraight },
            { x: lastPoint.x, y: lastPoint.y }, theta
        );
        const arrowTopRight = this.rotatePoint(
            { x: arrowTopRightXStraight, y: arrowTopRightYStraight },
            { x: lastPoint.x, y: lastPoint.y }, theta
        );
        this.lineStyle({
            color: color,
        }).beginFill(color).drawPolygon([
            lastPoint.x - (lineWidth / 2), lastPoint.y,
            arrowTopLeft.x, arrowTopLeft.y,
            arrowTopRight.x, arrowTopRight.y,
            lastPoint.x + (lineWidth / 2), lastPoint.y,
        ]);

        const textX = (
            this.points[this.points.length - 1].x +
            this.points[this.points.length - 2].x
        ) / 2;
        const textY = (
            this.points[this.points.length - 1].y +
            this.points[this.points.length - 2].y
        ) / 2;

        this.drawText(text, textX, textY, fontSize);
    }

    public get volume(): number {
        return this._volume;
    }

}
