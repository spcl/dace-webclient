import { Graphics } from 'pixi.js';
import { JsonSDFGNode } from '../..';
import { Graph } from './graph';

export class Connector {

    public constructor() {
        return;
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

    public abstract shade(): void;

    protected loadAttributes(value: { attributes: any }): void {
        if (value.attributes) {
            for (const key in value.attributes)
                this.attributes.set(key, value.attributes[key]);
        }
    }

}

export class GraphNode extends GraphElement {

    public constructor(
        protected _id: number
    ) {
        super();
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

}

export class GraphEdge extends GraphElement {

    public constructor(
        protected _srcId: string,
        protected _dstId: string,
    ) {
        super();
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

    public get dstId(): string {
        return this._dstId;
    }

}

export abstract class ScopedNode extends GraphNode {

    public readonly scopedGraph: Graph = new Graph();

    private exitNode?: GraphNode;

    public collapsed: boolean = false;

    public constructor(id: number) {
        super(id);
        this.addChild(this.scopedGraph);
    }

    public draw(): void {
        super.draw();

        if (this.collapsed) {
            this.drawCollapsed();
        } else {
            this.drawExpanded();
            this.scopedGraph.draw();
        }
    }

    protected abstract drawExpanded(): void;
    protected abstract drawCollapsed(): void;

    public get exit(): GraphNode | undefined {
        return this.exitNode;
    }

    public set exit(exitNode: GraphNode | undefined) {
        this.exitNode = exitNode;
    }

    public get exitId(): number | undefined {
        return this.exitNode?.id;
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

            instance.loadAttributes(value.attributes);

            return instance;
        }

        return undefined;
    }

}
