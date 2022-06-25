import { Graphics } from 'pixi.js';

export class GUIComponent extends Graphics {

    protected constructor() {
        super();
    }

    protected draw(): void {
        this.clear();
    }

}
