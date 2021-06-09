import {CONNECTOR_SIZE} from "../util/constants";
import * as _ from "lodash";
import Box from "../geometry/box";
import LayoutNode from "./layoutNode";
import Size from "../geometry/size";
import Vector from "../geometry/vector";

export default class LayoutConnector {
    public readonly node: LayoutNode;
    public readonly type: "IN" | "OUT";
    public readonly name: string;

    public isScoped: boolean = false;
    public counterpart: LayoutConnector = null;

    // position is relative to node
    public x: number = null;
    public y: number = null;
    public readonly width: number = 0;
    public readonly height: number = 0;
    public readonly isTemporary: boolean;

    constructor(node: LayoutNode, type: "IN" | "OUT", name: string, temporary: boolean) {
        this.node = node;
        this.type = type;
        this.name = name;
        if (!temporary) {
            this.width = CONNECTOR_SIZE;
            this.height = CONNECTOR_SIZE;
        }
        this.isTemporary = temporary;
        if (name === null) {
            return;
        }
        const counterpartType = (type === "IN" ? "OUT" : "IN");
        if (name.startsWith(type + "_")) {
            const matchingConnectorIndex = _.map(node[counterpartType.toLowerCase() + "Connectors"], "name").indexOf(counterpartType + "_" + name.substr(type.length + 1));
            if (matchingConnectorIndex > -1) {
                this.isScoped = true;
                this.counterpart = node[counterpartType.toLowerCase() + "Connectors"][matchingConnectorIndex];
                this.counterpart.isScoped = true;
                this.counterpart.counterpart = this;
                this.node.hasScopedConnectors = true;
            }
        }
    }

    position(): Vector {
        return new Vector(this.x, this.y);
    }

    size(): Size {
        return {
            width: this.width,
            height: this.height,
        }
    }

    boundingBox(): Box {
        return new Box(this.x, this.y, this.width, this.height);
    }

    setPosition(x: number, y: number): void {
        this.x = x;
        this.y = y;
    }

    translate(x: number, y: number): void {
        this.x += x;
        this.y += y;
    }
}
