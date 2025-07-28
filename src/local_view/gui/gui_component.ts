// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { Graphics } from 'pixi.js';

export class GUIComponent extends Graphics {

    protected constructor() {
        super();
    }

    protected draw(): void {
        this.clear();
    }

}
