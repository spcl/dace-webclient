import { Graphics } from '@pixi/graphics';

export class GUIComponent extends Graphics {

    protected constructor() {
        super();
    }

    protected draw(): void {
        this.clear();
    }

}
