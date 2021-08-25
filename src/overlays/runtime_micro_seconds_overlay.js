import { MapExit, NestedSDFG, SDFGNode, State } from '../renderer/renderer_elements';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';
import { mean, median } from 'mathjs';
import { getTempColor } from '../renderer/renderer_elements';

const criterium = 'mean';

export class RuntimeMicroSecondsOverlay {

    constructor(settings, runtime_map) {
        this.badness_scale_method = settings.badness_scale_method;
        this.symbol_resolver = settings.symbol_resolver;
        this.runtime_map = runtime_map
    }

    static computeOverlay(runtimeMap, symbolResolver, badnessScaleMethod = 'median') {
        const rmso = new RuntimeMicroSecondsOverlay({
            badness_scale_method: badnessScaleMethod,
            symbol_resolver: symbolResolver,
        }, runtimeMap);
        rmso.refresh();
        return {
            runtimeMap,
            badnessScaleCenter: rmso.badness_scale_center,
        }
    }

    static getNodeTemperature(overlayDetails, node) {
        const rt_summary = overlayDetails.runtimeMap[RuntimeMicroSecondsOverlay.get_element_uuid(node)];
        return rt_summary === undefined ? undefined : 0.5 * rt_summary[criterium] / overlayDetails.badnessScaleCenter;
    }

    static get_element_uuid(element) {
        const undefined_val = -1;
        if (element instanceof State) {
            return (
                element.sdfg.sdfg_list_id + '/' +
                element.id + '/' +
                undefined_val + '/' +
                undefined_val
            );
        } else if (element instanceof NestedSDFG) {
            const sdfg_id = element.data.node.attributes.sdfg.sdfg_list_id;
            return (
                sdfg_id + '/' +
                undefined_val + '/' +
                undefined_val + '/' +
                undefined_val
            );
        } else if (element instanceof MapExit) {
            // For MapExit nodes, we want to get the uuid of the corresponding
            // entry node instead, because the runtime is held there.
            return (
                element.sdfg.sdfg_list_id + '/' +
                element.parent_id + '/' +
                element.data.node.scope_entry + '/' +
                undefined_val
            );
        } else if (element instanceof SDFGNode) {
            return (
                element.sdfg.sdfg_list_id + '/' +
                element.parent_id + '/' +
                element.id + '/' +
                undefined_val
            );
        }
        return (
            undefined_val + '/' +
            undefined_val + '/' +
            undefined_val + '/' +
            undefined_val
        );
    }

    refresh() {
        const micros_values = [0];

        for (const key of Object.keys(this.runtime_map)) {
            // Make sure the overall SDFG's runtime isn't included in this.
            if (key !== '0/-1/-1/-1')
                micros_values.push(this.runtime_map[key][criterium]);
        }

        switch (this.badness_scale_method) {
            case 'mean':
                this.badness_scale_center = mean(micros_values);
                break;
            case 'median':
            default:
                this.badness_scale_center = median(micros_values);
                break;
        }
    }

    pretty_print_micros(micros) {
        let unit = 'µs';
        let value = micros;
        if (micros > 1000) {
            unit = 'ms';
            const millis = micros / 1000;
            value = millis;
            if (millis > 1000) {
                unit = 's';
                const seconds = millis / 1000;
                value = seconds;
            }
        }

        value = Math.round((value + Number.EPSILON) * 100) / 100;
        return value.toString() + ' ' + unit;
    }

    shade_node(node) {
        const rt_summary = this.runtime_map[RuntimeMicroSecondsOverlay.get_element_uuid(node)];

        if (rt_summary === undefined)
            return;

        if (this.renderer.mousepos &&
            node.intersect(this.renderer.mousepos.x, this.renderer.mousepos.y)) {
            // Show the measured runtime.
            if (rt_summary['min'] === rt_summary['max'])
                this.renderer.tooltip = () => {
                    this.renderer.tooltip_container.innerText = (
                        this.pretty_print_micros(rt_summary['min'])
                    );
                };

            else
                this.renderer.tooltip = () => {
                    this.renderer.tooltip_container.innerText = (
                        'Min: ' + this.pretty_print_micros(rt_summary['min']) +
                        '\nMax: ' + this.pretty_print_micros(rt_summary['max']) +
                        '\nMean: ' + this.pretty_print_micros(rt_summary['mean']) +
                        '\nMedian: ' + this.pretty_print_micros(rt_summary['med']) +
                        '\nCount: ' + rt_summary['count']
                    );
                };
        }

        // Calculate the 'badness' color.
        const micros = rt_summary[criterium];
        let badness = (1 / (this.badness_scale_center * 2)) * micros;
        if (badness < 0)
            badness = 0;
        if (badness > 1)
            badness = 1;
        const color = getTempColor(badness);

        node.shade(this.renderer, ctx, color);
    }

}
