import { Graphics } from 'pixi.js';
import { JsonSDFGNode } from '../..';
import { Box2D, Vector2D } from '../../utils/geometry/primitives';
import { Graph } from './graph';

export class Connector extends Graphics {

    public constructor(
        public readonly name: string,
        public readonly val: any = null,
    ) {
        super();
    }

}

export abstract class GraphElement extends Graphics {

    public readonly attributes: Map<string, any> = new Map();

    public constructor() {
        super();
    }

    public draw(): void {
        this.clear();
    }

    public abstract type(): string;

    public abstract shade(): void;

    protected loadAttributes(value: { attributes: any }): void {
        if (value.attributes) {
            for (const key in value.attributes)
                this.attributes.set(key, value.attributes[key]);
        }
    }

    public boundingBox(): Box2D {
        return new Box2D(this.x, this.y, this.width, this.height);
    }

}

export class GraphNode extends GraphElement {

    public readonly inConnectors: Connector[] = [];
    public readonly outConnectors: Connector[] = [];

    public readonly childPadding: number = 10;
    public readonly connectorPadding: number = 10;

    public layoutNode: any = null;
    public layoutGraph: any = null;

    public constructor(
        protected _id: number
    ) {
        super();
    }

    public type(): string {
        return 'GraphNode';
    }

    public get id(): number {
        return this._id;
    }

    public draw(): void {
        super.draw();
    }

    public shade(): void {
        return;
    }
    
    public size(): {
        width: number,
        height: number,
    } {
        return {
            width: this.width,
            height: this.height,
        };
    }

    public get childGraph(): Graph | undefined {
        return undefined;
    }

    public getSizingString(depth: number = 0): string {
        console.log(this.layoutNode);
        
        const depthStr = '--'.repeat(depth);
        let str = depthStr + ' ' + this.type() + '(' + this.name + '): { x:' +
            this.x.toString() +
            ', y: ' +
            this.y.toString() +
            ', width: ' +
            this.width.toString() +
            ', height: ' +
            this.height.toString() +
            ' }\n';
            if (this.childGraph)
                this.childGraph.nodes().forEach(node => {
                    str += node.getSizingString(depth + 1);
                });
        return str;
    }

}

export class GraphEdge extends GraphElement {

    private _points: Vector2D[] = [];
    private _labelX: number = 0;
    private _labelY: number = 0;

    public layoutEdge: any = null;

    public constructor(
        protected _srcId: string,
        protected _dstId: string,
        protected _srcConnector: string | null = null,
        protected _dstConnector: string | null = null,
    ) {
        super();
    }

    public type(): string {
        return 'GraphEdge';
    }

    public draw(): void {
        super.draw();
    }

    public shade(): void {
        return;
    }

    public get srcId(): string {
        return this._srcId;
    }

    public get src(): number {
        return parseInt(this.srcId);
    }

    public get dstId(): string {
        return this._dstId;
    }

    public get dst(): number {
        return parseInt(this.dstId);
    }

    public get srcConnector(): string | null {
        return this._srcConnector;
    }

    public set srcConnector(connector: string | null) {
        this._srcConnector = connector;
    }

    public get dstConnector(): string | null {
        return this._dstConnector;
    }

    public set dstConnector(connector: string | null) {
        this._dstConnector = connector;
    }

    public get labelX(): number {
        return this._labelX;
    }

    public set labelX(x: number) {
        this._labelX = x;
    }

    public get labelY(): number {
        return this._labelY;
    }

    public set labelY(y: number) {
        this._labelY = y;
    }

    public get points(): Vector2D[] {
        return this._points;
    }

    public set points(points: Vector2D[]) {
        this._points = points;
    }
    
    public updateBoundingBox(): void {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        this.points.forEach(point => {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        });
        this.x = minX;
        this.y = minY;
        this.width = maxX - minX;
        this.height = maxY - minY;
    }

}

export abstract class ScopedNode extends GraphNode {

    public readonly scopedGraph: Graph = new Graph();

    public readonly innerInConnectors: Connector[] = [];
    public readonly innerOutConnectors: Connector[] = [];

    private exitNode?: GraphNode;

    public collapsed: boolean = false;

    public constructor(id: number) {
        super(id);
        this.addChild(this.scopedGraph);
    }

    public draw(recurseSubgraph: boolean = true): void {
        super.draw();

        if (this.collapsed) {
            this.drawCollapsed();
        } else {
            this.drawExpanded();
            if (recurseSubgraph)
                this.scopedGraph.draw();
        }
    }

    protected loadInConnectors(): void {
        const attrInConnectors = this.attributes.get('in_connectors');
        if (attrInConnectors) {
            Object.keys(attrInConnectors).forEach(key => {
                const nConnector = new Connector(
                    key, attrInConnectors[key]
                );
                this.inConnectors.push(nConnector);
            });
        }

        const attrOutConnectors = this.attributes.get('out_connectors');
        if (attrOutConnectors) {
            Object.keys(attrOutConnectors).forEach(key => {
                const nConnector = new Connector(
                    key, attrOutConnectors[key]
                );
                this.innerInConnectors.push(nConnector);
            });
        }
    }

    protected abstract drawExpanded(): void;
    protected abstract drawCollapsed(): void;

    public get exit(): GraphNode | undefined {
        return this.exitNode;
    }

    public set exit(exitNode: GraphNode | undefined) {
        this.exitNode = exitNode;

        const attrInConnectors = this.exitNode?.attributes.get('in_connectors');
        if (attrInConnectors) {
            Object.keys(attrInConnectors).forEach(key => {
                const nConnector = new Connector(
                    key, attrInConnectors[key]
                );
                this.innerOutConnectors.push(nConnector);
            });
        }

        const attrOutConnectors =
            this.exitNode?.attributes.get('out_connectors');
        if (attrOutConnectors) {
            Object.keys(attrOutConnectors).forEach(key => {
                const nConnector = new Connector(
                    key, attrOutConnectors[key]
                );
                this.outConnectors.push(nConnector);
            });
        }
    }

    public get exitId(): number | undefined {
        return this.exitNode?.id;
    }

    public get childGraph(): Graph {
        return this.scopedGraph;
    }

}

export class ScopeExitNode extends GraphNode {

    public constructor(id: number) {
        super(id);
    }

    public draw(): void {
        return;
    }

    public static fromJSON(value: JsonSDFGNode): ScopeExitNode | undefined {
        if (value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);

            return instance;
        }

        return undefined;
    }

}
