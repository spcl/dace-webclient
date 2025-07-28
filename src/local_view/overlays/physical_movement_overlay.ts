// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { EdgeOverlay } from './base_overlays';

export class PhysicalMovementOverlay extends EdgeOverlay {

    public readonly value = 'physical-data-movement';
    public readonly displayName = 'Physical Data Movement';

    public onSelect(): void {
        this.renderer.hideEdgeViewModeSelectorAdditional();

        this.renderer.recalculateAll();
        this.renderer.graph?.enablePhysMovementOverlay();
    }

    public onDeselect(): void {
        this.renderer.graph?.disablePhysMovementOverlay();
    }

}
