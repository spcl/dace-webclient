// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { Graphics, TextStyle } from 'pixi.js';
import { LViewRenderer } from '../lview_renderer';

export const DEFAULT_LINE_STYLE: any = {
    color: 0x000000,
    width: 1,
};

export const DEFAULT_TEXT_STYLE: TextStyle = new TextStyle({
    fontFamily: 'Montserrat',
    fontSize: 30,
});

export class Element extends Graphics {

    constructor(public readonly renderer?: LViewRenderer) {
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
