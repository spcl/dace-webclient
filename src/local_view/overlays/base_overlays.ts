// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { LViewRenderer } from '../lview_renderer';

export abstract class BaseOverlay {

    public constructor(
        public readonly renderer: LViewRenderer,
    ) {
    }

    public abstract onSelect(): void;
    public abstract onDeselect(): void;

    public abstract readonly value: string;
    public abstract readonly displayName: string;

}

export abstract class NodeOverlay extends BaseOverlay {

    public static availableOverlays: string[] = [];
    public static overlayMap: Map<string, NodeOverlay> = new Map();

}

export abstract class EdgeOverlay extends BaseOverlay {

    public static availableOverlays: string[] = [];
    public static overlayMap: Map<string, EdgeOverlay> = new Map();

}

export class NoNodeOverlay extends NodeOverlay {

    public readonly value = 'none';
    public readonly displayName = 'None';

    public onSelect(): void {
        this.renderer.hideNodeViewModeSelectorAdditional();
    }

    public onDeselect(): void {
        return;
    }

}

export class NoEdgeOverlay extends EdgeOverlay {

    public readonly value = 'none';
    public readonly displayName = 'None';

    public onSelect(): void {
        this.renderer.hideEdgeViewModeSelectorAdditional();
    }

    public onDeselect(): void {
        return;
    }

}
