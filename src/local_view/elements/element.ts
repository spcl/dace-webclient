import { Graphics, TextStyle } from 'pixi.js';

export const DEFAULT_LINE_STYLE: any = {
    color: 0x000000,
    width: 1,
};

export const DEFAULT_TEXT_STYLE: TextStyle = new TextStyle({
    fontFamily: 'Montserrat',
    fontSize: 30,
});

export class Element extends Graphics {

    constructor() {
        super();
    }

    public draw(): void {
        this.clear();
    }

    public get unscaledWidth(): number {
        return this.width;
    }

    public get unscaledHeight(): number {
        return this.height;
    }

}
