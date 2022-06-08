import { Graphics } from '@pixi/graphics';
import { TextStyle } from '@pixi/text';

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

}
