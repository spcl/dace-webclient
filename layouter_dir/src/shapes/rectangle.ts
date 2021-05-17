import {Container, Graphics} from "pixi.js";
import Color from "../renderer/color";
import SimpleShape from "./simpleShape";

export default class Rectangle extends SimpleShape {
    zIndex = null;

    private readonly _backgroundColor: Color;
    private readonly _borderColor: Color;

    constructor(reference: object, x: number, y: number, width: number, height: number, backgroundColor = new Color(255, 255, 255), borderColor = new Color(0, 0, 0)) {
        super(reference, x, y, width, height);
        this._backgroundColor = backgroundColor;
        this._borderColor = borderColor;
    }

    render(container: Container): void {
        const rectangle = new Graphics();
        rectangle.lineStyle(1, this._borderColor.hex(), this._borderColor.alpha);
        rectangle.beginFill(this._backgroundColor.hex(), this._backgroundColor.alpha);
        rectangle.drawRect(0, 0, this._width, this._height);
        rectangle.endFill();
        rectangle.x = this._x;
        rectangle.y = this._y;
        if (this.zIndex !== null) {
            rectangle.zIndex = this.zIndex;
        }
        container.addChild(rectangle);
    }
}