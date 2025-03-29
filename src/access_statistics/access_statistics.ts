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
import ChartDataLabels from 'chartjs-plugin-datalabels';
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
    multiplier?: number;
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
type GROUPING_STYLE = 'sdfg' | 'container';

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
        $(document).on(
            'change.sdfv', '#sdfg-access-stats-group-by',
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
    const getCatReads = (cat: _AccessType) => {
        const reads: Record<string, number> = {};
        const writes: Record<string, number> = {};
        for (const access of data[cat]) {
            for (const acc of access.accesses) {
                if (acc.mode === 'read') {
                    if (access.name in reads) {
                        if (acc.multiplier)
                            reads[access.name] += acc.multiplier;
                        else
                            reads[access.name] += 1;
                    } else {
                        if (acc.multiplier)
                            reads[access.name] = acc.multiplier;
                        else
                            reads[access.name] = 1;
                    }
                } else {
                    if (access.name in writes) {
                        if (acc.multiplier)
                            writes[access.name] += acc.multiplier;
                        else
                            writes[access.name] += 1;
                    } else {
                        if (acc.multiplier)
                            writes[access.name] = acc.multiplier;
                        else
                            writes[access.name] = 1;
                    }
                }
            }
        }
        return [reads, writes];
    };

    const datasets: any[] = [];

    let datasetIndex = -1;
    let constReadIdx = -1;
    let constWriteIdx = -1;
    let linReadIdx = -1;
    let linWriteIdx = -1;
    let strideReadIdx = -1;
    let strideWriteIdx = -1;
    let indirReadIdx = -1;
    let indirWriteIdx = -1;
    const [constReads, constWrites] = getCatReads('constant_accesses');
    for (const accName in constReads) {
        datasetIndex++;
        constReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [constReads[accName], 0, 0, 0],
            stack: 'Reads',
            backgroundColor: constReadIdx % 2 === 0 ? '#90EE90' : '#3CB371',
        });
    }
    for (const accName in constWrites) {
        datasetIndex++;
        constWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [constWrites[accName], 0, 0, 0],
            stack: 'Writes',
            backgroundColor: constReadIdx % 2 === 0 ? '#228B22' : '#006400',
        });
    }

    const [linReads, linWrites] = getCatReads('linear_accesses');
    for (const accName in linReads) {
        datasetIndex++;
        linReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, linReads[accName], 0, 0],
            stack: 'Reads',
            backgroundColor: '#4169E1',
        });
    }
    for (const accName in linWrites) {
        datasetIndex++;
        linWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, linWrites[accName], 0, 0],
            stack: 'Writes',
            backgroundColor: '#191970',
        });
    }

    const [strideReads, strideWrites] = getCatReads('strided_accesses');
    for (const accName in strideReads) {
        datasetIndex++;
        strideReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, strideReads[accName], 0],
            stack: 'Reads',
            backgroundColor: '#FFD700',
        });
    }
    for (const accName in strideWrites) {
        datasetIndex++;
        strideWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, strideWrites[accName], 0],
            stack: 'Writes',
            backgroundColor: '#FF8C00',
        });
    }

    const [indirReads, indirWrites] = getCatReads('indirect_accesses');
    for (const accName in indirReads) {
        datasetIndex++;
        indirReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, 0, indirReads[accName]],
            stack: 'Reads',
            backgroundColor: constReadIdx % 2 === 0 ? '#FF7F50' : '#A52A2A',
        });
    }
    for (const accName in indirWrites) {
        datasetIndex++;
        indirWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, 0, indirWrites[accName]],
            stack: 'Writes',
            backgroundColor: constReadIdx % 2 === 0 ? '#DC143C' : '#8B0000',
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
                    labels: ['Constant', 'Linear', 'Strided', 'Indirect'],
                    datasets: datasets,
                },
                plugins: [ChartDataLabels],
                options: {
                    animation: false,
                    interaction: {
                        intersect: false,
                    },
                    scales: {
                        y: {
                            stacked: true,
                        },
                        x: {
                            stacked: true,
                        },
                    },
                    plugins: {
                        legend: {
                            display: false,
                        },
                        datalabels: {
                            align: 'end',
                            anchor: 'start',
                            color: 'black',
                            formatter: function(_, context) {
                                const ds = context.chart.data.datasets;
                                const dsIdx = context.datasetIndex;
                                const dIdx = context.dataIndex;
                                if ((dIdx === 0 && (dsIdx === constReadIdx ||
                                                    dsIdx === constWriteIdx)) ||
                                    (dIdx === 1 && (dsIdx === linReadIdx ||
                                                    dsIdx === linWriteIdx)) ||
                                    (dIdx === 2 && (dsIdx === strideReadIdx ||
                                                    dsIdx === strideWriteIdx)) ||
                                    (dIdx === 3 && (dsIdx === indirReadIdx ||
                                                    dsIdx === indirWriteIdx))) {
                                    return ds[dsIdx].stack;
                                }
                                return '';
                            }
                        }
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

function buildSDFGHist(
    data: _AccessStatistics, root: JQuery<HTMLElement>
): void {
    const getCatReads = (cat: _AccessType) => {
        const reads: Record<string, number> = {};
        const writes: Record<string, number> = {};
        for (const cfgStats of data.all_cfg_stats) {
            for (const dcStats of cfgStats.accesses) {
                for (const access of dcStats[cat]) {
                    for (const acc of access.accesses) {
                        if (acc.mode === 'read') {
                            if (access.name in reads) {
                                if (acc.multiplier)
                                    reads[access.name] += acc.multiplier;
                                else
                                    reads[access.name] += 1;
                            } else {
                                if (acc.multiplier)
                                    reads[access.name] = acc.multiplier;
                                else
                                    reads[access.name] = 1;
                            }
                        } else {
                            if (access.name in writes) {
                                if (acc.multiplier)
                                    writes[access.name] += acc.multiplier;
                                else
                                    writes[access.name] += 1;
                            } else {
                                if (acc.multiplier)
                                    writes[access.name] = acc.multiplier;
                                else
                                    writes[access.name] = 1;
                            }
                        }
                    }
                }
            }
        }
        return [reads, writes];
    };

    const datasets: any[] = [];

    let datasetIndex = -1;
    let constReadIdx = -1;
    let constWriteIdx = -1;
    let linReadIdx = -1;
    let linWriteIdx = -1;
    let strideReadIdx = -1;
    let strideWriteIdx = -1;
    let indirReadIdx = -1;
    let indirWriteIdx = -1;
    const [constReads, constWrites] = getCatReads('constant_accesses');
    for (const accName in constReads) {
        datasetIndex++;
        constReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [constReads[accName], 0, 0, 0],
            stack: 'Reads',
            backgroundColor: constReadIdx % 2 === 0 ? '#90EE90' : '#3CB371',
        });
    }
    for (const accName in constWrites) {
        datasetIndex++;
        constWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [constWrites[accName], 0, 0, 0],
            stack: 'Writes',
            backgroundColor: constReadIdx % 2 === 0 ? '#228B22' : '#006400',
        });
    }

    const [linReads, linWrites] = getCatReads('linear_accesses');
    for (const accName in linReads) {
        datasetIndex++;
        linReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, linReads[accName], 0, 0],
            stack: 'Reads',
            backgroundColor: '#4169E1',
        });
    }
    for (const accName in linWrites) {
        datasetIndex++;
        linWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, linWrites[accName], 0, 0],
            stack: 'Writes',
            backgroundColor: '#191970',
        });
    }

    const [strideReads, strideWrites] = getCatReads('strided_accesses');
    for (const accName in strideReads) {
        datasetIndex++;
        strideReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, strideReads[accName], 0],
            stack: 'Reads',
            backgroundColor: '#FFD700',
        });
    }
    for (const accName in strideWrites) {
        datasetIndex++;
        strideWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, strideWrites[accName], 0],
            stack: 'Writes',
            backgroundColor: '#FF8C00',
        });
    }

    const [indirReads, indirWrites] = getCatReads('indirect_accesses');
    for (const accName in indirReads) {
        datasetIndex++;
        indirReadIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, 0, indirReads[accName]],
            stack: 'Reads',
            backgroundColor: constReadIdx % 2 === 0 ? '#FF7F50' : '#A52A2A',
        });
    }
    for (const accName in indirWrites) {
        datasetIndex++;
        indirWriteIdx = datasetIndex;
        datasets.push({
            label: accName,
            data: [0, 0, 0, indirWrites[accName]],
            stack: 'Writes',
            backgroundColor: constReadIdx % 2 === 0 ? '#DC143C' : '#8B0000',
        });
    }

    const canvas = $('<canvas>').appendTo(root) as JQuery<HTMLCanvasElement>;

    new Chart(
        canvas,
        {
            type: 'bar',
            data: {
                labels: ['Constant', 'Linear', 'Strided', 'Indirect'],
                datasets: datasets,
            },
            plugins: [ChartDataLabels],
            options: {
                animation: false,
                interaction: {
                    intersect: false,
                },
                scales: {
                    y: {
                        stacked: true,
                    },
                    x: {
                        stacked: true,
                    },
                },
                plugins: {
                    legend: {
                        display: false,
                    },
                    tooltip: {
                        intersect: true,
                    },
                    datalabels: {
                        align: 'end',
                        anchor: 'start',
                        color: 'black',
                        formatter: function(_, context) {
                            const ds = context.chart.data.datasets;
                            const dsIdx = context.datasetIndex;
                            const dIdx = context.dataIndex;
                            if ((dIdx === 0 && (dsIdx === constReadIdx ||
                                                dsIdx === constWriteIdx)) ||
                                (dIdx === 1 && (dsIdx === linReadIdx ||
                                                dsIdx === linWriteIdx)) ||
                                (dIdx === 2 && (dsIdx === strideReadIdx ||
                                                dsIdx === strideWriteIdx)) ||
                                (dIdx === 3 && (dsIdx === indirReadIdx ||
                                                dsIdx === indirWriteIdx))) {
                                return ds[dsIdx].stack;
                            }
                            return '';
                        }
                    }
                },
            },
        }
    );
}

function buildTreeView(data: _AccessStatistics): void {
    const container = $('#statistics-contents');
    container.html('');

    const countAllContainerAccessesOfType = (
        record: _DataContainerAccessStats, type: _AccessType
    ): number => {
        let nAccesses = 0;
        for (const subCat of record[type])
            nAccesses += subCat.n_accesses;
        return nAccesses;
    };

    const countAllSDFGAccessesOfType = (
        record: _SDFGAccessStats, type: _AccessType
    ): number => {
        let nAccesses = 0;
        for (const dataRecord of record.accesses)
            nAccesses += countAllContainerAccessesOfType(dataRecord, type);
        return nAccesses;
    };

    buildSDFGHist(data, container);

    const sortingCrit = $(
        '#sdfg-access-stats-sorting-crit'
    ).val() as SDFG_SORTING_CRITERIUM;
    const sortingStyle = $(
        '#sdfg-access-stats-sorting-style'
    ).val() as SDFG_SORTING_STYLE;
    const groupBy = $(
        '#sdfg-access-stats-group-by'
    ).val() as GROUPING_STYLE;
    if (groupBy === 'sdfg') {
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
            ), 'data-stats-accordion', true, buildSDFGTreeView
        );
    } else {
        // Group by data containers.
        const byContainerStats: Record<string, _DataContainerAccessStats> = {};
        for (const cfgStats of data.all_cfg_stats) {
            for (const containerStats of cfgStats.accesses) {
                if (containerStats.container in Object.keys(byContainerStats)) {
                    const entry = byContainerStats[containerStats.container];
                    entry.n_total_accesses += containerStats.n_total_accesses;
                    for (const access of containerStats.constant_accesses)
                        entry.constant_accesses.push(access);
                    for (const access of containerStats.linear_accesses)
                        entry.linear_accesses.push(access);
                    for (const access of containerStats.strided_accesses)
                        entry.strided_accesses.push(access);
                    for (const access of containerStats.indirect_accesses)
                        entry.indirect_accesses.push(access);
                } else {
                    byContainerStats[containerStats.container] = containerStats;
                }
            }
        }
        const contStats: _DataContainerAccessStats[] = [];
        for (const key in byContainerStats)
            contStats.push(byContainerStats[key]);

        switch (sortingCrit) {
            case 'linear_accesses':
            case 'strided_accesses':
            case 'indirect_accesses':
            case 'constant_accesses':
                contStats.sort((a, b) => {
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
                contStats.sort((a, b) => {
                    if (sortingStyle == 'descending')
                        return b.n_total_accesses - a.n_total_accesses;
                    else
                        return a.n_total_accesses - b.n_total_accesses;
                });
                break;
        }

        constructAccordion<_DataContainerAccessStats>(
            container, contStats,
            (record) => 'data-stats-entry-id-' + record.container,
            (record) => (
                record.container +
                ' (' + record.n_total_accesses.toString() + ')'
            ), 'sdfg-stats-accordion', true, buildDataContainerHist
        );
    }
}

$(() => {
    Chart.register(
        BarController, BarElement, CategoryScale, Tooltip, Legend,
        LinearScale, Colors
    );

    const statsView = new AccessStatsView();
});
