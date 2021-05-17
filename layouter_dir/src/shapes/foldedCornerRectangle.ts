import * as PIXI from "pixi.js";
import SimpleShape from "./simpleShape";

export default class FoldedCornerRectangle extends SimpleShape {
    private readonly _backgroundColor: number;
    private readonly _borderColor: number;

    constructor(reference: object, x: number, y: number, width: number, height: number, backgroundColor = 0xFFFFFF, borderColor = 0x000000) {
        super(reference, x, y, width, height);
        this._backgroundColor = backgroundColor;
        this._borderColor = borderColor;
    }

    render(container: PIXI.Container): void {
        const cornerLength = this._height / 6;

        const rectangle = new PIXI.Graphics();
        rectangle.lineStyle(1, this._borderColor, 1);
        rectangle.beginFill(this._backgroundColor);
        rectangle.drawPolygon([
            this._x, this._y,
            this._x, this._y + this._height,
            this._x + this._width, this._y + this._height,
            this._x + this._width, this._y + cornerLength,
            this._x + this._width - cornerLength, this._y,
        ]);
        rectangle.endFill();
        container.addChild(rectangle);

        const triangle = new PIXI.Graphics();
        triangle.lineStyle(1, this._borderColor, 1);
        triangle.beginFill(this._backgroundColor);
        triangle.drawPolygon([
            this._x + this._width - cornerLength, this._y,
            this._x + this._width - cornerLength, this._y + cornerLength,
            this._x + this._width, this._y + cornerLength,
        ]);
        triangle.endFill();
        container.addChild(triangle);
    }
}
