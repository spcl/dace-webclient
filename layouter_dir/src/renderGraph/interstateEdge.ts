import RenderEdge from "./renderEdge";

export default class InterstateEdge extends RenderEdge {
    label(): string {
        return this.attributes.label || "";
    }
}
