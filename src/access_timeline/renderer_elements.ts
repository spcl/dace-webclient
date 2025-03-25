import { DataSubset, Point2D } from '../types';
import { bytesToString, sdfg_range_elem_to_string } from '../utils/sdfg/display';
import { SDFVSettings } from '../utils/sdfv_settings';
import { KELLY_COLORS } from '../utils/utils';
import {
    AllocationEvent,
    DataAccessEvent,
    DeallocationEvent,
    MemoryEvent,
    MemoryTimelineScope,
    TimelineView,
} from './access_timeline';


export type TimelineViewElementClasses = 'container' | 'access' | 'axes';

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
        _mousepos?: Point2D, _realMousepos?: Point2D
    ): void {
        return;
    }

    public simpleDraw(
        _renderer: TimelineView, _ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D, _realMousepos?: Point2D
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
            return (x >= this.x) && (x <= this.x + this.width) &&
                (y >= this.y) && (y <= this.y + this.height);
        } else {                 // Box-element intersection
            return (x <= this.x) && (x + w >= this.x - this.width) &&
                (y <= this.y) && (y + h >= this.y - this.height);
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

export class TimelineChart extends TimelineViewElement {

    public readonly xAxis: ChartAxis;
    public readonly yAxis: ChartAxis;

    public readonly nEvents: number;
    public readonly maxFootprint: number;

    public readonly containers: AllocatedContainer[];
    public readonly readAccesses: ContainerAccess[];
    public readonly writeAccesses: ContainerAccess[];
    public readonly scopes: ScopeElement[];

    public readonly scaleX: number;
    public readonly scaleY: number;

    public readonly renderer: TimelineView;

    public readonly deferredDrawCalls: Set<(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ) => void> = new Set();

    public constructor(
        timeline: MemoryEvent[], rootScope: MemoryTimelineScope,
        renderer: TimelineView
    ) {
        super();

        this.renderer = renderer;

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
        this.scaleY = targetHeight / this.maxFootprint;
        this.scaleX = targetWidth / this.nEvents;
        const blockLabelScale = Math.min(this.scaleY, this.scaleX);

        this.xAxis = new ChartAxis('horizontal', 0, this.nEvents, this.scaleX);
        this.yAxis = new ChartAxis(
            'vertical', 0, this.maxFootprint, this.scaleY
        );

        this.containers = [];
        this.readAccesses = [];
        this.writeAccesses = [];

        let time = 0;
        let stackTop = 0;
        const elemMap = new Map<string, AllocatedContainer>();
        let colorIdx = 0;
        const maxColorIdx = KELLY_COLORS.length;
        for (const event of timeline) {
            if (event.type === 'AllocationEvent') {
                for (const data of (event as AllocationEvent).data) {
                    let cleanName = data[0];
                    const sdfgIdString = cleanName.match(/^\d+/)?.[0];
                    const sdfgId = sdfgIdString ? parseInt(sdfgIdString) : 0;
                    cleanName = cleanName.replace(
                        /^(\d*___state->__)?\d+_/g, ''
                    );
                    const label = (
                        cleanName + ' (' + bytesToString(data[1]) + ')'
                    );
                    const allocatedElem = new AllocatedContainer(
                        label, blockLabelScale,
                        '#' + KELLY_COLORS[colorIdx].toString(16),
                        this, (event as AllocationEvent).conditional,
                        cleanName, sdfgId
                    );
                    allocatedElem.allocatedAt = time;
                    this.containers.push(allocatedElem);
                    allocatedElem.height = data[1] * this.scaleY;
                    stackTop -= allocatedElem.height;
                    allocatedElem.x = time * this.scaleX;
                    allocatedElem.y = stackTop;
                    elemMap.set(data[0], allocatedElem);

                    colorIdx++;
                    if (colorIdx >= maxColorIdx)
                        colorIdx = 0;
                }
            } else if (event.type === 'DeallocationEvent') {
                for (const data of (event as DeallocationEvent).data) {
                    const allocatedElem = elemMap.get(data)!;
                    allocatedElem.width = (
                        time * this.scaleX
                    ) - allocatedElem.x;
                    allocatedElem.deallocatedAt = time;
                    stackTop += allocatedElem.height;
                    elemMap.delete(data);
                }
            } else {
                const accessEvent = event as DataAccessEvent;
                const allocatedElem = elemMap.get(accessEvent.alloc_name)!;
                const accessElem = new ContainerAccess(
                    accessEvent.mode, accessEvent.subset, time, this.scaleX,
                    allocatedElem, accessEvent.conditional
                );
                if (accessEvent.mode === 'read')
                    this.readAccesses.push(accessElem);
                else
                    this.writeAccesses.push(accessElem);
                time++;
            }
        }
        for (const leftOverContainers of elemMap.keys()) {
            const allocElem = elemMap.get(leftOverContainers)!;
            allocElem.width = (time * this.scaleX) - allocElem.x;
            allocElem.deallocatedAt = time;
        }

        this.scopes = this.collectScopes(rootScope, 0);

        this.height = this.yAxis.height;
        this.width = this.xAxis.width;
        this.x = 0;
        this.y = 0 - this.height;
        let maxY = 0;
        for (const scope of this.scopes) {
            let scopeMaxY = scope.y + scope.height;
            if (scopeMaxY > maxY)
                maxY = scopeMaxY;
        }
        this.height = maxY - this.y;

        this.calculateMetrics();
    }

    private calculateMetrics(): void {
        for (const container of this.containers)
            container.calculateReuse();
    }

    private collectScopes(
        scope: MemoryTimelineScope, depth: number
    ): ScopeElement[] {
        const elements = [new ScopeElement(
            scope.label, depth, scope.start_time, scope.end_time, this
        )];
        for (const child of scope.children) {
            for (const nElem of this.collectScopes(child, depth + 1))
                elements.push(nElem);
        }
        return elements;
    }

    public draw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        for (const elem of this.containers)
            elem.draw(renderer, ctx, mousepos, realMousepos);

        // Batch access drawing.
        const deferredEdges = [];
        ctx.beginPath();
        ctx.setLineDash([1, 1]);
        for (const access of this.readAccesses) {
            if (access.hovered) {
                deferredEdges.push(access);
                continue;
            }
            ctx.moveTo(access.x, access.y);
            ctx.lineTo(access.x, access.y + access.height)
        }
        ctx.strokeStyle = 'blue';
        ctx.fillStyle = 'blue';
        ctx.stroke();

        ctx.beginPath();
        if ((ctx as any).pdf)
            ctx.setLineDash([1, 0]);
        else
            ctx.setLineDash([]);
        for (const access of this.writeAccesses) {
            if (access.hovered) {
                deferredEdges.push(access);
                continue;
            }
            ctx.moveTo(access.x, access.y);
            ctx.lineTo(access.x, access.y + access.height);
        }
        ctx.strokeStyle = 'black';
        ctx.fillStyle = 'black';
        ctx.stroke();

        for (const deferred of deferredEdges)
            deferred.draw(renderer, ctx, mousepos, realMousepos);

        this.drawDeferred(renderer, ctx, mousepos);

        this.xAxis.draw(renderer, ctx, mousepos);
        this.yAxis.draw(renderer, ctx, mousepos);

        for (const scope of this.scopes)
            scope.draw(renderer, ctx, mousepos, realMousepos);
    }

    public drawDeferred(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        for (const deferredCall of this.deferredDrawCalls)
            deferredCall(renderer, ctx, mousepos);
        this.deferredDrawCalls.clear();
    }

    public get axes(): ChartAxis[] {
        return [this.xAxis, this.yAxis];
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
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        ctx.beginPath();
        if ((ctx as any).pdf)
            ctx.setLineDash([1, 0]);
        else
            ctx.setLineDash([]);
        ctx.moveTo(this.x, this.y);
        if (this.direction === 'vertical') {
            ctx.lineTo(this.x, -this.height);
            ctx.strokeStyle = 'black';
            ctx.fillStyle = 'black';
            ctx.stroke();
            this.drawArrow(
                ctx, { x: this.x, y: this.y }, { x: this.x, y: -this.height },
                3
            );
        } else {
            ctx.lineTo(this.width, this.y);
            ctx.strokeStyle = 'black';
            ctx.fillStyle = 'black';
            ctx.stroke();
            this.drawArrow(
                ctx, { x: this.x, y: this.y }, { x: this.width, y: this.y }, 3
            );
        }
    }

    public simpleDraw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        this.draw(renderer, ctx, mousepos);
    }

}

export class ContainerAccess extends TimelineViewElement {

    public constructor(
        public readonly mode: 'read' | 'write',
        public readonly subset: DataSubset,
        public readonly timestep: number,
        public readonly scaleX: number,
        public readonly container: AllocatedContainer,
        public readonly conditional: boolean,
    ) {
        super();

        this.x = timestep * scaleX;
        this.width = 1 * scaleX;
        this.y = container.y;
        this.height = container.height;

        this.container.registerAccess(this);
    }

    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        // First, check bounding box
        if (!super.intersect(x, y, w, h))
            return false;

        // Then (if point), check distance from line
        if (w === 0 || h === 0) {
            const dist = ptLineDistance(
                { x: x, y: y }, { x: this.x, y: this.y },
                { x: this.x, y: this.y + this.height }
            );
            if (dist <= 2 * this.scaleX)
                return true;
            return false;
        } else {
            // It is a rectangle. Check if any of the rectangles, spanned by
            // pairs of points of the line, intersect the input rectangle.
            // This is needed for long Interstate edges that have a huge
            // bounding box and intersect almost always with the viewport even
            // if they are not visible. This is only an approximation to detect
            // if a line is in the viewport and could be made more accurate at
            // the cost of more computation.
            const origin = { x: this.x, y: this.y };
            const destination = { x: this.x, y: this.y + this.height };
            // Rectangle spanned by the two line points
            const r = {
                x: Math.min(origin.x, destination.x),
                y: Math.min(origin.y, destination.y),
                w: Math.abs(destination.x - origin.x),
                h: Math.abs(destination.y - origin.y),
            };

            // Check if the two rectangles intersect
            if (r.x + r.w >= x && r.x <= x + w &&
                r.y + r.h >= y && r.y <= y + h)
                return true;
            return false;
        }
    }

    public draw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        if (this.mode == 'read') {
            ctx.beginPath();
            ctx.setLineDash([1, 1]);
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x, this.y + this.height)
            ctx.strokeStyle = this.hovered ? 'red' : 'blue';
            ctx.fillStyle = 'blue';
            ctx.stroke();
        } else {
            ctx.beginPath();
            if ((ctx as any).pdf)
                ctx.setLineDash([1, 0]);
            else
                ctx.setLineDash([]);
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x, this.y + this.height);
            ctx.strokeStyle = this.hovered ? 'red' : 'black';
            ctx.fillStyle = 'black';
            ctx.stroke();
        }

        if (this.hovered === true) {
            if (realMousepos) {
                const settings = {
                    inclusive_ranges: SDFVSettings.get<boolean>(
                        'inclusiveRanges'
                    ),
                }
                let label = '[';
                for (const range of this.subset.ranges)
                    label += sdfg_range_elem_to_string(range, settings) + ', ';
                renderer.showTooltip(
                    realMousepos.x, realMousepos.y + 50,
                    label.slice(0, -2) + ']'
                );
            }
            /*
            this.chart.deferredDrawCalls.add((dRenderer, dCtx, dMousepos) => {
                dCtx.strokeStyle = 'black';
                dCtx.strokeRect(this.x, this.y, this.width, this.height);
            });
            */
        }
    }

}

export class AllocatedContainer extends TimelineViewElement {

    public allocatedAt: number = 0;
    public deallocatedAt: number = 0;

    private allocationTimespan: number = 0;
    private totalUseTimespan: number = 0;
    private reuseDistances: number[] = [];
    private tooltipText: string;

    public readonly accesses: ContainerAccess[] = [];

    private data?: any;

    private firstUseX?: number;
    private lastUseX?: number;

    public constructor(
        public readonly label: string,
        private readonly labelScale: number,
        private readonly color: string,
        private readonly chart: TimelineChart,
        private readonly conditional: boolean,
        private readonly dataName: string,
        private readonly sdfgId: number,
    ) {
        super();

        const sdfg = chart.renderer.sdfg_list.get(sdfgId);
        if (sdfg) {
            const parts = this.dataName.split('->');
            let data = undefined;
            let repository = sdfg.attributes._arrays;
            while (parts.length > 0 && repository) {
                const pivot = parts.shift()!;
                if (repository instanceof Array) {
                    for (const elem of repository) {
                        if (elem[0] === pivot) {
                            data = elem[1];
                            break;
                        }
                    }
                } else {
                    data = repository[pivot];
                }
                let attrs = data?.attributes;
                if (attrs && Object.hasOwn(attrs, 'members'))
                    repository = attrs['members'];
            }
            this.data = data;
        }

        this.tooltipText = this.label;
        if (this.data && this.data.type === 'Array' && this.data.attributes) {
            let shapeTxt = '[';
            for (const elem of this.data.attributes.shape)
                shapeTxt += elem.toString() + ', ';
            this.tooltipText += '\n' + shapeTxt.slice(0, -2) + ']';
        }
    }

    public registerAccess(access: ContainerAccess): void {
        this.accesses.push(access);
        if (this.firstUseX === undefined || access.x < this.firstUseX)
            this.firstUseX = access.x;
        if (this.lastUseX === undefined || access.x > this.lastUseX)
            this.lastUseX = access.x;
    }

    public draw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        ctx.fillStyle = this.color;  
        //if (this.conditional)
        //    ctx.globalAlpha = 0.2;
        let solidStartX = this.x
        let solidEndX = this.x + this.width;
        if (this.firstUseX !== undefined) {
            ctx.globalAlpha = 0.2;
            ctx.fillRect(this.x, this.y, this.firstUseX - this.x, this.height);
            solidStartX = this.firstUseX;
        }
        if (this.lastUseX !== undefined) {
            ctx.globalAlpha = 0.2;
            ctx.fillRect(
                this.lastUseX, this.y, (this.x + this.width) - this.lastUseX,
                this.height
            );
            solidEndX = this.lastUseX;
        }
        ctx.globalAlpha = 1.0;
        ctx.fillRect(solidStartX, this.y, solidEndX - solidStartX, this.height);

        if (this.hovered) {
            if (realMousepos) {
                renderer.showTooltip(
                    realMousepos.x, realMousepos.y + 50, this.tooltipText
                );
            }
            this.chart.deferredDrawCalls.add((dRenderer, dCtx, dMousepos) => {
                dCtx.strokeStyle = 'black';
                dCtx.strokeRect(this.x, this.y, this.width, this.height);
            });
        }
    }

    public calculateReuse(): void {
        let lastAccessAt = null;
        let firstAccessAt = null;
        for (const access of this.accesses) {
            if (firstAccessAt === null)
                firstAccessAt = access.timestep;
            if (lastAccessAt !== null)
                this.reuseDistances.push(access.timestep - lastAccessAt);
            lastAccessAt = access.timestep;
        }

        this.allocationTimespan = this.deallocatedAt - this.allocatedAt;
        if (firstAccessAt === null || lastAccessAt === null)
            this.totalUseTimespan = 0;
        else
            this.totalUseTimespan = lastAccessAt - firstAccessAt;

        const ratio = (this.totalUseTimespan / this.allocationTimespan) * 100;
        this.tooltipText += (
            '\nUse / Allocation time ratio: ' + ratio.toString() + '%'
        );
        if (this.reuseDistances.length) {
            const meanReuse = this.reuseDistances.reduce(
                (a, b) => a + b
            ) / this.reuseDistances.length;
            this.tooltipText += (
                '\nMean reuse distance: ' + meanReuse.toString()
            );
        } else {
            this.tooltipText += '\nNo reuse!';
        }
    }

}

export class ScopeElement extends TimelineViewElement {

    public constructor(
        public readonly label: string,
        depth: number, start: number, end: number, chart: TimelineChart
    ) {
        super();

        this.height = 50;
        this.y = (depth + 1) * this.height;
        this.x = start * chart.scaleX;
        this.width = (end * chart.scaleX) - this.x;
    }

    public draw(
        renderer: TimelineView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        if (this.label.startsWith('Loop'))
            ctx.fillStyle = 'red';
        else if (this.label.startsWith('Conditional'))
            ctx.fillStyle = 'blue';
        else
            ctx.fillStyle = 'gray';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        ctx.strokeStyle = 'black';
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        if (this.hovered) {
            if (realMousepos) {
                renderer.showTooltip(
                    realMousepos.x, realMousepos.y + 50, this.label
                );
            }
        }
    }

}

// Returns the distance from point p to line defined by two points
// (line1, line2)
function ptLineDistance(
    p: Point2D, line1: Point2D, line2: Point2D
): number {
    const dx = (line2.x - line1.x);
    const dy = (line2.y - line1.y);
    const res = dy * p.x - dx * p.y + line2.x * line1.y - line2.y * line1.x;

    return Math.abs(res) / Math.sqrt(dy * dy + dx * dx);
}
