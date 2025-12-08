// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type { LViewRenderer } from '../lview_renderer';

export abstract class BaseOverlay {

    public constructor(
        public readonly renderer: LViewRenderer
    ) {
    }

    public abstract onSelect(): void;
    public abstract onDeselect(): void;

    public abstract readonly value: string;
    public abstract readonly displayName: string;

}

export abstract class NodeOverlay extends BaseOverlay {

    public static availableOverlays: string[] = [];
    public static overlayMap = new Map<string, NodeOverlay>();

}

export abstract class EdgeOverlay extends BaseOverlay {

    public static availableOverlays: string[] = [];
    public static overlayMap = new Map<string, EdgeOverlay>();

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
