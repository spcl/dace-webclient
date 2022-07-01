// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import { NodeOverlay } from './base_overlays';

export class AccessPatternOverlay extends NodeOverlay {

    public readonly value = 'access-pattern';
    public readonly displayName = 'Access Pattern / Number of Accesses';

    public onSelect(): void {
        this.renderer.hideNodeViewModeSelectorAdditional();

        const container = $('<div>', {
            id: 'access-pattern-button-box',
        });
        $('<div>', {
            id: 'clear-all-access-pattern-button',
            class: 'button',
            text: 'Clear All',
            click: () => {
                if (this.renderer.graph)
                    this.renderer.clearGraphAccesses(this.renderer.graph);
            },
        }).appendTo(container);
        $('<div>', {
            id: 'show-all-access-pattern-button',
            class: 'button',
            text: 'Show All Accesses',
            click: () => {
                if (this.renderer.graph) {
                    this.renderer.clearGraphAccesses(this.renderer.graph);
                    this.renderer.graphShowAllAccesses(this.renderer.graph);
                }
            },
        }).appendTo(container);

        this.renderer.nodeOverlayAdditional?.append(container);
        this.renderer.nodeOverlayAdditional?.show();
    }

    public onDeselect(): void {
        if (this.renderer.graph)
            this.renderer.clearGraphAccesses(this.renderer.graph);
    }

}
