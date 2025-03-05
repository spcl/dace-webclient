import { Point2D } from '../types';
import {
    AllocationEvent,
    DeallocationEvent,
    MemoryEvent,
    TimelineView,
} from './access_timeline';

export class TimelineViewElement {

    // Indicate special drawing conditions based on interactions.
    public selected: boolean = false;
    public highlighted: boolean = false;
    public hovered: boolean = false;

    public x: number = 0;
    public y: number = 0;
    public width: number = 0;
    public height: number = 0;

    public constructor() {
    }

    public draw(
        _renderer: TimelineView, _ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        return;
    }

    public simpleDraw(
        _renderer: TimelineView, _ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        return;
    }

    public shade(
        _renderer: TimelineView, _ctx: CanvasRenderingContext2D, _color: string,
        _alpha: number = 0.4
    ): void {
        return;
    }

    public debugDraw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D
    ): void {
        if (renderer.debugDraw) {
            // Print the center and bounding box in debug mode.
            ctx.beginPath();
            ctx.arc(this.x, this.y, 1, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'red';
            ctx.fill();
            ctx.strokeStyle = 'red';
            ctx.stroke();
            ctx.strokeRect(
                this.x - (this.width / 2.0), this.y - (this.height / 2.0),
                this.width, this.height
            );
        }
    }

    // Produces HTML for a hover-tooltip
    public tooltip(container: HTMLElement): void {
        container.className = 'sdfvtooltip';
    }

    public topleft(): Point2D {
        return { x: this.x - this.width / 2, y: this.y - this.height / 2 };
    }

    // General bounding-box intersection function. Returns true iff point or
    // rectangle intersect element.
    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        if (w === 0 || h === 0) {  // Point-element intersection
            return (x >= this.x - this.width / 2.0) &&
                (x <= this.x + this.width / 2.0) &&
                (y >= this.y - this.height / 2.0) &&
                (y <= this.y + this.height / 2.0);
        } else {                 // Box-element intersection
            return (x <= this.x + this.width / 2.0) &&
                (x + w >= this.x - this.width / 2.0) &&
                (y <= this.y + this.height / 2.0) &&
                (y + h >= this.y - this.height / 2.0);
        }
    }

    public contained_in(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        if (w === 0 || h === 0)
            return false;

        const box_start_x = x;
        const box_end_x = x + w;
        const box_start_y = y;
        const box_end_y = y + h;

        const el_start_x = this.x - (this.width / 2.0);
        const el_end_x = this.x + (this.width / 2.0);
        const el_start_y = this.y - (this.height / 2.0);
        const el_end_y = this.y + (this.height / 2.0);

        return box_start_x <= el_start_x &&
            box_end_x >= el_end_x &&
            box_start_y <= el_start_y &&
            box_end_y >= el_end_y;
    }

}

export class TimelineGraph extends TimelineViewElement {

    public readonly xAxis: ChartAxis;
    public readonly yAxis: ChartAxis;

    private readonly nEvents: number;
    private readonly maxFootprint: number;

    private readonly elements: TimelineViewElement[];

    public constructor(timeline: MemoryEvent[]) {
        super();

        this.nEvents = 0;
        this.maxFootprint = 0;
        let currentFootprint = 0;
        const containerMap = new Map();
        for (const event of timeline) {
            if (event.type === 'DataAccessEvent') {
                this.nEvents++;
            } else if (event.type === 'AllocationEvent') {
                for (const data of (event as AllocationEvent).data) {
                    containerMap.set(data[0], data[1]);
                    currentFootprint += data[1];
                }
                if (currentFootprint > this.maxFootprint)
                    this.maxFootprint = currentFootprint;
            } else if (event.type === 'DeallocationEvent') {
                for (const data of (event as DeallocationEvent).data) {
                    currentFootprint -= containerMap.get(data);
                    containerMap.delete(data);
                }
            }
        }

        const maxHeight = 10000;
        let targetHeight = this.maxFootprint;
        const targetWidth = 10000;
        if (targetHeight > maxHeight)
            targetHeight = maxHeight;
        const scaleY = targetHeight / this.maxFootprint;
        const scaleX = targetWidth / this.nEvents;
        const blockLabelScale = Math.min(scaleY, scaleX);

        this.xAxis = new ChartAxis('horizontal', 0, this.nEvents, scaleX);
        this.yAxis = new ChartAxis('vertical', 0, this.maxFootprint, scaleY);

        this.height = this.yAxis.height;
        this.width = this.xAxis.width;
        this.x = 0;
        this.y = 0 - this.height;

        this.elements = [];

        let time = 0;
        let stackTop = 0;
        const elemMap = new Map<string, AllocatedContainer>();
        for (const event of timeline) {
            if (event.type === 'AllocationEvent') {
                for (const data of (event as AllocationEvent).data) {
                    const allocatedElem = new AllocatedContainer(
                        data[0], blockLabelScale
                    );
                    this.elements.push(allocatedElem);
                    allocatedElem.height = data[1] * scaleY;
                    stackTop -= allocatedElem.height;
                    allocatedElem.x = time * scaleX;
                    allocatedElem.y = stackTop;
                    elemMap.set(data[0], allocatedElem);
                }
            } else if (event.type === 'DeallocationEvent') {
                for (const data of (event as DeallocationEvent).data) {
                    const allocatedElem = elemMap.get(data)!;
                    allocatedElem.width = (time * scaleX) - allocatedElem.x;
                    stackTop += allocatedElem.height;
                    elemMap.delete(data);
                }
            } else {
                time++;
            }
        }
        for (const leftOverContainers of elemMap.keys()) {
            const allocElem = elemMap.get(leftOverContainers)!;
            allocElem.width = (time * scaleX) - allocElem.x;
        }
    }

    public draw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        this.xAxis.draw(renderer, ctx, mousepos);
        this.yAxis.draw(renderer, ctx, mousepos);

        for (const elem of this.elements)
            elem.draw(renderer, ctx, mousepos);
    }

}

export class ChartAxis extends TimelineViewElement {

    public constructor(
        public readonly direction: 'vertical' | 'horizontal',
        public readonly min: number = 0,
        public readonly max: number = 100,
        public readonly tickSpacing: number = 1,
    ) {
        super();

        const delta = this.max - this.min;
        const deltaPxs = delta * this.tickSpacing;
        this.x = 0;
        this.y = 0;
        if (this.direction === 'vertical') {
            this.width = 1;
            this.height = deltaPxs;
        } else {
            this.width = deltaPxs;
            this.height = 1;
        }
    }

    protected drawArrow(
        ctx: CanvasRenderingContext2D, p1: Point2D, p2: Point2D, size: number,
        offset: number = 0, padding: number = 0
    ): void {
        // Rotate the context to point along the path
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const rot = Math.atan2(dy, dx);
        ctx.translate(p2.x, p2.y);
        ctx.rotate(rot);

        // arrowhead
        ctx.beginPath();
        ctx.moveTo(0 + padding + offset, 0);
        ctx.lineTo(((-2 * size) - padding) - offset, -(size + padding));
        ctx.lineTo(((-2 * size) - padding) - offset, (size + padding));
        ctx.closePath();
        ctx.fill();

        // Restore context
        ctx.rotate(-rot);
        ctx.translate(-p2.x, -p2.y);
    }

    public draw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        ctx.moveTo(this.x, this.y);
        ctx.fillStyle = 'black';
        if (this.direction === 'vertical') {
            ctx.lineTo(this.x, -this.height);
            ctx.stroke();
            this.drawArrow(
                ctx, { x: this.x, y: this.y }, { x: this.x, y: -this.height },
                3
            );
        } else {
            ctx.lineTo(this.width, this.y);
            ctx.stroke();
            this.drawArrow(
                ctx, { x: this.x, y: this.y }, { x: this.width, y: this.y }, 3
            );
        }
    }

    public simpleDraw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        this.draw(renderer, ctx, mousepos);
    }

}

export class AllocatedContainer extends TimelineViewElement {

    public constructor(
        public readonly label: string,
        private readonly labelScale: number
    ) {
        super();
    }

    public draw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        const oldFont = ctx.font;
        const fontSize = 10 * this.labelScale;
        ctx.font = fontSize + 'px sans-serif';
        ctx.fillStyle = 'red';  
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.fillStyle = 'black';  
        ctx.fillText(this.label, this.x + 5, this.y + 5);
        ctx.font = oldFont;
    }

}
