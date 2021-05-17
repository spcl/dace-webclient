import * as PIXI from "pixi.js";
import SimpleShape from "./simpleShape";

export default class Ellipse extends SimpleShape {
    private readonly _backgroundColor: number;
    private readonly _borderColor: number;

    constructor(reference: object, x: number, y: number, width: number, height: number, backgroundColor: number = 0xFFFFFF, borderColor: number = 0x000000) {
        super(reference, x, y, width, height);
        this._backgroundColor = backgroundColor;
        this._borderColor = borderColor;
    }

    render(container: PIXI.Container): void {
        const ellipse = new PIXI.Graphics();
        ellipse.lineStyle(1, this._borderColor, 1);
        ellipse.beginFill(this._backgroundColor);
        const box = this.boundingBox();
        const center = box.center();
        ellipse.drawEllipse(center.x, center.y, this._width / 2, this._height / 2);
        ellipse.endFill();
        container.addChild(ellipse);
    }
}
