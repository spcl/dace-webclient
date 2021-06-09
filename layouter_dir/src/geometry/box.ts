import {EPSILON} from "../util/constants";
import Size from "./size";
import Vector from "./vector";

export default class Box {
    public x: number;
    public y: number;
    public width: number;
    public height: number;

    constructor(x: number = 0, y: number = 0, width: number = 0, height: number = 0, centerCoords: boolean = false) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        if (centerCoords) {
            this.x -= width / 2;
            this.y -= height / 2;
        }
    }

    topLeft(): Vector {
        return new Vector(this.x, this.y);
    }

    topRight(): Vector {
        return new Vector(this.x + this.width, this.y);
    }

    center(): Vector {
        return new Vector(this.x + this.width / 2, this.y + this.height / 2);
    }

    topCenter(): Vector {
        return new Vector(this.x + this.width / 2, this.y);
    }

    bottomLeft(): Vector {
        return new Vector(this.x, this.y + this.height);
    }

    bottomRight(): Vector {
        return new Vector(this.x + this.width, this.y + this.height);
    }

    bottomCenter(): Vector {
        return new Vector(this.x + this.width / 2, this.y + this.height);
    }

    left(): number {
        return this.x;
    }

    right(): number {
        return this.x + this.width;
    }

    size(): Size {
        return {
            width: this.width,
            height: this.height,
        };
    }

    centerIn(surroundingBox: Box): Box {
        this.x += (surroundingBox.width - this.width) / 2;
        this.y += (surroundingBox.height - this.height) / 2;
        return this;
    }

    intersects(otherBox: Box): boolean {
        return (this.x + EPSILON < otherBox.x + otherBox.width)
            && (this.x + this.width > otherBox.x + EPSILON)
            && (this.y + EPSILON < otherBox.y + otherBox.height)
            && (this.y + this.height > otherBox.y + EPSILON);
    }

    containedIn(otherBox: Box): boolean {
        return (this.x + EPSILON >= otherBox.x)
            && (this.y + EPSILON >= otherBox.y)
            && (this.x + this.width <= otherBox.x + otherBox.width + EPSILON)
            && (this.y + this.height <= otherBox.y + otherBox.height + EPSILON);
    }
}