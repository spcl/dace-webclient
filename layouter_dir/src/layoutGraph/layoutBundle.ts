import LayoutEdge from "./layoutEdge";
import Vector from "../geometry/vector";

export default class LayoutBundle {
    public connectors: Array<string> = [];
    public edges: Array<LayoutEdge> = [];
    public x;
    public y;

    addConnector(name: string): void {
        this.connectors.push(name);
    }

    position(): Vector {
        return new Vector(this.x, this.y);
    }
}
