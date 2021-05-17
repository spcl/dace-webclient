import * as _ from "lodash";
import Box from "./box";
import Vector from "./vector";

export default class Segment {
    readonly start: Vector;
    readonly end: Vector;

    constructor(start: Vector, end: Vector) {
        this.start = start;
        this.end = end;
    }

    toString(): string {
        return (this.start.toString() + " -> " + this.end.toString());
    }

    orientation(point: Vector): number {
        return Math.sign((this.end.y - this.start.y) * (point.x - this.end.x) - (this.end.x - this.start.x) * (point.y - this.end.y));
    }

    intersects(other: Segment): boolean {
        if (_.isEqual(this.start, other.start) || _.isEqual(this.end, other.end)) {
            return false;
        }
        if (!this.boundingBox().intersects(other.boundingBox())) {
            return false;
        }
        return (this.orientation(other.start) !== this.orientation(other.end) && other.orientation(this.start) !== other.orientation(this.end));
    }

    intersection(other: Segment): Vector {
        const thisVecInv = this.vector().invert();
        const otherVecInv = other.vector().invert();
        const t = ((this.start.x - other.start.x) * otherVecInv.y - (this.start.y - other.start.y) * otherVecInv.x) /
            (thisVecInv.x * otherVecInv.y - thisVecInv.y * otherVecInv.x);
        return this.start.clone().add(this.vector().multiplyScalar(t));
    }

    intersectsBox(box: Box): boolean {
        if (!this.boundingBox().intersects(box)) {
            return false;
        }
        const topLeftSide = this.orientation(box.topLeft());
        const topRightSide = this.orientation(box.topRight());
        const bottomLeftSide = this.orientation(box.bottomLeft());
        const bottomRightSide = this.orientation(box.bottomRight());
        const sameSide = (topLeftSide === topRightSide
            && topRightSide === bottomRightSide
            && bottomRightSide === bottomLeftSide);
        return !sameSide;
    }

    boundingBox(): Box {
        const minX = Math.min(this.start.x, this.end.x);
        const maxX = Math.max(this.start.x, this.end.x);
        const minY = Math.min(this.start.y, this.end.y);
        const maxY = Math.max(this.start.y, this.end.y);
        return new Box(minX, minY, maxX - minX, maxY - minY);
    }

    vector(): Vector {
        return new Vector(
            this.end.x - this.start.x,
            this.end.y - this.start.y,
        );
    }

    length(): number {
        return this.vector().length();
    }
}
