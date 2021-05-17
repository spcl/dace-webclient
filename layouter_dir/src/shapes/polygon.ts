import * as PIXI from "pixi.js";
import SimpleShape from "./simpleShape";

export default abstract class Polygon extends SimpleShape {
    private readonly _backgroundColor: number;
    private readonly _borderColor: number;

    constructor(reference: object, x: number, y: number, width: number, height: number, backgroundColor: number = 0xFFFFFF, borderColor: number = 0x000000) {
        super(reference, x, y, width, height);
        this._backgroundColor = backgroundColor;
        this._borderColor = borderColor;
    }

    abstract getPath(): Array<number>;

    render(container: PIXI.Container): void {
        const polygon = new PIXI.Graphics();
        polygon.lineStyle(1, this._borderColor, 1);
        polygon.beginFill(this._backgroundColor);
        polygon.drawPolygon(this.getPath());
        polygon.endFill();
        container.addChild(polygon);
    }
}
