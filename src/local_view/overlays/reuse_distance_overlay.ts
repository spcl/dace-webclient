// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import { NodeOverlay } from './base_overlays';

export class ReuseDistanceOverlay extends NodeOverlay {

    public readonly value = 'reuse-distance';
    public readonly displayName = 'Reuse Distance (Stack Distance)';

    public onSelect(): void {
        this.renderer.hideNodeViewModeSelectorAdditional();

        const container = $('<div>', {
            id: 'reuse-distance-metric-container',
        });
        $('<input>', {
            type: 'radio',
            id: 'input-rdm-median',
            name: 'reuse-distance-metric',
            value: 'median',
            checked: 'checked',
        }).appendTo(container);
        $('<label>', {
            text: 'Median',
            for: 'input-rdm-median',
        }).appendTo(container);
        $('<input>', {
            type: 'radio',
            id: 'input-rdm-min',
            name: 'reuse-distance-metric',
            value: 'min',
        }).appendTo(container);
        $('<label>', {
            text: 'Min',
            for: 'input-rdm-min',
        }).appendTo(container);
        $('<input>', {
            type: 'radio',
            id: 'input-rdm-max',
            name: 'reuse-distance-metric',
            value: 'max',
        }).appendTo(container);
        $('<label>', {
            text: 'Max',
            for: 'input-rdm-max',
        }).appendTo(container);
        $('<input>', {
            type: 'radio',
            id: 'input-rdm-misses',
            name: 'reuse-distance-metric',
            value: 'misses',
        }).appendTo(container);
        $('<label>', {
            text: 'Misses',
            for: 'input-rdm-misses',
        }).appendTo(container);

        this.renderer.nodeOverlayAdditional?.append(container);
        this.renderer.nodeOverlayAdditional?.show();

        $('input[name="reuse-distance-metric"]').on('change', () => {
            const val = $('input[name="reuse-distance-metric"]:checked').val();
            if (val && typeof val === 'string')
                this.renderer.graph?.setReuseDistanceMetric(val);
        });

        this.renderer.graph?.setReuseDistanceMetric('median', false);
        this.renderer.graph?.enableReuseDistanceOverlay();
    }

    public onDeselect(): void {
        this.renderer.hideReuseDistanceHist();
        this.renderer.graph?.setReuseDistanceMetric('median', false);
        this.renderer.graph?.disableReuseDistanceOverlay();
    }

}
