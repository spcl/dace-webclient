// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { NodeOverlay } from './base_overlays';

export class CacheLineOverlay extends NodeOverlay {

    public readonly value = 'cache-lines';
    public readonly displayName = 'Cache Lines';

    public onSelect(): void {
        this.renderer.hideNodeViewModeSelectorAdditional();
    }

    public onDeselect(): void {
        // TODO: remove all cache line visualizations.
        return;
    }

}
