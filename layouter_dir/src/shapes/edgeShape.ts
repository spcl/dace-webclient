import * as _ from "lodash";
import {Graphics} from "pixi.js";
import Box from "../geometry/box";
import Color from "../renderer/color";
import Vector from "../geometry/vector";
import Shape from "./shape";

export default class EdgeShape extends Shape {
    private _points: Array<Vector>;
    private _color: Color;

    constructor(reference: object, points: Array<Vector>, color: Color = new Color(0, 0, 0)) {
        super(reference, 0, 0);
        this._points = _.cloneDeep(points);
        this._color = color;
    }

    boundingBox(): Box {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        _.forEach(this._points, (point: Vector) => {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        });
        return new Box(minX, minY, maxX - minX, maxY - minY);
    }

    render(container: PIXI.Container): void {
        let line = new Graphics();
        line.lineStyle(1, this._color.hex(), this._color.alpha);
        line.moveTo(_.head(this._points).x, _.head(this._points).y);
        _.forEach(_.tail(this._points), (point: Vector) => {
            line.lineTo(point.x, point.y);
        });
        // draw arrow head
        const end = new Vector(_.last(this._points).x, _.last(this._points).y);
        const dir = end.clone().sub(this._points[this._points.length - 2]);
        const angle = dir.angle();
        const point1 = (new Vector(end.x - 5, end.y + 3)).rotateAround(end, angle);
        line.lineTo(point1.x, point1.y);
        line.moveTo(end.x, end.y);
        const point2 = (new Vector(end.x - 5, end.y - 3)).rotateAround(end, angle);
        line.lineTo(point2.x, point2.y);
        line.zIndex = -1;
        container.addChild(line);
    }

    clone(): Shape {
        const clone = <EdgeShape>super.clone();
        clone.clear();
        _.forEach(this._points, (point) => {
            clone.addPoint(_.clone(point));
        });
        return clone;
    }

    clear(): void {
        this._points = [];
    }

    addPoint(point: Vector): void {
        this._points.push(_.clone(point));
    }

    points(): Array<Vector> {
        return _.cloneDeep(this._points);
    }

    offset(x: number, y: number): void {
        _.forEach(this._points, (point: Vector) => {
            point.x += x;
            point.y += y;
        });
    }
}
