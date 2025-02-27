// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    Colors,
    Legend,
    LinearScale,
    Tooltip,
} from 'chart.js';
import '../../scss/access_statistics.scss';
import { read_or_decompress } from '../utils/sdfg/json_serializer';

interface Subset {
    type: string;
    ranges: {
        start: string;
        end: string;
        step: string;
        tile: string;
    }[];
}

interface _AccessRecord {
    anode?: string;
    block?: string;
    edge?: string;
    mode: 'write' | 'read';
    at: Subset;
}

interface _AccessTypeSubCategory {
    name: string;
    n_accesses: number;
    accesses: _AccessRecord[];
}

interface _DataContainerAccessStats {
    container: string;
    n_total_accesses: number;
    constant_accesses: _AccessTypeSubCategory[];
    indirect_accesses: _AccessTypeSubCategory[];
    linear_accesses: _AccessTypeSubCategory[];
    strided_accesses: _AccessTypeSubCategory[];
}

interface _SDFGAccessStats {
    name: string;
    id: number;
    n_total_accesses: number;
    accesses: _DataContainerAccessStats[];
}

interface _AccessStatistics {
    all_cfg_stats: _SDFGAccessStats[];
}

type _AccessType = 'linear_accesses' | 'strided_accesses' |
    'indirect_accesses' | 'constant_accesses';

type SDFG_SORTING_CRITERIUM = 'all_accesses' | _AccessType;
type SDFG_SORTING_STYLE = 'ascending' | 'descending';

class AccessStatsView {

    private statistics: _AccessStatistics | null = null;

    public constructor() {
        $(document).on(
            'change.sdfv', '#sdfg-access-stats-file-input',
            this.loadAccessStats.bind(this)
        );
        $(document).on(
            'change.sdfv', '#sdfg-access-stats-sorting-crit',
            this.reDrawStats.bind(this)
        );
        $(document).on(
            'change.sdfv', '#sdfg-access-stats-sorting-style',
            this.reDrawStats.bind(this)
        );
    }

    public reDrawStats(): void {
        if (this.statistics)
            buildTreeView(this.statistics);
        else
            console.error('No statistics loaded');
    }

    public loadAccessStats(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const accessStatsFile = changeEvent.target.files[0];
        if (!accessStatsFile)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                const packedResult = read_or_decompress(result);
                this.statistics = JSON.parse(packedResult[0]);
                if (this.statistics)
                    buildTreeView(this.statistics);
                else
                    console.error('Failed to load statistics');
            }
        };
        fileReader.readAsArrayBuffer(accessStatsFile);
    }

}

function buildDataContainerHist(
    data: _DataContainerAccessStats, root: JQuery<HTMLElement>,
    collapse: JQuery<HTMLElement>, expanded: boolean
): void {
    const datasets: any[] = [];
    for (const access of data.constant_accesses) {
        datasets.push({
            label: access.name,
            data: [access.n_accesses, 0, 0, 0],
        });
    }
    for (const access of data.indirect_accesses) {
        datasets.push({
            label: access.name,
            data: [0, access.n_accesses, 0, 0],
        });
    }
    for (const access of data.linear_accesses) {
        datasets.push({
            label: access.name,
            data: [0, 0, access.n_accesses, 0],
        });
    }
    for (const access of data.strided_accesses) {
        datasets.push({
            label: access.name,
            data: [0, 0, 0, access.n_accesses],
        });
    }

    const canvas = $('<canvas>').appendTo(root) as JQuery<HTMLCanvasElement>;
    let chart: Chart | undefined = undefined;

    function createChart() {
        chart = new Chart(
            canvas,
            {
                type: 'bar',
                data: {
                    labels: ['Constant', 'Indirect', 'Linear', 'Strided'],
                    datasets: datasets,
                },
                options: {
                    animation: false,
                    scales: {
                        y: {
                            stacked: true,
                        },
                        x: {
                            stacked: true,
                        },
                    },
                },
            }
        );
    }

    collapse[0].addEventListener('show.bs.collapse', () => {
        createChart();
    });

    collapse[0].addEventListener('hidden.bs.collapse', () => {
        if (chart)
            chart.destroy();
    });

    if (expanded)
        createChart();
}

function constructAccordion<T>(
    container: JQuery<HTMLElement>, data: Iterable<T>,
    idFun: (record: T) => string, headerTextFun: (record: T) => string,
    id: string, expandFirst: boolean = true,
    recordFun?: (
        record: T, root: JQuery<HTMLElement>, collapse: JQuery<HTMLElement>,
        expanded: boolean
    ) => any
): JQuery<HTMLElement> {
    const accordion = $('<div>', {
        class: 'accordion',
        id: id,
    }).appendTo(container);

    let first = expandFirst;
    for (const record of data) {
        const recordId = idFun(record);
        const accordionItem = $('<div>', {
            class: 'accordion-item',
        }).appendTo(accordion);
        const header = $('<h2>', {
            class: 'accordion-header',
        }).appendTo(accordionItem);
        $('<button>', {
            class: 'accordion-button' + (first ? '' : ' collapsed'),
            type: 'button',
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#' + recordId,
            'aria-expanded': (first ? 'true' : 'false'),
            'aria-controls': recordId,
            text: headerTextFun(record),
        }).appendTo(header);
        const collapse = $('<div>', {
            id: recordId,
            class: 'accordion-collapse collapse' + (first ? ' show' : ''),
            'data-bs-parent': '#' + id,
        }).appendTo(accordionItem);
        const accordionBody = $('<div>', {
            class: 'accordion-body',
        }).appendTo(collapse);
        const recordContentsContainer = $('<div>', {
            class: 'container-fluid',
        }).appendTo(accordionBody);
        if (recordFun !== undefined)
            recordFun(record, recordContentsContainer, collapse, first);
        first = false;
    }

    return accordion;
}

function buildSDFGTreeView(
    data: _SDFGAccessStats, root: JQuery<HTMLElement>,
    collapse: JQuery<HTMLElement>, expanded: boolean
): void {
    const countAllContainerAccessesOfType = (
        record: _DataContainerAccessStats, type: _AccessType
    ): number => {
        let nAccesses = 0;
        for (const subCat of record[type])
            nAccesses += subCat.n_accesses;
        return nAccesses;
    };

    const aggregatedConstantAccesses: _AccessTypeSubCategory[] = [];
    const aggregatedIndirectAccesses: _AccessTypeSubCategory[] = [];
    const aggregatedLinearAccesses: _AccessTypeSubCategory[] = [];
    const aggregatedStridedAccesses: _AccessTypeSubCategory[] = [];
    const constAccDict = new Map<string, _AccessTypeSubCategory>();
    const indirAccDict = new Map<string, _AccessTypeSubCategory>();
    const linAccDict = new Map<string, _AccessTypeSubCategory>();
    const stridedAccDict = new Map<string, _AccessTypeSubCategory>();
    for (const contEntry of data.accesses) {
        for (const acc of contEntry.constant_accesses) {
            const existing = constAccDict.get(acc.name);
            if (existing !== undefined) {
                existing.n_accesses += acc.n_accesses;
                existing.accesses = existing.accesses.concat(acc.accesses);
            } else {
                constAccDict.set(acc.name, acc);
            }
        }
        for (const acc of contEntry.indirect_accesses) {
            const existing = indirAccDict.get(acc.name);
            if (existing !== undefined) {
                existing.n_accesses += acc.n_accesses;
                existing.accesses = existing.accesses.concat(acc.accesses);
            } else {
                indirAccDict.set(acc.name, acc);
            }
        }
        for (const acc of contEntry.linear_accesses) {
            const existing = linAccDict.get(acc.name);
            if (existing !== undefined) {
                existing.n_accesses += acc.n_accesses;
                existing.accesses = existing.accesses.concat(acc.accesses);
            } else {
                linAccDict.set(acc.name, acc);
            }
        }
        for (const acc of contEntry.strided_accesses) {
            const existing = stridedAccDict.get(acc.name);
            if (existing !== undefined) {
                existing.n_accesses += acc.n_accesses;
                existing.accesses = existing.accesses.concat(acc.accesses);
            } else {
                stridedAccDict.set(acc.name, acc);
            }
        }
    }
    for (const k of constAccDict.keys())
        aggregatedConstantAccesses.push(constAccDict.get(k)!);
    for (const k of indirAccDict.keys())
        aggregatedIndirectAccesses.push(indirAccDict.get(k)!);
    for (const k of linAccDict.keys())
        aggregatedLinearAccesses.push(linAccDict.get(k)!);
    for (const k of stridedAccDict.keys())
        aggregatedStridedAccesses.push(stridedAccDict.get(k)!);

    const summaryAccessStat: _DataContainerAccessStats = {
        container: '',
        n_total_accesses: data.n_total_accesses,
        constant_accesses: aggregatedConstantAccesses,
        indirect_accesses: aggregatedIndirectAccesses,
        linear_accesses: aggregatedLinearAccesses,
        strided_accesses: aggregatedStridedAccesses,
    };
    buildDataContainerHist(summaryAccessStat, root, collapse, expanded);

    const sortingCrit = $(
        '#sdfg-access-stats-sorting-crit'
    ).val() as SDFG_SORTING_CRITERIUM;
    const sortingStyle = $(
        '#sdfg-access-stats-sorting-style'
    ).val() as SDFG_SORTING_STYLE;
    switch (sortingCrit) {
        case 'linear_accesses':
        case 'strided_accesses':
        case 'indirect_accesses':
        case 'constant_accesses':
            data.accesses.sort((a, b) => {
                let nA = countAllContainerAccessesOfType(a, sortingCrit);
                let nB = countAllContainerAccessesOfType(b, sortingCrit);
                if (sortingStyle == 'descending')
                    return nB - nA;
                else
                    return nA - nB;
            });
            break;
        case 'all_accesses':
        default:
            data.accesses.sort((a, b) => {
                if (sortingStyle == 'descending')
                    return b.n_total_accesses - a.n_total_accesses;
                else
                    return a.n_total_accesses - b.n_total_accesses;
            });
            break;
    }

    constructAccordion(
        root, data.accesses, (record) => {
            return (
                'data-container-stats-entry-' + data.id.toString() + '-' +
                record.container
            );
        }, (record) => {
            return (
                record.container + ' (' + record.n_total_accesses.toString() +
                ')'
            );
        }, 'sdfg-stats-accordion-sdfg-entry-' + data.id.toString(), true,
        buildDataContainerHist
    );
}

function buildTreeView(data: _AccessStatistics): void {
    const container = $('#statistics-contents');
    container.html('');

    const countAllSDFGAccessesOfType = (
        record: _SDFGAccessStats, type: _AccessType
    ): number => {
        let nAccesses = 0;
        for (const dataRecord of record.accesses) {
            let recordAccesses = 0;
            for (const subCat of dataRecord[type])
                recordAccesses += subCat.n_accesses;
            nAccesses += recordAccesses;
        }
        return nAccesses;
    };

    const sortingCrit = $(
        '#sdfg-access-stats-sorting-crit'
    ).val() as SDFG_SORTING_CRITERIUM;
    const sortingStyle = $(
        '#sdfg-access-stats-sorting-style'
    ).val() as SDFG_SORTING_STYLE;
    switch (sortingCrit) {
        case 'linear_accesses':
        case 'strided_accesses':
        case 'indirect_accesses':
        case 'constant_accesses':
            data.all_cfg_stats.sort((a, b) => {
                let nA = countAllSDFGAccessesOfType(a, sortingCrit);
                let nB = countAllSDFGAccessesOfType(b, sortingCrit);
                if (sortingStyle == 'descending')
                    return nB - nA;
                else
                    return nA - nB;
            });
            break;
        case 'all_accesses':
        default:
            data.all_cfg_stats.sort((a, b) => {
                if (sortingStyle == 'descending')
                    return b.n_total_accesses - a.n_total_accesses;
                else
                    return a.n_total_accesses - b.n_total_accesses;
            });
            break;
    }

    constructAccordion(
        container, data.all_cfg_stats,
        (record) => 'sdfg-stats-entry-id-' + record.id.toString(),
        (record) => (
            'SDFG ' + record.id.toString() + ': ' + record.name +
            ' (' + record.n_total_accesses.toString() + ')'
        ), 'sdfg-stats-accordion', true, buildSDFGTreeView
    );
}

$(() => {
    Chart.register(
        BarController, BarElement, CategoryScale, Tooltip, Legend,
        LinearScale, Colors
    );

    const statsView = new AccessStatsView();
});
