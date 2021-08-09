// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { SDFGRenderer } from "./renderer/renderer";
import { SDFGElement } from "./renderer/renderer_elements";

export type SymbolMap = {
    [symbol: string]: number | undefined,
};

export type DagreSDFG = dagre.graphlib.Graph<SDFGElement>;

export type ModeButtons = {
    [name: string]: HTMLElement | null,
    add_btns: HTMLElement[],
};

export type SDFVTooltipFunc = (container: HTMLElement) => void;

export type Point2D = {
    x: number,
    y: number,
};