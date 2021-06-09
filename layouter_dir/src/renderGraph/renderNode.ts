import {CONNECTOR_SIZE, CONNECTOR_SPACING} from "../util/constants";
import * as _ from "lodash";
import Box from "../geometry/box";
import LayoutGraph from "../layoutGraph/layoutGraph";
import LayoutNode from "../layoutGraph/layoutNode";
import Node from "../graph/node";
import RenderConnector from "./renderConnector";
import RenderEdge from "./renderEdge";
import RenderGraph from "./renderGraph";
import Size from "../geometry/size";

export default abstract class RenderNode extends Node<RenderGraph, RenderEdge> {
    public readonly childPadding: number = 0;
    public readonly labelPaddingX: number = 10;
    public readonly labelPaddingY: number = 10;
    public readonly labelFontSize: number = 12;
    public readonly connectorPadding: number = 10;

    public id: number = null;
    public graph: RenderGraph = null;
    public inConnectors: Array<RenderConnector> = [];
    public outConnectors: Array<RenderConnector> = [];
    public scopeEntry: number = null;

    public layoutGraph: LayoutGraph = null;
    public layoutNode: LayoutNode = null;

    public x: number = null;
    public y: number = null;
    public width: number = 0;
    public height: number = 0;

    public color: number;

    protected _type: string = null;

    constructor(type: string, label: string = "", color: number = 0x000000) {
        super(label);
        this._type = type;
        this.color = color;
    }

    type(): string {
        return this._type
    }

    updateSize(minimumSize: Size): void {
        this.width = Math.max(this.width, minimumSize.width);
        this.height = Math.max(this.height, minimumSize.height);
    }

    setConnectors(inConnectors: Array<string>, outConnectors: Array<string>): void {
        _.forEach(inConnectors, (name: string) => {
            this.inConnectors.push(new RenderConnector(name.toString(), this));
        });
        _.forEach(outConnectors, (name: string) => {
            this.outConnectors.push(new RenderConnector(name.toString(), this));
        });

        // update width
        this.width = Math.max(this.width, this.connectorsWidth());
    }

    size(): Size {
        return {
            width: this.width,
            height: this.height,
        };
    }

    boundingBox(): Box {
        return new Box(this.x, this.y, this.width, this.height);
    }

    /**
     * Calculates the width to fit both the in-connectors and out-connectors including some padding.
     */
    connectorsWidth(): number {
        const numConnectors = Math.max(this.inConnectors.length, this.outConnectors.length);
        return numConnectors * (CONNECTOR_SIZE + CONNECTOR_SPACING) - CONNECTOR_SPACING + 2 * this.connectorPadding;
    }
}
