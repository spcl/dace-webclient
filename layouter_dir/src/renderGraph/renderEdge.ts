import * as _ from "lodash";
import Box from "../geometry/box";
import Edge from "../graph/edge";
import LayoutEdge from "../layoutGraph/layoutEdge";
import RenderGraph from "./renderGraph";
import RenderNode from "./renderNode";
import Size from "../geometry/size";
import Vector from "../geometry/vector";

export default abstract class RenderEdge extends Edge<RenderGraph, RenderNode> {
    public labelFontSize: number = 10;

    public srcConnector: string = null;
    public dstConnector: string = null;
    public attributes: any = {};

    public x: number = null;
    public y: number = null;
    public width: number = null;
    public height: number = null;

    public labelSize: Size = null;
    public labelX: number = null;
    public labelY: number = null;

    public points: Array<Vector> = [];

    public layoutEdge: LayoutEdge = null;

    constructor(src: number, dst: number, srcConnector: string = null, dstConnector: string = null, attributes: any = {}) {
        super(src, dst);
        this.srcConnector = srcConnector || null;
        this.dstConnector = dstConnector || null;
        this.attributes = attributes;
    }

    abstract label(): string;

    protected sdfgPropertyToString(property: any): string {
        if (property === null) {
            return "";
        }
        if (typeof property === "boolean") {
            return property ? "True" : "False";
        } else if (property.type === "Indices" || property.type === "subsets.Indices") {
            let indices = property.indices;
            let preview = '[';
            for (let index of indices) {
                preview += this.sdfgPropertyToString(index) + ', ';
            }
            return preview.slice(0, -2) + ']';
        } else if (property.type === "Range" || property.type === "subsets.Range") {
            let ranges = property.ranges;

            // Generate string from range
            let preview = '[';
            for (let range of ranges) {
                preview += this.sdfgRangeToString(range) + ', ';
            }
            return preview.slice(0, -2) + ']';
        } else if (property.language !== undefined) {
            // Code
            if (property.string_data !== '' && property.string_data !== undefined && property.string_data !== null) {
                return '<pre class="code"><code>' + property.string_data.trim() +
                    '</code></pre><div class="clearfix"></div>';
            }
            return '';
        } else if (property.approx !== undefined && property.main !== undefined) {
            // SymExpr
            return property.main;
        } else if (property.constructor == Object) {
            // General dictionary
            return '<pre class="code"><code>' + JSON.stringify(property, undefined, 4) +
                '</code></pre><div class="clearfix"></div>';
        } else if (property.constructor == Array) {
            // General array
            let result = '[ ';
            let first = true;
            for (let subprop of property) {
                if (!first)
                    result += ', ';
                result += this.sdfgPropertyToString(subprop);
                first = false;
            }
            return result + ' ]';
        } else {
            return property;
        }
    }

    protected sdfgRangeToString(range) {
        let preview = '';
        if (range.start == range.end && range.step == 1 && range.tile == 1) {
            preview += this.sdfgPropertyToString(range.start);
        } else {
            let endp1 = this.sdfgPropertyToString(range.end) + ' + 1';
            // Try to simplify using math.js
            preview += this.sdfgPropertyToString(range.start) + ':' + endp1;

            if (range.step != 1) {
                preview += ':' + this.sdfgPropertyToString(range.step);
                if (range.tile != 1)
                    preview += ':' + this.sdfgPropertyToString(range.tile);
            } else if (range.tile != 1) {
                preview += '::' + this.sdfgPropertyToString(range.tile);
            }
        }
        return preview;
    }

    updateBoundingBox(): void {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        _.forEach(this.points, (point: Vector) => {
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

    boundingBox(): Box {
        return new Box(this.x, this.y, this.width, this.height);
    }
};
